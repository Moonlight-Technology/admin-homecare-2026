import type { PrismaService } from '../../prisma/prisma.service';
import { DashboardService, jakartaDayBounds } from './dashboard.service';

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
