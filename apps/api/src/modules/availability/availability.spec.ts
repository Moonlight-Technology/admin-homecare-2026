import type { PrismaService } from '../../prisma/prisma.service';
import type { AuditService } from '../audit/audit.service';
import { AvailabilityService } from './availability.service';
import { computeSlots, dayOfWeek, fitsVisit, localDate, localToUtc, windowsOverlap, type ScheduleWindow } from './slot-math';

const JKT = 'Asia/Jakarta';
// 2026-12-01 is a Tuesday.
const window = (overrides: Partial<ScheduleWindow> = {}): ScheduleWindow => ({ id: 'w1', mode: 'HOMECARE', dayOfWeek: 2, startTime: '08:00', endTime: '12:00', slotMinutes: 60, capacityPerSlot: 2, active: true, ...overrides });

describe('slot math', () => {
  it('converts Jakarta wall time to UTC and back', () => {
    expect(localToUtc('2026-12-01', 8 * 60, JKT).toISOString()).toBe('2026-12-01T01:00:00.000Z');
    expect(localToUtc('2026-12-01', 30, 'Asia/Jayapura').toISOString()).toBe('2026-11-30T15:30:00.000Z');
    expect(localDate(new Date('2026-11-30T18:00:00Z'), JKT)).toBe('2026-12-01');
    expect(dayOfWeek('2026-12-01')).toBe(2);
  });

  it('cuts active windows into slots and drops a partial last step', () => {
    const slots = computeSlots({ mode: 'HOMECARE', fromDate: '2026-12-01', days: 1, timezone: JKT, windows: [window({ endTime: '11:30' }), window({ id: 'w2', active: false, startTime: '13:00', endTime: '15:00' })], blocks: [], reserved: [] });
    expect(slots.map((slot) => slot.startsAt.toISOString())).toEqual(['2026-12-01T01:00:00.000Z', '2026-12-01T02:00:00.000Z', '2026-12-01T03:00:00.000Z']);
    expect(slots[0]).toMatchObject({ capacity: 2, reserved: 0, remaining: 2, blocked: false });
  });

  it('only uses windows of the requested mode and weekday', () => {
    const slots = computeSlots({ mode: 'ON_SITE', fromDate: '2026-12-01', days: 7, timezone: JKT, windows: [window(), window({ id: 'w2', mode: 'ON_SITE', dayOfWeek: 3 })], blocks: [], reserved: [] });
    expect(new Set(slots.map((slot) => localDate(slot.startsAt, JKT)))).toEqual(new Set(['2026-12-02']));
  });

  it('takes capacity and reservations from a materialised slot, and marks blocked slots', () => {
    const slots = computeSlots({
      mode: 'HOMECARE', fromDate: '2026-12-01', days: 1, timezone: JKT, windows: [window()],
      blocks: [{ mode: null, startsAt: localToUtc('2026-12-01', 10 * 60, JKT), endsAt: localToUtc('2026-12-01', 11 * 60, JKT) }],
      reserved: [{ mode: 'HOMECARE', startsAt: localToUtc('2026-12-01', 8 * 60, JKT), capacity: 3, reserved: 3 }],
    });
    expect(slots[0]).toMatchObject({ capacity: 3, reserved: 3, remaining: 0 });
    expect(slots.map((slot) => slot.blocked)).toEqual([false, false, true, false]);
  });

  it('fits a visit only when it ends inside the window, misses blocks, has room, and has not started', () => {
    const blocks = [{ mode: 'HOMECARE' as const, startsAt: localToUtc('2026-12-01', 10 * 60 + 30, JKT), endsAt: localToUtc('2026-12-01', 11 * 60, JKT) }];
    const slots = computeSlots({ mode: 'HOMECARE', fromDate: '2026-12-01', days: 1, timezone: JKT, windows: [window()], blocks, reserved: [] });
    const before = new Date('2026-11-30T00:00:00Z');
    // 08:00 and 09:00 end by 10:30 (the block starts then; touching is not overlapping); 10:00 runs into the block;
    // 11:00 would end after the window closes at 12:00.
    expect(slots.map((slot) => fitsVisit(slot, 90, blocks, before))).toEqual([true, true, false, false]);
    expect(fitsVisit(slots[0]!, 30, [], new Date('2026-12-01T01:00:00Z'))).toBe(false);
    expect(fitsVisit({ ...slots[0]!, remaining: 0 }, 30, [], before)).toBe(false);
  });

  it('detects overlapping windows but allows back-to-back ones', () => {
    expect(windowsOverlap({ startTime: '08:00', endTime: '12:00' }, { startTime: '11:00', endTime: '13:00' })).toBe(true);
    expect(windowsOverlap({ startTime: '08:00', endTime: '12:00' }, { startTime: '12:00', endTime: '13:00' })).toBe(false);
  });
});

