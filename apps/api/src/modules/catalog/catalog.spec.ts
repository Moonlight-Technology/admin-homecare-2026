import { Prisma } from '@prisma/client';
import type { PrismaService } from '../../prisma/prisma.service';
import type { AuditService } from '../audit/audit.service';
import { OfferingsService, publishBlockers } from './offerings.service';
import { PublicCatalogService } from './public-catalog.service';

const source = { actorId: 'owner-1', scope: 'FACILITY' as const };
const verifiedActive = { verificationStatus: 'VERIFIED', operatingStatus: 'ACTIVE', provider: { id: 'prov-1', status: 'ACTIVE' } };

const offeringRecord = (overrides: Record<string, unknown> = {}) => ({
  id: 'off-1',
  providerId: 'prov-1',
  masterServiceId: 'ms-1',
  name: 'Cek darah lengkap',
  description: null,
  preparationNote: 'Puasa 8 jam',
  terms: null,
  basePrice: new Prisma.Decimal('150000'),
  currency: 'IDR',
  durationMinutes: 30,
  status: 'DRAFT',
  publishedAt: null,
  masterService: { id: 'ms-1', code: 'LAB_DARAH_LENGKAP', name: 'Darah lengkap', active: true, deletedAt: null, category: { id: 'cat-1', slug: 'laboratorium', name: 'Laboratorium' } },
  modes: [{ id: 'm1', mode: 'HOMECARE', enabled: true, priceOverride: null, visitFee: new Prisma.Decimal('50000') }],
  ...overrides,
});

/** Prisma double: records writes, answers reads from `state`, and runs transactions inline. */
function prismaDouble(state: { facility?: unknown; offering?: unknown; movedCount?: number; masterService?: unknown } = {}) {
  const writes: Array<[string, unknown]> = [];
  const log = (name: string, result: unknown = {}) => jest.fn(async (args: unknown) => { writes.push([name, args]); return result; });
  const prisma: Record<string, unknown> = {
    facility: { findUnique: jest.fn(async () => (state.facility === undefined ? verifiedActive : state.facility)), findFirst: jest.fn(async () => null), findMany: jest.fn(async () => []), count: jest.fn(async () => 0) },
    serviceOffering: {
      findFirst: jest.fn(async (args: { where: { providerId: string } }) => (args.where.providerId === 'prov-1' ? (state.offering === undefined ? offeringRecord() : state.offering) : null)),
      create: log('serviceOffering.create', { id: 'off-1', name: 'Cek darah lengkap', masterServiceId: 'ms-1' }),
      update: log('serviceOffering.update'),
      updateMany: log('serviceOffering.updateMany', { count: state.movedCount ?? 1 }),
      findMany: jest.fn(async () => []),
    },
    offeringMode: { upsert: log('offeringMode.upsert'), updateMany: log('offeringMode.updateMany') },
    masterService: { findFirst: jest.fn(async () => (state.masterService === undefined ? { id: 'ms-1' } : state.masterService)) },
  };
  prisma.$transaction = jest.fn(async (run: (tx: unknown) => unknown) => run(prisma));
  return { prisma: prisma as unknown as PrismaService, written: (name: string) => writes.filter(([key]) => key === name).map(([, args]) => args) };
}

function services(state: Parameters<typeof prismaDouble>[0] = {}) {
  const double = prismaDouble(state);
  const audit = { record: jest.fn(async () => undefined) } as unknown as AuditService;
  return { ...double, audit, offerings: new OfferingsService(double.prisma, audit), catalog: new PublicCatalogService(double.prisma) };
}

const create = { masterServiceId: 'ms-1', name: 'Cek darah lengkap', basePrice: '150000', durationMinutes: 30, modes: [{ mode: 'HOMECARE' as const, visitFee: '50000' }] };

describe('publish rules (spec §5.3, AC-FAC-05)', () => {
  const facility = { verificationStatus: 'VERIFIED', operatingStatus: 'ACTIVE', providerStatus: 'ACTIVE' };

  it('accepts a complete offering of a verified, active clinic', () => {
    expect(publishBlockers(offeringRecord() as never, facility)).toEqual([]);
  });

  it('names every reason an offering cannot be public', () => {
    const blocked = publishBlockers(offeringRecord({ masterService: { ...offeringRecord().masterService, active: false }, modes: [{ mode: 'ON_SITE', enabled: false }] }) as never, { verificationStatus: 'SUBMITTED', operatingStatus: 'SUSPENDED', providerStatus: 'SUSPENDED' });
    expect(blocked).toEqual(['FACILITY_NOT_VERIFIED', 'FACILITY_NOT_ACTIVE', 'MASTER_SERVICE_INACTIVE', 'NO_ENABLED_MODE']);
  });
});

