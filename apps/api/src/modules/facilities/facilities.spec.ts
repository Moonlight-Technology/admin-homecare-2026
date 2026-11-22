import type { PrismaService } from '../../prisma/prisma.service';
import type { AuditService } from '../audit/audit.service';
import type { AccountTokensService } from '../auth/account-tokens.service';
import type { PasswordService } from '../auth/password.service';
import type { DocumentsService } from '../documents/documents.service';
import type { OutboxService } from '../notifications/outbox.service';
import { FacilitiesService, missingProfileFields } from './facilities.service';
import { latestDocumentByRequirement, missingDocuments, VerificationService } from './verification.service';

const source = { actorId: 'admin-1', scope: 'PLATFORM' as const };
const profile = { displayName: 'Klinik Sehat', legalName: 'PT Sehat', facilityTypeId: 'type-1', clinicClassId: null, capabilityIds: ['cap-1'], phone: '0215550123', addressLine: 'Jl. Melati 10' };

const facilityRecord = (overrides: Record<string, unknown> = {}) => ({
  id: 'f1',
  ...profile,
  email: null,
  regionCode: null,
  postalCode: null,
  latitude: null,
  longitude: null,
  timezone: 'Asia/Jakarta',
  verificationStatus: 'DRAFT',
  operatingStatus: 'INACTIVE',
  verifiedAt: null,
  statusReason: null,
  registeredVia: 'SELF',
  facilityType: { id: 'type-1', code: 'KLINIK', name: 'Klinik' },
  clinicClass: null,
  capabilities: [{ capability: { id: 'cap-1', code: 'RAWAT_JALAN', name: 'Rawat jalan' } }],
  provider: { id: 'p1', status: 'INACTIVE' },
  memberships: [{ user: { id: 'owner-1', name: 'Owner', email: 'owner@klinik.test', status: 'ACTIVE' } }],
  ...overrides,
});

/** Prisma double: records writes, answers reads from `state`, and runs transactions inline. */
function prismaDouble(state: { facility?: Record<string, unknown> | null; user?: unknown; application?: unknown; decidedCount?: number; movedCount?: number } = {}) {
  const writes: Array<[string, unknown]> = [];
  const log = (name: string, result: unknown = {}) => jest.fn(async (args: unknown) => { writes.push([name, args]); return result; });
  const prisma: Record<string, unknown> = {
    facilityType: { findFirst: jest.fn(async () => ({ id: 'type-1' })) },
    clinicClass: { findFirst: jest.fn(async () => ({ id: 'class-1' })) },
    capability: { findMany: jest.fn(async (args: { where: { id: { in: string[] } } }) => args.where.id.in.map((id) => ({ id }))) },
    region: { findUnique: jest.fn(async () => null) },
    user: { findUnique: jest.fn(async () => state.user ?? null), findMany: jest.fn(async () => []), create: log('user.create', { id: 'owner-1', email: 'owner@klinik.test', name: 'Owner' }) },
    facility: {
      findUnique: jest.fn(async () => (state.facility === undefined ? facilityRecord() : state.facility)),
      create: log('facility.create', { id: 'f1', displayName: 'Klinik Sehat' }),
      update: log('facility.update'),
      updateMany: log('facility.updateMany', { count: state.movedCount ?? 1 }),
    },
    facilityCapability: { createMany: log('facilityCapability.createMany'), deleteMany: log('facilityCapability.deleteMany') },
    provider: { create: log('provider.create'), updateMany: log('provider.updateMany') },
    role: { findUnique: jest.fn(async () => ({ id: 'role-owner' })) },
    membership: { create: log('membership.create'), findFirst: jest.fn(async () => ({ user: { email: 'owner@klinik.test' } })) },
    facilityApplication: {
      findUnique: jest.fn(async () => state.application ?? null),
      findMany: jest.fn(async () => []),
      aggregate: jest.fn(async () => ({ _max: { version: 2 } })),
      create: log('facilityApplication.create', { id: 'app-3', version: 3 }),
      updateMany: log('facilityApplication.updateMany', { count: state.decidedCount ?? 1 }),
    },
    verificationReview: { create: log('verificationReview.create'), findMany: jest.fn(async () => []) },
    document: { updateMany: log('document.updateMany') },
    documentRequirement: { findMany: jest.fn(async () => [{ id: 'req-1', code: 'IZIN_OPERASIONAL', name: 'Izin operasional', description: null, mandatory: true }]) },
  };
  prisma.$transaction = jest.fn(async (run: (tx: unknown) => unknown) => run(prisma));
  return { prisma: prisma as unknown as PrismaService, writes, written: (name: string) => writes.filter(([key]) => key === name).map(([, args]) => args) };
}

