import 'reflect-metadata';
import { Prisma } from '@prisma/client';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { ACCESS_KEY } from '../../common/access/access.decorators';
import type { PrismaService } from '../../prisma/prisma.service';
import type { AuditService } from '../audit/audit.service';
import type { DocumentsService } from '../documents/documents.service';
import { PractitionerDocumentsService } from './practitioner-documents.service';
import { AdminPractitionerDocumentsController, ClinicPractitionerDocumentsController } from './practitioner-documents.controllers';
import { PractitionerDocumentCompleteDto, PractitionerDocumentUploadDto } from './dto/practitioner-document.dto';

const source = { actorId: 'reviewer', scope: 'PLATFORM' as const };
const platform = { kind: 'PLATFORM' as const };
const clinic = { kind: 'CLINIC' as const, facilityId: 'clinic-a' };
const file = { fileName: 'str.pdf', mimeType: 'application/pdf', sizeBytes: 100 };

function setup(options: { found?: boolean; locked?: boolean; credential?: boolean } = {}) {
  const prisma = {
    practitioner: { findFirst: jest.fn(async () => options.found === false ? null : { id: 'p1', verificationStatus: 'SUBMITTED' }), updateMany: jest.fn(async () => ({ count: options.locked ? 0 : 1 })) },
    practitionerCredential: {
      findMany: jest.fn(async () => [{ id: 'c1', credentialType: 'STR', numberMasked: '****1234', document: null }]),
      findFirst: jest.fn(async () => options.credential === false ? null : { id: 'c1', documentId: 'old-document' }),
      update: jest.fn(async () => ({})),
    },
    $transaction: jest.fn(),
  };
  prisma.$transaction.mockImplementation(async (run: (db: unknown) => unknown) => run(prisma));
  const docs = {
    initCredentialUpload: jest.fn(async () => ({ document: { id: 'new-document' }, upload: { url: 'signed-upload' } })),
    completeUpload: jest.fn(async () => ({ id: 'new-document', status: 'UPLOADED' })),
    ownedDownloadLink: jest.fn(async () => ({ url: 'signed-download', expiresAt: 'expires' })),
  };
  const audit = { record: jest.fn(async () => undefined) };
  return { service: new PractitionerDocumentsService(prisma as unknown as PrismaService, docs as unknown as DocumentsService, audit as unknown as AuditService), prisma, docs, audit };
}

