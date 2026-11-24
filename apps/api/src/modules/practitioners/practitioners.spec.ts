import type { ConfigService } from '@nestjs/config';
import { CredentialCipher, maskCredentialNumber } from '../../common/crypto/credential-cipher';
import type { PrismaService } from '../../prisma/prisma.service';
import type { AuditService } from '../audit/audit.service';
import type { OutboxService } from '../notifications/outbox.service';
import { AffiliationsService } from './affiliations.service';
import { jakartaToday, missingForSubmission, PractitionersService } from './practitioners.service';

const KEY = 'test-credential-key-that-is-long-enough-123';
const source = { actorId: 'admin-1', scope: 'PLATFORM' as const };
const clinic = { actorId: 'owner-1', scope: 'FACILITY' as const };
const str = { credentialType: 'STR' as const, number: '3121 1002 2014 5678', issuingAuthority: 'KKI', validFrom: '2024-01-15', validUntil: null };
const registration = { fullName: 'dr. Rina Kusuma', practitionerTypeId: 'type-1', phone: null, email: 'rina@example.test', credentials: [str] };

const practitionerRecord = (overrides: Record<string, unknown> = {}) => ({
  id: 'pr1',
  fullName: 'dr. Rina Kusuma',
  practitionerTypeId: 'type-1',
  phone: null,
  email: 'rina@example.test',
  verificationStatus: 'SUBMITTED',
  operatingStatus: 'INACTIVE',
  verifiedAt: null,
  statusReason: null,
  registeredVia: 'ADMIN',
  createdByFacilityId: null,
  practitionerType: { id: 'type-1', code: 'DOKTER', name: 'Dokter' },
  credentials: [{ id: 'c1', credentialType: 'STR', numberMasked: '••••5678', validUntil: null }],
  affiliations: [],
  ...overrides,
});

const affiliationRecord = (overrides: Record<string, unknown> = {}) => ({
  id: 'a1',
  status: 'PROPOSED',
  startDate: null,
  facility: { id: 'f1', displayName: 'Klinik Sehat', verificationStatus: 'VERIFIED', operatingStatus: 'ACTIVE' },
  practitioner: { id: 'pr1', fullName: 'dr. Rina Kusuma', verificationStatus: 'VERIFIED', operatingStatus: 'ACTIVE' },
  ...overrides,
});

type State = {
  practitioner?: Record<string, unknown> | null;
  existingCredentials?: unknown[];
  movedCount?: number;
  facility?: Record<string, unknown> | null;
  affiliation?: Record<string, unknown> | null;
  liveAffiliation?: unknown;
};

/** Prisma double: records writes, answers reads from `state`, and runs transactions inline. */
function prismaDouble(state: State = {}) {
  const writes: Array<[string, unknown]> = [];
  const log = (name: string, result: unknown = {}) => jest.fn(async (args: unknown) => { writes.push([name, args]); return result; });
  const prisma: Record<string, unknown> = {
    practitionerType: { findFirst: jest.fn(async () => ({ id: 'type-1' })) },
    practitioner: {
      findUnique: jest.fn(async () => (state.practitioner === undefined ? practitionerRecord() : state.practitioner)),
      create: log('practitioner.create', { id: 'pr1', fullName: 'dr. Rina Kusuma', practitionerTypeId: 'type-1' }),
      update: log('practitioner.update'),
      updateMany: log('practitioner.updateMany', { count: state.movedCount ?? 1 }),
    },
    practitionerCredential: {
      findMany: jest.fn(async () => state.existingCredentials ?? []),
      createMany: log('practitionerCredential.createMany'),
      updateMany: log('practitionerCredential.updateMany'),
    },
    practitionerAffiliation: {
      findFirst: jest.fn(async () => state.liveAffiliation ?? (state.affiliation === undefined ? affiliationRecord() : state.affiliation)),
      findUnique: jest.fn(async () => (state.affiliation === undefined ? affiliationRecord() : state.affiliation)),
      create: log('practitionerAffiliation.create', { id: 'a1' }),
      updateMany: log('practitionerAffiliation.updateMany', { count: state.movedCount ?? 1 }),
    },
    facility: { findUnique: jest.fn(async () => (state.facility === undefined ? { id: 'f1', displayName: 'Klinik Sehat', verificationStatus: 'VERIFIED' } : state.facility)) },
    membership: { findFirst: jest.fn(async () => ({ user: { email: 'owner@klinik.test' } })) },
    verificationReview: { create: log('verificationReview.create'), findMany: jest.fn(async () => []) },
    document: { updateMany: log('document.updateMany') },
    user: { findMany: jest.fn(async () => []) },
  };
  prisma.$transaction = jest.fn(async (run: (tx: unknown) => unknown) => run(prisma));
  return { prisma: prisma as unknown as PrismaService, written: (name: string) => writes.filter(([key]) => key === name).map(([, args]) => args) };
}

