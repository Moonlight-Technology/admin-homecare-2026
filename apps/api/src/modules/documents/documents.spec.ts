import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Readable } from 'node:stream';
import type { ConfigService } from '@nestjs/config';
import { Prisma } from '@prisma/client';
import type { Db, PrismaService } from '../../prisma/prisma.service';
import type { AuditService } from '../audit/audit.service';
import { matchesSignature, safeFileName } from './document-policy';
import { DocumentsService } from './documents.service';
import { LocalStorageDriver, ObjectTooLargeError } from './local-storage.driver';
import { signLink, verifyLink } from './signed-link';

const SECRET = 'test-storage-signing-secret-32-characters!';
const PDF = Buffer.concat([Buffer.from('%PDF-1.7\n'), Buffer.alloc(100, 0x20)]);

describe('signed links (AC-SEC-02)', () => {
  it('accepts only the same document, action, and an unexpired token', () => {
    const { token } = signLink(SECRET, 'doc-1', 'download', 60);
    expect(verifyLink(SECRET, token, 'doc-1', 'download')).toBe(true);
    expect(verifyLink(SECRET, token, 'doc-2', 'download')).toBe(false);
    expect(verifyLink(SECRET, token, 'doc-1', 'upload')).toBe(false);
    expect(verifyLink('another-secret-that-is-also-32-characters', token, 'doc-1', 'download')).toBe(false);
    expect(verifyLink(SECRET, token, 'doc-1', 'download', Date.now() + 61_000)).toBe(false);
  });

  it('rejects tampered, malformed, and missing tokens', () => {
    const { token } = signLink(SECRET, 'doc-1', 'download', 60);
    const [body, signature] = token.split('.');
    const forged = Buffer.from(JSON.stringify({ d: 'doc-1', a: 'download', e: 9_999_999_999 })).toString('base64url');
    expect(verifyLink(SECRET, `${forged}.${signature}`, 'doc-1', 'download')).toBe(false);
    expect(verifyLink(SECRET, `${body}.${signature}.x`, 'doc-1', 'download')).toBe(false);
    expect(verifyLink(SECRET, undefined, 'doc-1', 'download')).toBe(false);
  });
});