describe('practitioner documents ownership and lifecycle', () => {
  it('limits clinic access to its registered practitioner with a live affiliation', async () => {
    const { service, prisma } = setup();
    await service.list('p1', clinic);
    expect(prisma.practitioner.findFirst).toHaveBeenCalledWith({ where: { id: 'p1', createdByFacilityId: 'clinic-a', affiliations: { some: { facilityId: 'clinic-a', status: { in: ['PROPOSED', 'ACTIVE'] } } } }, select: { id: true, verificationStatus: true } });
    const query = prisma.practitionerCredential.findMany.mock.calls[0];
    expect(JSON.stringify(query)).not.toMatch(/numberEncrypted|numberHash|objectKey/);
  });
  it('does not grant clinic access by supplying another practitioner id', async () => {
    const { service, docs } = setup({ found: false });
    await expect(service.list('p2', clinic)).rejects.toMatchObject({ code: 'NOT_FOUND' });
    await expect(service.init('p2', 'c1', file, clinic, source)).rejects.toMatchObject({ code: 'NOT_FOUND' });
    await expect(service.complete('p2', 'c1', 'd1', clinic, source)).rejects.toMatchObject({ code: 'NOT_FOUND' });
    await expect(service.link('p2', 'c1', 'd1', clinic, source)).rejects.toMatchObject({ code: 'NOT_FOUND' });
    expect(docs.ownedDownloadLink).not.toHaveBeenCalled();
  });
  it('locks uploads and completion when review or verification has locked the record', async () => {
    const { service, docs, prisma } = setup({ locked: true });
    await expect(service.init('p1', 'c1', file, platform, source)).rejects.toMatchObject({ code: 'PRACTITIONER_DOCUMENTS_LOCKED' });
    await expect(service.complete('p1', 'c1', 'd1', platform, source)).rejects.toMatchObject({ code: 'PRACTITIONER_DOCUMENTS_LOCKED' });
    expect(docs.completeUpload).not.toHaveBeenCalled();
    expect(prisma.practitioner.updateMany).toHaveBeenCalledWith({ where: { id: 'p1', verificationStatus: { in: ['DRAFT', 'SUBMITTED', 'REVISION_REQUIRED', 'REJECTED'] } }, data: { updatedAt: expect.any(Date) } });
  });
  it('checks the credential belongs to this practitioner and is STR/SIP', async () => {
    const { service, prisma } = setup({ credential: false });
    await expect(service.init('p1', 'foreign-credential', file, platform, source)).rejects.toMatchObject({ code: 'NOT_FOUND' });
    expect(prisma.practitionerCredential.findFirst).toHaveBeenCalledWith({ where: { id: 'foreign-credential', practitionerId: 'p1', credentialType: { in: ['STR', 'SIP'] } }, select: { id: true, documentId: true } });
  });
  it('creates a server-bound private upload and joins the transaction', async () => {
    const { service, prisma, docs, audit } = setup();
    await service.init('p1', 'c1', file, platform, source);
    expect(docs.initCredentialUpload).toHaveBeenCalledWith('p1', 'c1', file, 'reviewer', prisma);
    expect(audit.record).toHaveBeenCalledWith(source, expect.objectContaining({ event: 'PRACTITIONER_DOCUMENT_UPLOAD_INITIATED', after: { credentialId: 'c1', documentId: 'new-document' } }), prisma);
  });
  it('completes and attaches atomically with binding, uploader, and prior-file audit', async () => {
    const { service, prisma, docs, audit } = setup();
    await service.complete('p1', 'c1', 'new-document', platform, source);
    expect(docs.completeUpload).toHaveBeenCalledWith({ ownerType: 'PRACTITIONER', ownerId: 'p1' }, 'new-document', source, prisma, 'c1');
    expect(prisma.practitionerCredential.update).toHaveBeenCalledWith({ where: { id: 'c1' }, data: { documentId: 'new-document', reviewStatus: 'UPLOADED' } });
    expect(audit.record).toHaveBeenCalledWith(source, expect.objectContaining({ event: 'PRACTITIONER_DOCUMENT_ATTACHED', before: { credentialId: 'c1', documentId: 'old-document' } }), prisma);
  });
  it('does not attach a file rejected by storage validation', async () => {
    const { service, prisma, docs } = setup();
    docs.completeUpload.mockRejectedValueOnce(new Error('UPLOAD_MISSING'));
    await expect(service.complete('p1', 'c1', 'd1', platform, source)).rejects.toThrow('UPLOAD_MISSING');
    expect(prisma.practitionerCredential.update).not.toHaveBeenCalled();
  });
  it('authorizes and audits a short-lived download link including historical scans', async () => {
    const { service, docs, audit } = setup();
    expect(await service.link('p1', 'c1', 'old-document', clinic, source)).toEqual({ url: 'signed-download', expiresAt: 'expires' });
    expect(docs.ownedDownloadLink).toHaveBeenCalledWith({ ownerType: 'PRACTITIONER', ownerId: 'p1' }, 'old-document', 'c1');
    expect(audit.record).toHaveBeenCalledWith(source, expect.objectContaining({ event: 'PRACTITIONER_DOCUMENT_LINK_ISSUED', facilityId: 'clinic-a' }));
  });
  it('uses serializable retries and bounded HTTP409 conflicts', async () => {
    const { service, prisma } = setup();
    const conflict = new Prisma.PrismaClientKnownRequestError('conflict', { code: 'P2034', clientVersion: 'test' });
    prisma.$transaction.mockRejectedValueOnce(conflict);
    await service.init('p1', 'c1', file, platform, source);
    expect(prisma.$transaction).toHaveBeenCalledTimes(2);
    expect(prisma.$transaction).toHaveBeenCalledWith(expect.any(Function), { isolationLevel: 'Serializable' });
    prisma.$transaction.mockReset().mockRejectedValue(conflict);
    await expect(service.init('p1', 'c1', file, platform, source)).rejects.toMatchObject({ code: 'CONCURRENT_CHANGE', status: 409 });
    expect(prisma.$transaction).toHaveBeenCalledTimes(3);
  });
});

describe('document endpoint permissions and input validation', () => {
  it.each(['list', 'init', 'complete', 'link'] as const)('requires reviewer permission for admin %s', (method) => {
    expect(Reflect.getMetadata(ACCESS_KEY, AdminPractitionerDocumentsController.prototype[method])).toEqual({ kind: 'platform', permissions: ['practitioner:review'] });
  });
  it.each(['list', 'init', 'complete', 'link'] as const)('requires facility affiliation management for clinic %s', (method) => {
    expect(Reflect.getMetadata(ACCESS_KEY, ClinicPractitionerDocumentsController.prototype[method])).toEqual({ kind: 'facility', permissions: ['affiliation:manage'] });
  });
  it.each([{ ...file, mimeType: 'text/html' }, { ...file, mimeType: 'toString' }, { ...file, sizeBytes: 0 }, { ...file, sizeBytes: 10 * 1024 * 1024 + 1 }, { ...file, sizeBytes: 1.5 }])('rejects unsafe declared files %j', async (input) => {
    expect((await validate(plainToInstance(PractitionerDocumentUploadDto, input))).length).toBeGreaterThan(0);
  });
  it('does not accept client-owned storage/credential/owner fields', async () => {
    const dto = plainToInstance(PractitionerDocumentUploadDto, { ...file, objectKey: 'injected', ownerId: 'other', credentialId: 'other' });
    expect((await validate(dto, { whitelist: true, forbidNonWhitelisted: true })).length).toBe(3);
    expect((await validate(plainToInstance(PractitionerDocumentCompleteDto, { documentId: 'invalid' }))).length).toBe(1);
  });
});