function services(state: State = {}) {
  const double = prismaDouble(state);
  const audit = { record: jest.fn(async () => undefined) } as unknown as AuditService;
  const outbox = { enqueue: jest.fn(async () => undefined) } as unknown as OutboxService;
  const config = { getOrThrow: () => KEY } as unknown as ConfigService;
  const practitioners = new PractitionersService(double.prisma, audit, outbox, config);
  return { ...double, practitioners, affiliations: new AffiliationsService(double.prisma, practitioners, audit, outbox), audit, outbox };
}

describe('credential protection', () => {
  const cipher = new CredentialCipher(KEY);

  it('encrypts with a fresh IV each time and decrypts back', () => {
    const first = cipher.encrypt('31211002');
    expect(first).not.toEqual(cipher.encrypt('31211002'));
    expect(first).not.toContain('31211002');
    expect(cipher.decrypt(first)).toBe('31211002');
  });

  it('hashes the same number identically regardless of spacing or case, and masks all but the last four', () => {
    expect(cipher.hash('ab 12 34 56')).toBe(cipher.hash('AB123456'));
    expect(maskCredentialNumber('3121 1002 2014 5678')).toBe('••••••••••••5678');
  });

  it('rejects short keys', () => {
    expect(() => new CredentialCipher('short')).toThrow();
  });
});

describe('practitioner registration', () => {
  it('stores the number encrypted, masked, and hashed, and queues the practitioner for review', async () => {
    const { practitioners, written } = services();
    await expect(practitioners.register(registration, { via: 'ADMIN' }, source)).resolves.toBe('pr1');
    expect(written('practitioner.create')[0]).toMatchObject({ data: { verificationStatus: 'SUBMITTED', operatingStatus: 'INACTIVE', registeredVia: 'ADMIN', createdByFacilityId: null } });
    const [credential] = (written('practitionerCredential.createMany')[0] as { data: Array<Record<string, unknown>> }).data;
    expect(credential).toMatchObject({ credentialType: 'STR', numberMasked: '••••••••••••5678', practitionerId: 'pr1' });
    expect(JSON.stringify(credential)).not.toContain('312110022014');
    expect(credential).not.toHaveProperty('plain');
  });

  it('requires a valid STR', async () => {
    const { practitioners } = services();
    const sipOnly = { ...registration, credentials: [{ ...str, credentialType: 'SIP' as const }] };
    await expect(practitioners.register(sipOnly, { via: 'ADMIN' }, source)).rejects.toMatchObject({ code: 'VALIDATION_FAILED', details: { fields: { credentials: ['a valid STR is required'] } } });
    const expired = { ...registration, credentials: [{ ...str, validFrom: '2015-01-01', validUntil: '2020-01-01' }] };
    await expect(practitioners.register(expired, { via: 'ADMIN' }, source)).rejects.toMatchObject({ code: 'VALIDATION_FAILED' });
  });

  it('refuses a credential number that is already registered and names the practitioner (one identity)', async () => {
    const cipher = new CredentialCipher(KEY);
    const { practitioners, written } = services({ existingCredentials: [{ credentialType: 'STR', numberHash: cipher.hash(str.number), practitionerId: 'pr-existing' }] });
    await expect(practitioners.register(registration, { via: 'ADMIN' }, source)).rejects.toMatchObject({ code: 'PRACTITIONER_EXISTS', details: { practitionerId: 'pr-existing', fields: { 'credentials.0.number': ['this STR is already registered'] } } });
    expect(written('practitioner.create')).toHaveLength(0);
  });

  it('rejects a validity period that ends before it starts', async () => {
    const { practitioners } = services();
    const backwards = { ...registration, credentials: [{ ...str, validFrom: '2030-01-01', validUntil: '2029-01-01' }] };
    await expect(practitioners.register(backwards, { via: 'ADMIN' }, source)).rejects.toMatchObject({ details: { fields: { 'credentials.0.validUntil': ['validUntil must not be before validFrom'] } } });
  });
});