describe('private credential document roundtrip (real local bytes, isolated metadata)', () => {
  let dir: string;
  beforeEach(async () => { dir = await mkdtemp(join(tmpdir(), 'nakes-credential-docs-')); });
  afterEach(async () => { await rm(dir, { recursive: true, force: true }); });

  function setup() {
    const records = new Map<string, Record<string, unknown>>();
    const project = (record: Record<string, unknown>, select?: Record<string, unknown>) => Object.fromEntries(Object.entries(record).filter(([key]) => !select || select[key]));
    const db = {
      document: {
        create: jest.fn(async ({ data, select }: { data: Record<string, unknown>; select?: Record<string, unknown> }) => {
          const record = { ...data, checksum: null }; records.set(String(data.id), record); return project(record, select);
        }),
        findUnique: jest.fn(async ({ where }: { where: { id: string } }) => records.get(where.id) ?? null),
        findFirst: jest.fn(async ({ where }: { where: { id: string; ownerType: string; ownerId: string } }) => {
          const record = records.get(where.id);
          return record?.ownerType === where.ownerType && record.ownerId === where.ownerId ? record : null;
        }),
        update: jest.fn(async ({ where, data, select }: { where: { id: string }; data: Record<string, unknown>; select?: Record<string, unknown> }) => {
          const record = records.get(where.id)!; Object.assign(record, data); return project(record, select);
        }),
        updateMany: jest.fn(async ({ where, data }: { where: Record<string, unknown>; data: Record<string, unknown> }) => {
          const record = records.get(String(where.id));
          if (!record || Object.entries(where).some(([key, value]) => record[key] !== value)) return { count: 0 };
          Object.assign(record, data); return { count: 1 };
        }),
      },
    };
    const config = { get: (key: string, fallback: unknown) => key === 'STORAGE_DIR' ? dir : fallback, getOrThrow: (key: string) => key === 'API_PUBLIC_URL' ? 'http://api.test/api/v1' : SECRET } as unknown as ConfigService;
    const audit = { record: jest.fn() };
    return { service: new DocumentsService(db as unknown as PrismaService, config, audit as unknown as AuditService), db: db as unknown as Db, records, audit };
  }
  const owner = { ownerType: 'PRACTITIONER' as const, ownerId: 'pr1' };
  const source = { actorId: 'u1', scope: 'PLATFORM' as const };
  const input = { fileName: 'STR "scan".pdf', mimeType: 'application/pdf', sizeBytes: PDF.length };

  it('accepts only JPG/PNG up to 5 MB for clinic media, stored apart from verification documents', async () => {
    const { service, records } = setup();
    await expect(service.initMediaUpload('f1', { fileName: 'brosur.pdf', mimeType: 'application/pdf', sizeBytes: 100 }, 'u1')).rejects.toMatchObject({ code: 'VALIDATION_FAILED' });
    await expect(service.initMediaUpload('f1', { fileName: 'foto.jpg', mimeType: 'image/jpeg', sizeBytes: 5 * 1024 * 1024 + 1 }, 'u1')).rejects.toMatchObject({ code: 'VALIDATION_FAILED' });
    const init = await service.initMediaUpload('f1', { fileName: 'foto.png', mimeType: 'image/png', sizeBytes: 100 }, 'u1');
    const record = records.get(init.document.id)!;
    expect(record).toMatchObject({ ownerType: 'FACILITY_MEDIA', ownerId: 'f1', requirementId: null, status: 'PENDING_UPLOAD' });
    expect(record.objectKey).toBe(`facility-media/f1/${init.document.id}`);
  });

  it('recovers a closed connection before consuming upload bytes', async () => {
    const { service, db } = setup();
    const init = await service.initCredentialUpload('pr1', 'c1', input, 'u1', db);
    const lookup = jest.mocked(db.document.findUnique);
    lookup.mockRejectedValueOnce(new Prisma.PrismaClientKnownRequestError('Connection closed', { code: 'P1017', clientVersion: 'test' }));
    await service.receiveUpload(init.document.id, new URL(init.upload.url).searchParams.get('token')!, 'application/pdf', Readable.from([PDF]));
    expect(lookup).toHaveBeenCalledTimes(2);
    await expect(service.completeUpload(owner, init.document.id, source, db, 'c1')).resolves.toMatchObject({ status: 'UPLOADED' });
  });

  it('does not replay upload claims when a database write loses its connection', async () => {
    const { service, db } = setup();
    const init = await service.initCredentialUpload('pr1', 'c1', input, 'u1', db);
    const claim = jest.mocked(db.document.updateMany);
    const failure = new Prisma.PrismaClientKnownRequestError('Connection closed', { code: 'P1017', clientVersion: 'test' });
    claim.mockRejectedValueOnce(failure);
    await expect(service.receiveUpload(init.document.id, new URL(init.upload.url).searchParams.get('token')!, 'application/pdf', Readable.from([PDF]))).rejects.toBe(failure);
    expect(claim).toHaveBeenCalledTimes(1);
  });

  it('roundtrips exact bytes via bound signed URLs without exposing object keys or creating requirements', async () => {
    const { service, db, audit } = setup();
    const init = await service.initCredentialUpload('pr1', 'c1', input, 'u1', db);
    expect(JSON.stringify(init)).not.toContain('objectKey');
    expect(init.document.requirementId).toBeNull();
    const uploadToken = new URL(init.upload.url).searchParams.get('token')!;
    await service.receiveUpload(init.document.id, uploadToken, 'application/pdf', Readable.from([PDF]));
    const completed = await service.completeUpload(owner, init.document.id, source, db, 'c1');
    expect(completed.status).toBe('UPLOADED');
    expect(JSON.stringify(completed)).not.toContain('objectKey');
    const link = await service.ownedDownloadLink(owner, init.document.id, 'c1');
    const content = await service.openContent(init.document.id, new URL(link.url).searchParams.get('token')!);
    const chunks: Buffer[] = []; for await (const chunk of content.stream) chunks.push(Buffer.from(chunk));
    expect(Buffer.concat(chunks)).toEqual(PDF);
    expect(audit.record).toHaveBeenCalledWith(source, expect.objectContaining({ event: 'DOCUMENT_UPLOADED' }), db);
  });

  it('cannot attach or preview another credential or owner document, nor complete another uploader file', async () => {
    const { service, db } = setup();
    const init = await service.initCredentialUpload('pr1', 'c1', input, 'u1', db);
    await expect(service.completeUpload(owner, init.document.id, source, db, 'c2')).rejects.toMatchObject({ code: 'NOT_FOUND' });
    await expect(service.completeUpload(owner, init.document.id, { ...source, actorId: 'u2' }, db, 'c1')).rejects.toMatchObject({ code: 'NOT_FOUND' });
    await expect(service.completeUpload({ ...owner, ownerId: 'pr2' }, init.document.id, source, db, 'c1')).rejects.toMatchObject({ code: 'NOT_FOUND' });
    await expect(service.ownedDownloadLink(owner, init.document.id, 'c2')).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });

  it('blocks replay/concurrent PUT and completion before bytes have been validated', async () => {
    const { service, db, records } = setup();
    const init = await service.initCredentialUpload('pr1', 'c1', input, 'u1', db);
    const token = new URL(init.upload.url).searchParams.get('token')!;
    records.get(init.document.id)!.checksum = 'UPLOADING';
    await expect(service.completeUpload(owner, init.document.id, source, db, 'c1')).rejects.toMatchObject({ code: 'UPLOAD_MISSING' });
    await expect(service.receiveUpload(init.document.id, token, 'application/pdf', Readable.from([PDF]))).rejects.toMatchObject({ code: 'UPLOAD_ALREADY_RECEIVED' });
    records.get(init.document.id)!.checksum = null;
    await service.receiveUpload(init.document.id, token, 'application/pdf', Readable.from([PDF]));
    await expect(service.receiveUpload(init.document.id, token, 'application/pdf', Readable.from([PDF]))).rejects.toMatchObject({ code: 'UPLOAD_ALREADY_RECEIVED' });
  });

  it('rejects fake PDF bytes, cleans storage, and allows a corrected retry', async () => {
    const { service, db, records } = setup();
    const init = await service.initCredentialUpload('pr1', 'c1', input, 'u1', db);
    const token = new URL(init.upload.url).searchParams.get('token')!;
    await expect(service.receiveUpload(init.document.id, token, 'application/pdf', Readable.from([Buffer.alloc(PDF.length, 65)]))).rejects.toMatchObject({ code: 'VALIDATION_FAILED' });
    expect(records.get(init.document.id)!.checksum).toBeNull();
    await service.receiveUpload(init.document.id, token, 'application/pdf', Readable.from([PDF]));
    await expect(service.completeUpload(owner, init.document.id, source, db, 'c1')).resolves.toMatchObject({ status: 'UPLOADED' });
  });
});

