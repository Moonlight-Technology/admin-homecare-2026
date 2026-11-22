import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Readable } from 'node:stream';
import type { ConfigService } from '@nestjs/config';
import type { PrismaService } from '../../prisma/prisma.service';
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
    expect(prisma.document.update).toHaveBeenCalledWith({ where: { id: 'doc-1' }, data: { checksum: expect.stringMatching(/^[0-9a-f]{64}$/) } });
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