describe('practitioner verification', () => {
  it('requires a comment to request revision and a reason to reject', async () => {
    const { practitioners } = services();
    await expect(practitioners.decide('pr1', { decision: 'REJECT' }, source)).rejects.toMatchObject({ code: 'VALIDATION_FAILED' });
    await expect(practitioners.decide('pr1', { decision: 'REQUEST_REVISION', reason: 'ok' }, source)).rejects.toMatchObject({ code: 'VALIDATION_FAILED' });
  });

  it('approval verifies, activates an inactive practitioner, accepts credentials, and records the review', async () => {
    const { practitioners, written } = services();
    await practitioners.decide('pr1', { decision: 'APPROVE' }, source);
    expect(written('practitioner.updateMany')[0]).toMatchObject({ where: { id: 'pr1', verificationStatus: { in: ['SUBMITTED', 'UNDER_REVIEW'] } }, data: { verificationStatus: 'VERIFIED', operatingStatus: 'ACTIVE', statusReason: null } });
    expect(written('practitionerCredential.updateMany')[0]).toMatchObject({ data: { reviewStatus: 'ACCEPTED' } });
    expect(written('verificationReview.create')[0]).toMatchObject({ data: { targetType: 'PRACTITIONER', targetId: 'pr1', decision: 'APPROVE', reviewerId: 'admin-1' } });
  });

  it('lets only one reviewer decide', async () => {
    const { practitioners } = services({ movedCount: 0 });
    await expect(practitioners.decide('pr1', { decision: 'REJECT', reason: 'STR tidak terdaftar di KKI' }, source)).rejects.toMatchObject({ code: 'PRACTITIONER_ALREADY_DECIDED' });
  });

  it('snapshots the attached document IDs after taking the review lock and accepts only this practitioner documents', async () => {
    const { practitioners, written } = services({ existingCredentials: [{ documentId: 'scan-str' }, { documentId: 'scan-sip' }, { documentId: 'scan-str' }, { documentId: null }] });
    await practitioners.decide('pr1', { decision: 'APPROVE' }, source);
    expect(written('verificationReview.create')[0]).toMatchObject({ data: { documentIds: ['scan-str', 'scan-sip'] } });
    expect(written('document.updateMany')[0]).toEqual({ where: { id: { in: ['scan-str', 'scan-sip'] }, ownerType: 'PRACTITIONER', ownerId: 'pr1', status: 'UPLOADED' }, data: { status: 'ACCEPTED' } });
  });

  it('only activates verified practitioners and needs a reason to suspend', async () => {
    const unverified = services({ practitioner: practitionerRecord({ verificationStatus: 'REJECTED' }) });
    await expect(unverified.practitioners.changeStatus('pr1', { action: 'ACTIVATE' }, source)).rejects.toMatchObject({ code: 'PRACTITIONER_NOT_VERIFIED' });
    const active = services({ practitioner: practitionerRecord({ verificationStatus: 'VERIFIED', operatingStatus: 'ACTIVE' }) });
    await expect(active.practitioners.changeStatus('pr1', { action: 'SUSPEND' }, source)).rejects.toMatchObject({ code: 'VALIDATION_FAILED' });
  });

  it('treats a missing or expired STR as not ready', () => {
    const today = jakartaToday(new Date('2026-11-24T10:00:00Z'));
    expect(missingForSubmission([{ credentialType: 'STR', validUntil: null }], today)).toEqual({});
    expect(missingForSubmission([{ credentialType: 'STR', validUntil: new Date('2026-11-23T00:00:00Z') }], today)).toHaveProperty('credentials');
    expect(missingForSubmission([{ credentialType: 'SIP', validUntil: null }], today)).toHaveProperty('credentials');
  });
});