describe('document policy', () => {
  it('checks real file signatures, not just the declared type', () => {
    expect(matchesSignature('application/pdf', PDF)).toBe(true);
    expect(matchesSignature('image/png', PDF)).toBe(false);
    expect(matchesSignature('application/x-msdownload', Buffer.from('MZ'))).toBe(false);
  });

  it('strips paths and header-breaking characters from file names', () => {
    expect(safeFileName('C:\\fakepath\\izin "final".pdf')).toBe('izin final.pdf');
    expect(safeFileName('../../etc/passwd')).toBe('passwd');
    expect(safeFileName('')).toBe('dokumen');
  });
});

describe('LocalStorageDriver', () => {
  let dir: string;
  beforeEach(async () => { dir = await mkdtemp(join(tmpdir(), 'nakes-storage-')); });
  afterEach(async () => { await rm(dir, { recursive: true, force: true }); });

  it('stores bytes with their size, hash, and first bytes', async () => {
    const driver = new LocalStorageDriver(dir);
    const stored = await driver.write('facility/abc/doc-1', Readable.from([PDF]), 1024);
    expect(stored.sizeBytes).toBe(PDF.length);
    expect(stored.head.subarray(0, 5).toString()).toBe('%PDF-');
    expect(await readFile(join(dir, 'facility', 'abc', 'doc-1'))).toEqual(PDF);
  });

  it('aborts past the size cap and leaves no file behind', async () => {
    const driver = new LocalStorageDriver(dir);
    await expect(driver.write('facility/abc/big', Readable.from([Buffer.alloc(2048)]), 1024)).rejects.toBeInstanceOf(ObjectTooLargeError);
    expect(await driver.exists('facility/abc/big')).toBe(false);
  });

  it('refuses keys that could escape the storage root', async () => {
    const driver = new LocalStorageDriver(dir);
    await expect(driver.write('../outside', Readable.from([PDF]), 1024)).rejects.toThrow('Invalid storage key');
    await expect(driver.write('Facility/ABC', Readable.from([PDF]), 1024)).rejects.toThrow('Invalid storage key');
  });
});