describe('clinic offerings', () => {
  it('creates a draft under the clinic provider with its modes (AC-SVC-01)', async () => {
    const { offerings, written } = services();
    await offerings.create('f1', create, source);
    expect(written('serviceOffering.create')[0]).toMatchObject({ data: { providerId: 'prov-1', masterServiceId: 'ms-1', status: 'DRAFT', basePrice: '150000', modes: { create: [{ mode: 'HOMECARE', enabled: true, visitFee: '50000', priceOverride: null }] } } });
  });

  it('refuses an inactive master service, a duplicated mode, and a visit fee on on-site', async () => {
    await expect(services({ masterService: null }).offerings.create('f1', create, source)).rejects.toMatchObject({ code: 'INVALID_REFERENCE' });
    const { offerings } = services();
    await expect(offerings.create('f1', { ...create, modes: [{ mode: 'HOMECARE' }, { mode: 'HOMECARE' }] }, source)).rejects.toMatchObject({ details: { fields: { 'modes.1.mode': expect.any(Array) } } });
    await expect(offerings.create('f1', { ...create, modes: [{ mode: 'ON_SITE', visitFee: '10000' }] }, source)).rejects.toMatchObject({ details: { fields: { 'modes.0.visitFee': expect.any(Array) } } });
  });

  it("answers 404 for another clinic's offering (AC-SVC-02)", async () => {
    const { offerings } = services({ facility: { ...verifiedActive, provider: { id: 'prov-2', status: 'ACTIVE' } } });
    await expect(offerings.detail('f2', 'off-1')).rejects.toMatchObject({ code: 'NOT_FOUND' });
    await expect(offerings.publish('f2', 'off-1', source)).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });

  it('blocks publishing for an unverified or suspended clinic (AC-FAC-05)', async () => {
    const unverified = services({ facility: { ...verifiedActive, verificationStatus: 'SUBMITTED' } });
    await expect(unverified.offerings.publish('f1', 'off-1', source)).rejects.toMatchObject({ code: 'OFFERING_NOT_PUBLISHABLE', details: { blockers: ['FACILITY_NOT_VERIFIED'] } });
    const suspended = services({ facility: { ...verifiedActive, operatingStatus: 'SUSPENDED', provider: { id: 'prov-1', status: 'SUSPENDED' } } });
    await expect(suspended.offerings.publish('f1', 'off-1', source)).rejects.toMatchObject({ details: { blockers: ['FACILITY_NOT_ACTIVE'] } });
  });

  it('publishes with a conditional update and records the publication', async () => {
    const { offerings, written, audit } = services();
    await offerings.publish('f1', 'off-1', source);
    expect(written('serviceOffering.updateMany')[0]).toMatchObject({ where: { id: 'off-1', status: { in: ['DRAFT', 'UNPUBLISHED'] } }, data: { status: 'PUBLISHED', publishedAt: expect.any(Date) } });
    expect(audit.record).toHaveBeenCalledWith(source, expect.objectContaining({ event: 'OFFERING_PUBLISHED', facilityId: 'f1' }), expect.anything());
  });

  it('reports a publication that lost the race', async () => {
    const { offerings } = services({ movedCount: 0 });
    await expect(offerings.publish('f1', 'off-1', source)).rejects.toMatchObject({ code: 'OFFERING_STATE_CHANGED' });
  });

  it('keeps a published offering bookable: disabling every mode must unpublish first', async () => {
    const { offerings, written } = services({ offering: offeringRecord({ status: 'PUBLISHED' }) });
    await expect(offerings.update('f1', 'off-1', { modes: [{ mode: 'HOMECARE', enabled: false }] }, source)).rejects.toMatchObject({ code: 'OFFERING_WOULD_BREAK' });
    expect(written('serviceOffering.update')).toHaveLength(0);
  });

  it('locks the master service after the draft stage and makes archived offerings read-only', async () => {
    const published = services({ offering: offeringRecord({ status: 'UNPUBLISHED' }) });
    await expect(published.offerings.update('f1', 'off-1', { masterServiceId: 'ms-2' }, source)).rejects.toMatchObject({ code: 'MASTER_SERVICE_LOCKED' });
    const archived = services({ offering: offeringRecord({ status: 'ARCHIVED' }) });
    await expect(archived.offerings.update('f1', 'off-1', { name: 'Baru' }, source)).rejects.toMatchObject({ code: 'OFFERING_ARCHIVED' });
  });

  it('replaces modes: listed modes are upserted, the others disabled', async () => {
    const { offerings, written } = services();
    await offerings.update('f1', 'off-1', { modes: [{ mode: 'ON_SITE', priceOverride: '120000' }] }, source);
    expect(written('offeringMode.upsert')[0]).toMatchObject({ where: { offeringId_mode: { offeringId: 'off-1', mode: 'ON_SITE' } }, update: { enabled: true, priceOverride: '120000', visitFee: null } });
    expect(written('offeringMode.updateMany')[0]).toMatchObject({ where: { offeringId: 'off-1', mode: 'HOMECARE' }, data: { enabled: false } });
  });

  it('must unpublish before archiving', async () => {
    const { offerings } = services({ offering: offeringRecord({ status: 'PUBLISHED' }) });
    await expect(offerings.archive('f1', 'off-1', source)).rejects.toMatchObject({ code: 'OFFERING_PUBLISHED' });
  });
});

describe('public catalog', () => {
  it('only lists verified, active clinics with an active provider and something bookable', async () => {
    const { catalog, prisma } = services();
    await catalog.facilities({ page: 1, limit: 20, sortOrder: 'asc', mode: 'HOMECARE' });
    const where = (prisma.facility.findMany as jest.Mock).mock.calls[0][0].where;
    expect(where).toMatchObject({ verificationStatus: 'VERIFIED', operatingStatus: 'ACTIVE', provider: { status: 'ACTIVE', offerings: { some: { status: 'PUBLISHED', modes: { some: { enabled: true, mode: 'HOMECARE' } } } } } });
  });

  it('hides clinics that are not public', async () => {
    const { catalog } = services();
    await expect(catalog.facility('f-hidden')).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });
});