describe('clinic affiliations (spec §5.4)', () => {
  it('needs a verified clinic', async () => {
    const { affiliations } = services({ facility: { id: 'f1', displayName: 'Klinik', verificationStatus: 'SUBMITTED' } });
    await expect(affiliations.propose('f1', { practitionerId: 'pr1' }, clinic)).rejects.toMatchObject({ code: 'FACILITY_NOT_VERIFIED' });
  });

  it('refuses a second live affiliation for the same pair', async () => {
    const { affiliations, written } = services({ liveAffiliation: { status: 'ACTIVE' } });
    await expect(affiliations.propose('f1', { practitionerId: 'pr1' }, clinic)).rejects.toMatchObject({ code: 'AFFILIATION_EXISTS' });
    expect(written('practitionerAffiliation.create')).toHaveLength(0);
  });

  it('registers a new practitioner as CLINIC-registered and proposes them in one transaction', async () => {
    const { affiliations, written } = services({ liveAffiliation: null });
    await affiliations.propose('f1', { practitioner: registration, note: 'Dokter umum homecare' }, clinic);
    expect(written('practitioner.create')[0]).toMatchObject({ data: { registeredVia: 'CLINIC', createdByFacilityId: 'f1', verificationStatus: 'SUBMITTED' } });
    expect(written('practitionerAffiliation.create')[0]).toMatchObject({ data: { facilityId: 'f1', practitionerId: 'pr1', status: 'PROPOSED', note: 'Dokter umum homecare', proposedById: 'owner-1' } });
  });

  it('asks for exactly one of practitionerId or practitioner', async () => {
    const { affiliations } = services();
    await expect(affiliations.propose('f1', {}, clinic)).rejects.toMatchObject({ code: 'VALIDATION_FAILED' });
    await expect(affiliations.propose('f1', { practitionerId: 'pr1', practitioner: registration }, clinic)).rejects.toMatchObject({ code: 'VALIDATION_FAILED' });
  });

  it('approves only verified, unsuspended practitioners', async () => {
    const pending = services({ affiliation: affiliationRecord({ practitioner: { id: 'pr1', fullName: 'x', verificationStatus: 'SUBMITTED', operatingStatus: 'INACTIVE' } }) });
    await expect(pending.affiliations.adminDecide('a1', { decision: 'APPROVE' }, source)).rejects.toMatchObject({ code: 'PRACTITIONER_NOT_VERIFIED' });
    const suspended = services({ affiliation: affiliationRecord({ practitioner: { id: 'pr1', fullName: 'x', verificationStatus: 'VERIFIED', operatingStatus: 'SUSPENDED' } }) });
    await expect(suspended.affiliations.adminDecide('a1', { decision: 'APPROVE' }, source)).rejects.toMatchObject({ code: 'PRACTITIONER_SUSPENDED' });
  });

  it('approval activates a still-proposed affiliation and starts it today when no start date was given', async () => {
    const { affiliations, written } = services();
    await affiliations.adminDecide('a1', { decision: 'APPROVE' }, source);
    expect(written('practitionerAffiliation.updateMany')[0]).toMatchObject({ where: { id: 'a1', status: 'PROPOSED' }, data: { status: 'ACTIVE', reviewedById: 'admin-1', startDate: expect.any(Date) } });
  });

  it('needs a reason to end an affiliation and only ends active ones of the own clinic', async () => {
    const { affiliations, written } = services({ affiliation: { id: 'a1', status: 'ACTIVE', startDate: null } });
    await expect(affiliations.updateByClinic('f1', 'a1', { action: 'END' }, clinic)).rejects.toMatchObject({ code: 'VALIDATION_FAILED' });
    await affiliations.updateByClinic('f1', 'a1', { action: 'END', reason: 'Kontrak selesai' }, clinic).catch(() => undefined);
    expect(written('practitionerAffiliation.updateMany')[0]).toMatchObject({ where: { id: 'a1', facilityId: 'f1', status: 'ACTIVE' }, data: { status: 'ENDED', reason: 'Kontrak selesai', endedById: 'owner-1' } });
  });

  it('reports a withdrawal that lost the race', async () => {
    const { affiliations } = services({ affiliation: { id: 'a1', status: 'PROPOSED', startDate: null }, movedCount: 0 });
    await expect(affiliations.updateByClinic('f1', 'a1', { action: 'WITHDRAW' }, clinic)).rejects.toMatchObject({ code: 'AFFILIATION_STATE_CHANGED' });
  });
});