function service(state: { siblings?: unknown[]; facility?: unknown; offerings?: unknown[] } = {}) {
  const writes: Array<[string, unknown]> = [];
  const prisma: Record<string, unknown> = {
    facility: { findUnique: jest.fn(async () => ({ timezone: JKT })), findFirst: jest.fn(async () => (state.facility === undefined ? { timezone: JKT } : state.facility)) },
    facilitySchedule: {
      findMany: jest.fn(async (args: { where: { dayOfWeek?: number } }) => (args.where.dayOfWeek === undefined ? [window()] : state.siblings ?? [])),
      findFirst: jest.fn(async () => ({ ...window(), updatedAt: new Date() })),
      create: jest.fn(async (args: unknown) => { writes.push(['schedule.create', args]); return { id: 'w-new' }; }),
      update: jest.fn(async (args: unknown) => { writes.push(['schedule.update', args]); return {}; }),
    },
    scheduleBlock: { findMany: jest.fn(async () => []), create: jest.fn(async (args: unknown) => { writes.push(['block.create', args]); return { id: 'b1' }; }) },
    facilitySlot: { findMany: jest.fn(async () => []) },
    serviceOffering: { findMany: jest.fn(async () => state.offerings ?? []) },
  };
  prisma.$transaction = jest.fn(async (run: (tx: unknown) => unknown) => run(prisma));
  const audit = { record: jest.fn(async () => undefined) } as unknown as AuditService;
  return { writes, availability: new AvailabilityService(prisma as unknown as PrismaService, audit) };
}

const source = { actorId: 'owner-1', scope: 'FACILITY' as const };

describe('schedules and blocks', () => {
  it('refuses a window that overlaps an active one of the same mode and day', async () => {
    const { availability, writes } = service({ siblings: [{ id: 'w1', startTime: '08:00', endTime: '12:00' }] });
    await expect(availability.createSchedule('f1', { mode: 'HOMECARE', dayOfWeek: 2, startTime: '11:00', endTime: '14:00', slotMinutes: 60, capacityPerSlot: 1 }, source)).rejects.toMatchObject({ code: 'SCHEDULE_OVERLAP' });
    expect(writes).toHaveLength(0);
  });

  it('refuses closing before opening and slots longer than the window', async () => {
    const { availability } = service();
    await expect(availability.createSchedule('f1', { mode: 'ON_SITE', dayOfWeek: 1, startTime: '12:00', endTime: '08:00', slotMinutes: 60, capacityPerSlot: 1 }, source)).rejects.toMatchObject({ details: { fields: { endTime: expect.any(Array) } } });
    await expect(availability.createSchedule('f1', { mode: 'ON_SITE', dayOfWeek: 1, startTime: '08:00', endTime: '08:30', slotMinutes: 60, capacityPerSlot: 1 }, source)).rejects.toMatchObject({ details: { fields: { slotMinutes: expect.any(Array) } } });
  });

  it('stores a whole-day block as local midnight to midnight in UTC', async () => {
    const { availability, writes } = service();
    await availability.createBlock('f1', { startDate: '2026-12-25', endDate: '2026-12-26', reason: 'Libur' }, source);
    expect(writes[0]![1]).toMatchObject({ data: { mode: null, startsAt: new Date('2026-12-24T17:00:00.000Z'), endsAt: new Date('2026-12-26T17:00:00.000Z') } });
  });

  it('validates block ranges', async () => {
    const { availability } = service();
    await expect(availability.createBlock('f1', { startDate: '2026-12-26', endDate: '2026-12-25' }, source)).rejects.toMatchObject({ code: 'VALIDATION_FAILED' });
    await expect(availability.createBlock('f1', { startDate: '2026-12-25', startTime: '12:00' }, source)).rejects.toMatchObject({ code: 'VALIDATION_FAILED' });
    await expect(availability.createBlock('f1', { startDate: '2026-12-25', endDate: '2026-12-26', startTime: '12:00', endTime: '13:00' }, source)).rejects.toMatchObject({ code: 'VALIDATION_FAILED' });
  });
});