function services(state: Parameters<typeof prismaDouble>[0] = {}, documents: unknown[] = []) {
  const double = prismaDouble(state);
  const audit = { record: jest.fn(async () => undefined) } as unknown as AuditService;
  const outbox = { enqueue: jest.fn(async () => undefined) } as unknown as OutboxService;
  const tokens = { issueInvitation: jest.fn(async () => undefined) } as unknown as AccountTokensService;
  const passwords = { hash: jest.fn(async () => 'hashed') } as unknown as PasswordService;
  const docs = { listForOwner: jest.fn(async () => documents), listByIds: jest.fn(async () => documents), downloadLink: () => ({ url: 'u', expiresAt: new Date() }) } as unknown as DocumentsService;
  const facilities = new FacilitiesService(double.prisma, audit, passwords, tokens);
  return { ...double, facilities, verification: new VerificationService(double.prisma, facilities, docs, audit, outbox), audit, tokens };
}

describe('clinic registration (AC-FAC-01)', () => {
  it('creates an active owner, an unverified inactive facility, its provider, and an owner membership', async () => {
    const { facilities, written } = services();
    await expect(facilities.register({ owner: { name: 'Owner', email: 'owner@klinik.test', password: 'very-strong-password' }, facility: profile }, { actorId: null, scope: 'PUBLIC' })).resolves.toEqual({ facilityId: 'f1' });
    expect(written('user.create')[0]).toMatchObject({ data: { status: 'ACTIVE', passwordHash: 'hashed' } });
    expect(written('facility.create')[0]).toMatchObject({ data: { verificationStatus: 'DRAFT', operatingStatus: 'INACTIVE', registeredVia: 'SELF' } });
    expect(written('provider.create')[0]).toMatchObject({ data: { type: 'FACILITY', facilityId: 'f1', status: 'INACTIVE' } });
    expect(written('membership.create')[0]).toMatchObject({ data: { scopeType: 'FACILITY', facilityId: 'f1', roleId: 'role-owner' } });
  });

  it('rejects a registered email with the nested field name', async () => {
    const { facilities } = services({ user: { id: 'someone' } });
    await expect(facilities.register({ owner: { name: 'O', email: 'taken@klinik.test', password: 'very-strong-password' }, facility: profile }, { actorId: null, scope: 'PUBLIC' })).rejects.toMatchObject({ code: 'DUPLICATE', details: { fields: { 'owner.email': expect.any(Array) } } });
  });

  it('invites an admin-created owner without a password and keeps the facility unverified (spec §5.2)', async () => {
    const { facilities, written, tokens } = services();
    await facilities.adminCreate({ owner: { name: 'Owner', email: 'owner@klinik.test' }, facility: profile }, source);
    expect(written('user.create')[0]).toMatchObject({ data: { status: 'INVITED' } });
    expect((written('user.create')[0] as { data: Record<string, unknown> }).data.passwordHash).toBeUndefined();
    expect(written('facility.create')[0]).toMatchObject({ data: { verificationStatus: 'DRAFT', registeredVia: 'ADMIN' } });
    expect(tokens.issueInvitation).toHaveBeenCalled();
  });
});

describe('facility profile and status rules', () => {
  it('locks clinic edits while the submission is under review', async () => {
    const { facilities } = services({ facility: facilityRecord({ verificationStatus: 'UNDER_REVIEW' }) });
    await expect(facilities.updateProfile('f1', { phone: '0215550999' }, source, 'CLINIC')).rejects.toMatchObject({ code: 'FACILITY_LOCKED_FOR_REVIEW' });
  });

  it('keeps the verified legal identity for the platform to change', async () => {
    const verified = { facility: facilityRecord({ verificationStatus: 'VERIFIED' }) };
    await expect(services(verified).facilities.updateProfile('f1', { legalName: 'PT Lain' }, source, 'CLINIC')).rejects.toMatchObject({ code: 'VERIFIED_FIELDS_LOCKED' });
    await expect(services(verified).facilities.updateProfile('f1', { phone: '0215550999' }, source, 'CLINIC')).resolves.toBeDefined();
    await expect(services(verified).facilities.updateProfile('f1', { legalName: 'PT Lain' }, source, 'PLATFORM')).resolves.toBeDefined();
  });

  it('activates only verified facilities and requires a reason to suspend (AC-FAC-05)', async () => {
    await expect(services().facilities.changeStatus('f1', { action: 'ACTIVATE' }, source)).rejects.toMatchObject({ code: 'FACILITY_NOT_VERIFIED' });
    const active = { facility: facilityRecord({ verificationStatus: 'VERIFIED', operatingStatus: 'ACTIVE' }) };
    await expect(services(active).facilities.changeStatus('f1', { action: 'SUSPEND' }, source)).rejects.toMatchObject({ details: { fields: { reason: expect.any(Array) } } });
    const { facilities, written } = services(active);
    await facilities.changeStatus('f1', { action: 'SUSPEND', reason: 'Izin operasional kedaluwarsa' }, source);
    expect(written('provider.updateMany')[0]).toMatchObject({ data: { status: 'SUSPENDED' } });
  });
});

