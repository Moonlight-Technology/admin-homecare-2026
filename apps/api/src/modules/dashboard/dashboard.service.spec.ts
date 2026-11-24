import type { PrismaService } from '../../prisma/prisma.service';
import { DashboardService, jakartaDayBounds, orderExceptionReasons, orderExceptionWheres } from './dashboard.service';

describe('order exceptions', () => {
  const now = new Date('2026-11-24T10:00:00Z');
  const at = (iso: string) => new Date(iso);

  it('flags pending and confirmed orders whose visit start has passed', () => {
    expect(orderExceptionReasons({ status: 'PENDING_APPROVAL', assignmentStatus: 'UNASSIGNED', scheduledAt: at('2026-11-24T10:00:00Z') }, now)).toEqual(['PENDING_PAST_SCHEDULE']);
    expect(orderExceptionReasons({ status: 'CONFIRMED', assignmentStatus: 'ASSIGNED', scheduledAt: at('2026-11-24T09:00:00Z') }, now)).toEqual(['NOT_STARTED_PAST_SCHEDULE']);
    expect(orderExceptionReasons({ status: 'PENDING_APPROVAL', assignmentStatus: 'UNASSIGNED', scheduledAt: at('2026-11-24T10:01:00Z') }, now)).toEqual([]);
  });

  it('flags confirmed visits without full assignment inside the next 24 hours only', () => {
    expect(orderExceptionReasons({ status: 'CONFIRMED', assignmentStatus: 'PARTIALLY_ASSIGNED', scheduledAt: at('2026-11-25T09:59:00Z') }, now)).toEqual(['UNASSIGNED_SOON']);
    expect(orderExceptionReasons({ status: 'CONFIRMED', assignmentStatus: 'UNASSIGNED', scheduledAt: at('2026-11-25T10:00:00Z') }, now)).toEqual([]);
    expect(orderExceptionReasons({ status: 'CONFIRMED', assignmentStatus: 'UNASSIGNED', scheduledAt: at('2026-11-24T08:00:00Z') }, now))
      .toEqual(['NOT_STARTED_PAST_SCHEDULE', 'UNASSIGNED_SOON']);
  });

  it('ignores in-progress and terminal orders', () => {
    for (const status of ['IN_PROGRESS', 'COMPLETED', 'CANCELLED', 'REJECTED', 'EXPIRED', 'NO_SHOW']) {
      expect(orderExceptionReasons({ status, assignmentStatus: 'UNASSIGNED', scheduledAt: at('2026-11-24T08:00:00Z') }, now)).toEqual([]);
    }
  });

  it('builds database filters with the same boundaries', () => {
    const wheres = orderExceptionWheres(now);
    expect(wheres.PENDING_PAST_SCHEDULE).toEqual({ status: 'PENDING_APPROVAL', scheduledAt: { lte: now } });
    expect(wheres.NOT_STARTED_PAST_SCHEDULE).toEqual({ status: 'CONFIRMED', scheduledAt: { lte: now } });
    expect(wheres.UNASSIGNED_SOON).toEqual({ status: 'CONFIRMED', assignmentStatus: { not: 'ASSIGNED' }, scheduledAt: { lt: at('2026-11-25T10:00:00Z') } });
  });
});

describe('DashboardService.platformSummary', () => {
  it('returns exception counts and rows without patient data', async () => {
    const now = new Date('2026-11-24T10:00:00Z');
    const selects: unknown[] = [];
    const exceptionRow = { id: 'o1', code: 'NK-1', status: 'PENDING_APPROVAL', mode: 'HOMECARE', assignmentStatus: 'UNASSIGNED', scheduledAt: new Date('2026-11-24T09:00:00Z'), createdAt: now, facility: { displayName: 'Klinik A' }, _count: { items: 2 } };
    const prisma = {
      facility: { count: jest.fn(async () => 0), findMany: jest.fn(async () => []) },
      practitioner: { count: jest.fn(async () => 0), findMany: jest.fn(async () => []) },
      order: {
        count: jest.fn(async () => 1),
        findMany: jest.fn(async (args: { where?: { OR?: unknown }; select: unknown }) => { selects.push(args.select); return args.where?.OR ? [exceptionRow] : []; }),
      },
    } as unknown as PrismaService;

    const summary = await new DashboardService(prisma).platformSummary(now);

    expect(summary.exceptions.total).toBe(1);
    expect(summary.exceptions.counts).toEqual({ pendingPastSchedule: 1, notStartedPastSchedule: 1, unassignedSoon: 1 });
    expect(summary.exceptions.orders).toEqual([expect.objectContaining({ code: 'NK-1', facilityName: 'Klinik A', itemCount: 2, reasons: ['PENDING_PAST_SCHEDULE'] })]);
    for (const select of selects) expect(JSON.stringify(select)).not.toMatch(/patient|address/i);
  });
});

describe('jakartaDayBounds', () => {
  it('uses the Jakarta calendar day, not the UTC one', () => {
    // 23:30 UTC on the 21st is already 06:30 on the 22nd in Jakarta.
    const { start, end } = jakartaDayBounds(new Date('2026-11-21T23:30:00Z'));
    expect(start.toISOString()).toBe('2026-11-21T17:00:00.000Z');
    expect(end.toISOString()).toBe('2026-11-22T17:00:00.000Z');
  });
});

describe('DashboardService.clinicSummary', () => {
  it('scopes every query to the caller facility (AC-ORD-07)', async () => {
    const wheres: unknown[] = [];
    const record = (result: unknown) => jest.fn(async (args: { where: unknown }) => { wheres.push(args.where); return result; });
    const prisma = {
      facility: { findUniqueOrThrow: record({ id: 'facility-a', displayName: 'A', verificationStatus: 'VERIFIED', operatingStatus: 'ACTIVE' }) },
      order: { count: record(0), findMany: record([]) },
      serviceOffering: { count: record(0) },
    } as unknown as PrismaService;

    await new DashboardService(prisma).clinicSummary('facility-a');

    expect(wheres.length).toBe(7);
    for (const where of wheres) {
      const scoped = JSON.stringify(where);
      expect(scoped.includes('"facilityId":"facility-a"') || scoped.includes('"id":"facility-a"')).toBe(true);
    }
  });
});