describe('public slots', () => {
  it('replacement slots use a supplied snapshot duration without querying current offerings', async () => {
    const { availability } = service();
    const result = await availability.slotsForVisit('f1', 'HOMECARE', '2026-12-01', 150, new Date('2026-11-30T03:00:00Z'));
    expect(result.slots.map((slot) => slot.startsAt.toISOString())).toEqual(['2026-12-01T01:00:00.000Z', '2026-12-01T02:00:00.000Z']);
    expect(result.slots[0]!.endsAt.toISOString()).toBe('2026-12-01T03:30:00.000Z');
    await expect(availability.slotsForVisit('f1', 'HOMECARE', '2027-03-01', 60, new Date('2026-11-30'))).rejects.toMatchObject({ code: 'DATE_OUT_OF_RANGE' });
  });

  it('releases one place only from the owning clinic with positive capacity', async () => {
    const { availability } = service();
    const updateMany = jest.fn(async () => ({ count: 1 }));
    await availability.release({ facilitySlot: { updateMany } } as never, 's1', 'f1');
    expect(updateMany).toHaveBeenCalledWith({ where: { id: 's1', facilityId: 'f1', reserved: { gt: 0 } }, data: { reserved: { decrement: 1 }, version: { increment: 1 } } });
  });

  it('fails cancellation transaction instead of silently releasing missing/empty/foreign slots', async () => {
    const { availability } = service();
    await expect(availability.release({ facilitySlot: { updateMany: jest.fn(async () => ({ count: 0 })) } } as never, 's1', 'f2')).rejects.toMatchObject({ code: 'SLOT_RESERVATION_MISSING' });
  });

  const now = new Date('2026-11-30T03:00:00Z');

  it('is only available for public clinics within the booking horizon', async () => {
    await expect(service({ facility: null }).availability.publicSlots('f1', { date: '2026-12-01', mode: 'HOMECARE' }, now)).rejects.toMatchObject({ code: 'NOT_FOUND' });
    const { availability } = service();
    await expect(availability.publicSlots('f1', { date: '2026-11-29', mode: 'HOMECARE' }, now)).rejects.toMatchObject({ code: 'DATE_OUT_OF_RANGE' });
    await expect(availability.publicSlots('f1', { date: '2027-03-01', mode: 'HOMECARE' }, now)).rejects.toMatchObject({ code: 'DATE_OUT_OF_RANGE' });
  });

  it('needs every chosen service to be bookable here in this mode', async () => {
    const { availability } = service({ offerings: [{ id: 'o1', durationMinutes: 30 }] });
    await expect(availability.publicSlots('f1', { date: '2026-12-01', mode: 'HOMECARE', offeringIds: ['o1', 'o2'] }, now)).rejects.toMatchObject({ code: 'OFFERING_NOT_AVAILABLE' });
  });

  it('only offers start times where the summed duration fits the window', async () => {
    const { availability } = service({ offerings: [{ id: 'o1', durationMinutes: 90 }, { id: 'o2', durationMinutes: 60 }] });
    const result = await availability.publicSlots('f1', { date: '2026-12-01', mode: 'HOMECARE', offeringIds: ['o1', 'o2'] }, now);
    expect(result.durationMinutes).toBe(150);
    expect(result.slots.map((slot) => slot.startsAt.toISOString())).toEqual(['2026-12-01T01:00:00.000Z', '2026-12-01T02:00:00.000Z']);
    expect(result.slots[0]!.endsAt.toISOString()).toBe('2026-12-01T03:30:00.000Z');
  });
});