describe('verification submission (AC-FAC-02)', () => {
  const uploaded = [{ id: 'doc-1', requirementId: 'req-1', status: 'UPLOADED', uploadedAt: new Date() }];

  it('lists missing profile fields and mandatory documents per field', async () => {
    const { verification } = services({ facility: facilityRecord({ phone: null, capabilities: [] }) });
    await expect(verification.submit('f1', { ...source, scope: 'FACILITY' })).rejects.toMatchObject({
      code: 'APPLICATION_INCOMPLETE',
      details: { fields: { 'profile.phone': expect.any(Array), 'profile.capabilityIds': expect.any(Array), 'documents.IZIN_OPERASIONAL': expect.any(Array) } },
    });
  });

  it('creates the next version with a snapshot and the latest documents', async () => {
    const { verification, written } = services({}, uploaded);
    await expect(verification.submit('f1', { ...source, scope: 'FACILITY' })).resolves.toEqual({ applicationId: 'app-3', version: 3 });
    expect(written('facilityApplication.create')[0]).toMatchObject({ data: { version: 3, status: 'SUBMITTED', documentIds: ['doc-1'], profileSnapshot: expect.objectContaining({ displayName: 'Klinik Sehat' }) } });
  });

  it('refuses to submit while a submission is already under review', async () => {
    const { verification } = services({ facility: facilityRecord({ verificationStatus: 'SUBMITTED' }) }, uploaded);
    await expect(verification.submit('f1', { ...source, scope: 'FACILITY' })).rejects.toMatchObject({ code: 'APPLICATION_NOT_SUBMITTABLE' });
  });
});

describe('verification decisions (AC-FAC-03, AC-FAC-04)', () => {
  const application = { id: 'app-3', facilityId: 'f1', status: 'UNDER_REVIEW', documentIds: ['doc-1'], facility: { id: 'f1', displayName: 'Klinik Sehat', operatingStatus: 'INACTIVE' } };

  it('requires a comment to request revision and a reason to reject', async () => {
    const { verification } = services({ application });
    await expect(verification.decide('app-3', { decision: 'REQUEST_REVISION' }, source)).rejects.toMatchObject({ details: { fields: { reason: expect.any(Array) } } });
    await expect(verification.decide('app-3', { decision: 'REJECT', reason: '  ' }, source)).rejects.toMatchObject({ code: 'VALIDATION_FAILED' });
  });

  it('approval verifies, activates, records the reviewer, and accepts the submitted documents', async () => {
    const { verification, written } = services({ application, facility: facilityRecord({ verificationStatus: 'VERIFIED' }) });
    await verification.decide('app-3', { decision: 'APPROVE' }, source);
    expect(written('verificationReview.create')[0]).toMatchObject({ data: { decision: 'APPROVE', reviewerId: 'admin-1', targetId: 'app-3' } });
    expect(written('facility.update')[0]).toMatchObject({ data: { verificationStatus: 'VERIFIED', operatingStatus: 'ACTIVE', verifiedAt: expect.any(Date) } });
    expect(written('document.updateMany')[0]).toMatchObject({ data: { status: 'ACCEPTED' } });
  });

  it('revision keeps earlier history: it only appends a review', async () => {
    const { verification, writes } = services({ application });
    await verification.decide('app-3', { decision: 'REQUEST_REVISION', reason: 'Dokumen izin buram, mohon unggah ulang.' }, source);
    expect(writes.some(([name]) => name.includes('delete'))).toBe(false);
  });

  it('returns 409 when another reviewer decided first, without writing a review', async () => {
    const { verification, written } = services({ application, decidedCount: 0 });
    await expect(verification.decide('app-3', { decision: 'APPROVE' }, source)).rejects.toMatchObject({ code: 'APPLICATION_ALREADY_DECIDED' });
    expect(written('verificationReview.create')).toHaveLength(0);
  });
});

describe('submission helpers', () => {
  it('picks the newest usable document per requirement', () => {
    const latest = latestDocumentByRequirement([
      { id: 'old', requirementId: 'r', status: 'UPLOADED', uploadedAt: new Date('2026-11-01') },
      { id: 'new', requirementId: 'r', status: 'UPLOADED', uploadedAt: new Date('2026-11-20') },
      { id: 'pending', requirementId: 'r', status: 'PENDING_UPLOAD', uploadedAt: null },
    ]);
    expect(latest.get('r')?.id).toBe('new');
    expect(missingDocuments([{ id: 'r2', code: 'NPWP', name: 'NPWP', description: null, mandatory: true }], latest)).toEqual({ 'documents.NPWP': ['NPWP is required'] });
    expect(missingProfileFields({ ...profile, capabilities: [{}] })).toEqual({});
  });
});