describe('DocumentsService uploads', () => {
  let dir: string;
  beforeEach(async () => { dir = await mkdtemp(join(tmpdir(), 'nakes-docs-')); });
  afterEach(async () => { await rm(dir, { recursive: true, force: true }); });

  function setup(document: Record<string, unknown> | null) {
    const config = { get: (key: string, fallback: unknown) => (key === 'STORAGE_DIR' ? dir : fallback), getOrThrow: (key: string) => (key === 'API_PUBLIC_URL' ? 'http://api.test/api/v1' : SECRET) } as unknown as ConfigService;
    const prisma = {
      document: {
        findUnique: jest.fn(async () => document),
        findFirst: jest.fn(async () => document),
        update: jest.fn(async () => ({})),
        updateMany: jest.fn(async () => ({ count: 1 })),
        // Like Prisma, return only the selected fields; this is what keeps the storage key out of responses.
        create: jest.fn(async (args: { data: Record<string, unknown>; select?: Record<string, unknown> }) => Object.fromEntries(Object.entries(args.data).filter(([key]) => !args.select || args.select[key]))),
      },
      documentRequirement: { findFirst: jest.fn(async () => ({ id: 'req-1' })) },
    };
    return { service: new DocumentsService(prisma as unknown as PrismaService, config, { record: jest.fn() } as unknown as AuditService), prisma };
  }
  const pending = { id: 'doc-1', objectKey: 'facility/f1/doc-1', mimeType: 'application/pdf', sizeBytes: PDF.length, status: 'PENDING_UPLOAD' };

  it('accepts a valid file through a valid upload link and records its checksum', async () => {
    const { service, prisma } = setup(pending);
    const { token } = signLink(SECRET, 'doc-1', 'upload', 60);
    await service.receiveUpload('doc-1', token, 'application/pdf', Readable.from([PDF]));
    expect(prisma.document.updateMany).toHaveBeenCalledWith({ where: { id: 'doc-1', status: 'PENDING_UPLOAD', checksum: 'UPLOADING' }, data: { checksum: expect.stringMatching(/^[0-9a-f]{64}$/) } });
  });

  it('rejects an upload with a forged link before touching storage', async () => {
    const { service, prisma } = setup(pending);
    await expect(service.receiveUpload('doc-1', 'guessed.token', 'application/pdf', Readable.from([PDF]))).rejects.toMatchObject({ code: 'FORBIDDEN' });
    expect(prisma.document.findUnique).not.toHaveBeenCalled();
  });

  it('deletes a file whose content is not the declared type', async () => {
    const fake = Buffer.alloc(PDF.length, 0x41);
    const { service } = setup(pending);
    const { token } = signLink(SECRET, 'doc-1', 'upload', 60);
    await expect(service.receiveUpload('doc-1', token, 'application/pdf', Readable.from([fake]))).rejects.toMatchObject({ code: 'VALIDATION_FAILED' });
    expect(await new LocalStorageDriver(dir).exists('facility/f1/doc-1')).toBe(false);
  });

  it('only allows PDF, JPG, and PNG up to 10 MB at init', async () => {
    const { service } = setup(null);
    const owner = { ownerType: 'FACILITY' as const, ownerId: 'f1' };
    await expect(service.initUpload(owner, { requirementId: 'req-1', fileName: 'x.exe', mimeType: 'application/x-msdownload', sizeBytes: 10 }, 'u1')).rejects.toMatchObject({ details: { fields: { mimeType: expect.any(Array) } } });
    await expect(service.initUpload(owner, { requirementId: 'req-1', fileName: 'x.pdf', mimeType: 'application/pdf', sizeBytes: 11 * 1024 * 1024 }, 'u1')).rejects.toMatchObject({ details: { fields: { sizeBytes: expect.any(Array) } } });
    const ok = await service.initUpload(owner, { requirementId: 'req-1', fileName: 'izin.pdf', mimeType: 'application/pdf', sizeBytes: 100 }, 'u1');
    expect(ok.upload.url).toMatch(/^http:\/\/api\.test\/api\/v1\/documents\/[0-9a-f-]{36}\/upload\?token=/);
    expect(JSON.stringify(ok)).not.toContain('objectKey');
  });

  it('serves content only with a valid download link (AC-SEC-02)', async () => {
    const { service } = setup({ ...pending, status: 'UPLOADED' });
    await expect(service.openContent('doc-1', undefined)).rejects.toMatchObject({ code: 'FORBIDDEN' });
    await expect(service.openContent('doc-1', signLink(SECRET, 'doc-1', 'upload', 60).token)).rejects.toMatchObject({ code: 'FORBIDDEN' });
  });
});
