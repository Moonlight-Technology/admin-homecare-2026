import type { ExecutionContext } from '@nestjs/common';
import type { ConfigService } from '@nestjs/config';
import { Prisma } from '@prisma/client';
import type { PrismaService } from '../../prisma/prisma.service';
import type { AuditService } from '../audit/audit.service';
import type { AvailabilityService } from '../availability/availability.service';
import type { OutboxService } from '../notifications/outbox.service';
import { BookingKeyGuard } from './booking-key.guard';
import { BookingsService, orderCode } from './bookings.service';
import { canTransition, transitionItem, transitionOrder } from './order-state';
import { assignmentStatusOf, maskName, maskPhone, OrdersService, visitMinutes } from './orders.service';
import type { OrderExpiryService } from './order-expiry.service';

const source = { actorId: 'staff-1', scope: 'FACILITY' as const };

describe('order state machine (spec §6)', () => {
  it('allows only the documented transitions', () => {
    expect(canTransition('PENDING_APPROVAL', 'CONFIRMED')).toBe(true);
    expect(canTransition('PENDING_APPROVAL', 'IN_PROGRESS')).toBe(false); // AC-ORD-08
    expect(canTransition('CONFIRMED', 'COMPLETED')).toBe(false);
    expect(canTransition('REJECTED', 'CONFIRMED')).toBe(false);
    expect(canTransition('PENDING_APPROVAL', 'CANCELLED')).toBe(true);
    expect(canTransition('CONFIRMED', 'CANCELLED')).toBe(true);
    expect(canTransition('IN_PROGRESS', 'CANCELLED')).toBe(false);
    expect(canTransition('CANCELLED', 'CONFIRMED')).toBe(false);
  });

  it('updates conditionally on status and version and writes history (AC-ORD-06)', async () => {
    const writes: unknown[] = [];
    const tx = { order: { updateMany: jest.fn(async (args: unknown) => { writes.push(args); return { count: 1 }; }) }, orderStatusHistory: { create: jest.fn(async (args: unknown) => { writes.push(args); }) } };
    await transitionOrder(tx as never, { id: 'o1', status: 'PENDING_APPROVAL', version: 3 }, 'REJECTED', 'staff-1', 'Jadwal penuh', { rejectionReason: 'Jadwal penuh' });
    expect(writes[0]).toMatchObject({ where: { id: 'o1', status: 'PENDING_APPROVAL', version: 3 }, data: { status: 'REJECTED', version: { increment: 1 }, rejectionReason: 'Jadwal penuh' } });
    expect(writes[1]).toMatchObject({ data: { orderId: 'o1', previousStatus: 'PENDING_APPROVAL', newStatus: 'REJECTED', actorId: 'staff-1', reason: 'Jadwal penuh' } });
  });

  it('gives the losing concurrent transition a conflict and no history', async () => {
    const history = jest.fn();
    const tx = { order: { updateMany: jest.fn(async () => ({ count: 0 })) }, orderStatusHistory: { create: history } };
    await expect(transitionOrder(tx as never, { id: 'o1', status: 'PENDING_APPROVAL', version: 3 }, 'CONFIRMED', 'staff-2', null)).rejects.toMatchObject({ code: 'ORDER_STATE_CHANGED' });
    expect(history).not.toHaveBeenCalled();
  });

  it('needs a reason for a service that was not performed', async () => {
    const tx = { orderItem: { updateMany: jest.fn(async () => ({ count: 1 })) }, orderItemStatusHistory: { create: jest.fn() } };
    await expect(transitionItem(tx as never, { id: 'i1', status: 'PENDING' }, 'NOT_PERFORMED', 'staff-1', null)).rejects.toMatchObject({ code: 'VALIDATION_FAILED' });
    await expect(transitionItem(tx as never, { id: 'i1', status: 'COMPLETED' }, 'IN_PROGRESS', 'staff-1', null)).rejects.toMatchObject({ code: 'ITEM_TRANSITION_NOT_ALLOWED' });
  });
});

describe('order helpers', () => {
  it('derives assignment status from whole-visit and per-item assignments', () => {
    const items = [{ id: 'i1' }, { id: 'i2' }];
    expect(assignmentStatusOf(items, [])).toBe('UNASSIGNED');
    expect(assignmentStatusOf(items, [{ orderItemId: 'i1' }])).toBe('PARTIALLY_ASSIGNED');
    expect(assignmentStatusOf(items, [{ orderItemId: 'i1' }, { orderItemId: 'i2' }])).toBe('ASSIGNED');
    expect(assignmentStatusOf(items, [{ orderItemId: null }])).toBe('ASSIGNED');
  });

  it('masks patient identity for platform views and sums visit length', () => {
    expect(maskName('Siti Rahma')).toBe('Si** Ra***');
    expect(maskPhone('0812-3456-7890')).toBe('0812****890');
    expect(visitMinutes([{ durationMinutes: 30, quantity: 2 }, { durationMinutes: 45, quantity: 1 }])).toBe(105);
    expect(orderCode(new Date('2026-12-01T00:00:00Z'))).toMatch(/^NK-261201-[A-Z2-9]{6}$/);
  });
});

describe('booking key', () => {
  const context = (authorization?: string) => ({ switchToHttp: () => ({ getRequest: () => ({ header: () => authorization }) }) }) as unknown as ExecutionContext;
  const guard = (key?: string) => new BookingKeyGuard({ get: () => key } as unknown as ConfigService);

  it('is off without a configured key and needs the exact key otherwise', () => {
    expect(() => guard(undefined).canActivate(context('Bearer anything'))).toThrow(expect.objectContaining({ code: 'BOOKINGS_DISABLED' }));
    expect(() => guard('k'.repeat(40)).canActivate(context('Bearer wrong'))).toThrow(expect.objectContaining({ code: 'UNAUTHORIZED' }));
    expect(guard('k'.repeat(40)).canActivate(context(`Bearer ${'k'.repeat(40)}`))).toBe(true);
  });
});

// ─── Bookings ──────────────────────────────────────────────────────────────────

const offering = (overrides: Record<string, unknown> = {}) => ({
  id: 'off-1', providerId: 'prov-1', masterServiceId: 'ms-1', name: 'Cek darah', status: 'PUBLISHED', basePrice: new Prisma.Decimal('150000'), durationMinutes: 30,
  masterService: { active: true, deletedAt: null }, modes: [{ enabled: true, priceOverride: null, visitFee: new Prisma.Decimal('50000') }], ...overrides,
});

function bookingService(state: { existing?: unknown; offerings?: unknown[]; bookable?: boolean } = {}) {
  const created: unknown[] = [];
  const prisma: Record<string, unknown> = {
    order: {
      findUnique: jest.fn(async () => state.existing ?? null),
      create: jest.fn(async (args: unknown) => { created.push(args); return { id: 'order-1', code: 'NK-1' }; }),
      findUniqueOrThrow: jest.fn(async () => ({ id: 'order-1', code: 'NK-1', status: 'PENDING_APPROVAL' })),
    },
    facility: { findFirst: jest.fn(async () => ({ id: 'f1', displayName: 'Klinik', addressLine: 'Jl. A', phone: null, timezone: 'Asia/Jakarta', provider: { id: 'prov-1' } })) },
    serviceOffering: { findMany: jest.fn(async () => state.offerings ?? [offering(), offering({ id: 'off-2', name: 'Gula darah', basePrice: new Prisma.Decimal('40000'), durationMinutes: 15, modes: [{ enabled: true, priceOverride: new Prisma.Decimal('45000'), visitFee: new Prisma.Decimal('75000') }] })]) },
    membership: { findFirst: jest.fn(async () => null) },
  };
  prisma.$transaction = jest.fn(async (run: (tx: unknown) => unknown) => run(prisma));
  const availability = { isBookable: jest.fn(async () => state.bookable ?? true) } as unknown as AvailabilityService;
  const audit = { record: jest.fn() } as unknown as AuditService;
  const outbox = { enqueue: jest.fn() } as unknown as OutboxService;
  return { created, availability, bookings: new BookingsService(prisma as unknown as PrismaService, availability, audit, outbox) };
}

const booking = { customerId: 'c1', patient: { id: 'p1', name: 'Siti Rahma' }, facilityId: 'f1', mode: 'HOMECARE' as const, scheduledAt: '2026-12-01T01:00:00.000Z', items: [{ offeringId: 'off-1' }, { offeringId: 'off-2', quantity: 2 }], address: { line: 'Jl. Kenanga No. 5' } };

describe('bookings (spec §5.5)', () => {
  it('creates one pending order with snapshot items, prices, and one visit fee (AC-ORD-01)', async () => {
    const { bookings, created, availability } = bookingService();
    await bookings.create(booking, 'key-00000001');
    const data = (created[0] as { data: Record<string, unknown> }).data;
    expect(data).toMatchObject({ status: 'PENDING_APPROVAL', providerId: 'prov-1', facilityId: 'f1', mode: 'HOMECARE', idempotencyKey: 'key-00000001' });
    expect((data.items as { create: unknown[] }).create).toEqual([
      expect.objectContaining({ offeringId: 'off-1', nameSnapshot: 'Cek darah', quantity: 1, modeSnapshot: 'HOMECARE' }),
      expect.objectContaining({ offeringId: 'off-2', nameSnapshot: 'Gula darah', quantity: 2 }),
    ]);
    // 150.000 + 2 × 45.000 (mode override) = 240.000; one visit fee, the highest (75.000).
    expect(String(data.itemSubtotal)).toBe('240000');
    expect(String(data.feeTotal)).toBe('75000');
    expect(String(data.grandTotal)).toBe('315000');
    // 30 + 2 × 15 minutes must fit the slot.
    expect(availability.isBookable).toHaveBeenCalledWith('f1', 'HOMECARE', new Date(booking.scheduledAt), 60);
  });

  it("refuses services of another clinic (AC-ORD-02)", async () => {
    const { bookings, created } = bookingService({ offerings: [offering(), offering({ id: 'off-2', providerId: 'prov-other' })] });
    await expect(bookings.create(booking, 'key-00000002')).rejects.toMatchObject({ code: 'BOOKING_ITEMS_INVALID', details: { fields: { 'items.1.offeringId': ['service is not offered by this clinic'] } } });
    expect(created).toHaveLength(0);
  });

  it('refuses a service not offered in the booked mode, a missing homecare address, and an unavailable slot', async () => {
    const offMode = bookingService({ offerings: [offering({ modes: [{ enabled: false }] }), offering({ id: 'off-2' })] });
    await expect(offMode.bookings.create(booking, 'key-00000003')).rejects.toMatchObject({ code: 'BOOKING_ITEMS_INVALID' });
    const { bookings } = bookingService();
    await expect(bookings.create({ ...booking, address: undefined }, 'key-00000004')).rejects.toMatchObject({ details: { fields: { address: expect.any(Array) } } });
    await expect(bookingService({ bookable: false }).bookings.create(booking, 'key-00000005')).rejects.toMatchObject({ code: 'SLOT_UNAVAILABLE' });
  });

  it('returns the existing order for a retried key and refuses a key reused for another booking (AC-ORD-10)', async () => {
    const replay = bookingService({ existing: { id: 'order-1', customerId: 'c1', facilityId: 'f1' } });
    await expect(replay.bookings.create(booking, 'key-00000006')).resolves.toMatchObject({ id: 'order-1' });
    expect(replay.created).toHaveLength(0);
    const reused = bookingService({ existing: { id: 'order-1', customerId: 'someone-else', facilityId: 'f1' } });
    await expect(reused.bookings.create(booking, 'key-00000006')).rejects.toMatchObject({ code: 'IDEMPOTENCY_KEY_REUSED' });
  });
});

// ─── Clinic orders ─────────────────────────────────────────────────────────────

const orderRecord = (overrides: Record<string, unknown> = {}) => ({
  id: 'o1', code: 'NK-1', customerId: 'c1', facilityId: 'f1', mode: 'HOMECARE', status: 'PENDING_APPROVAL', assignmentStatus: 'UNASSIGNED', version: 0,
  scheduledAt: new Date('2026-12-01T01:00:00Z'), patientSnapshot: { name: 'Siti Rahma', phone: '0812-3456-7890' }, addressSnapshot: { line: 'Jl. A' },
  items: [{ id: 'i1', durationMinutes: 30, quantity: 1, status: 'PENDING' }, { id: 'i2', durationMinutes: 30, quantity: 1, status: 'PENDING' }],
  timezone: 'Asia/Jakarta', assignments: [], statusHistory: [], facility: { id: 'f1', displayName: 'Klinik' }, ...overrides,
});

function ordersService(state: { order?: unknown; affiliation?: unknown; conflicts?: unknown[]; facility?: unknown; eligible?: unknown[] } = {}) {
  const writes: Array<[string, unknown]> = [];
  const log = (name: string, result: unknown = {}) => jest.fn(async (args: unknown) => { writes.push([name, args]); return result; });
  const prisma: Record<string, unknown> = {
    order: { findFirst: jest.fn(async (args: { where: { facilityId: string } }) => (args.where.facilityId === 'f1' ? (state.order === undefined ? orderRecord() : state.order) : null)), updateMany: log('order.updateMany', { count: 1 }), update: log('order.update') },
    orderStatusHistory: { create: log('history.create') },
    facility: { findUniqueOrThrow: jest.fn(async () => state.facility ?? { verificationStatus: 'VERIFIED', operatingStatus: 'ACTIVE', provider: { status: 'ACTIVE' } }) },
    practitionerAffiliation: { findFirst: jest.fn(async () => (state.affiliation === undefined ? { practitioner: { fullName: 'dr. Rina', verificationStatus: 'VERIFIED', operatingStatus: 'ACTIVE' } } : state.affiliation)), findMany: jest.fn(async () => state.eligible ?? [{ practitionerId: 'pr1' }]) },
    facilitySlot: { findMany: jest.fn(async () => [{ id: 's-new' }, { id: 's-old' }]), updateMany: log('slot.lock', { count: 1 }) },
    practitioner: { update: log('practitioner.update') },
    // Conflict checks query by practitioner; the assignment status refresh queries the order's own assignments.
    orderAssignment: {
      findMany: jest.fn(async (args: { where: { practitionerId?: string } }) => (args.where.practitionerId ? state.conflicts ?? [] : writes.filter(([name]) => name === 'assignment.create').map(([, call]) => ({ orderItemId: (call as { data: { orderItemId: string | null } }).data.orderItemId })))),
      create: log('assignment.create', { id: 'as-1' }),
      updateMany: log('assignment.updateMany', { count: 1 }),
    },
    orderItem: { findMany: jest.fn(async () => [{ id: 'i1' }, { id: 'i2' }]), updateMany: log('item.updateMany', { count: 2 }) },
    orderItemStatusHistory: { createMany: log('itemHistory.createMany') },
    user: { findMany: jest.fn(async () => []) },
  };
  prisma.$transaction = jest.fn(async (run: (tx: unknown) => unknown) => run(prisma));
  const availability = { reserve: jest.fn(async () => 'slot-1'), release: jest.fn(), slotsForVisit: jest.fn(async () => ({ slots: [{ startsAt: new Date('2026-12-01T01:00:00Z') }, { startsAt: new Date('2026-12-02T01:00:00Z') }] })) } as unknown as AvailabilityService;
  const audit = { record: jest.fn() } as unknown as AuditService;
  const outbox = { enqueue: jest.fn() } as unknown as OutboxService;
  const expiry = { expire: jest.fn(async () => false) } as unknown as OrderExpiryService;
  return { writes, prisma, availability, audit, outbox, expiry, orders: new OrdersService(prisma as unknown as PrismaService, availability, audit, outbox, expiry) };
}

describe('rescheduling confirmed orders', () => {
  const dto = { scheduledAt: '2026-12-02T01:00:00Z', version: 0, reason: 'Permintaan perubahan jadwal pasien' };
  const confirmed = (extra: Record<string, unknown> = {}) => orderRecord({ status: 'CONFIRMED', slotId: 's-old', ...extra });
  const assignment = (id: string) => ({ id: `as-${id}`, assignedById: 'staff-1', orderItemId: null, practitioner: { id, fullName: 'Nakes' } });
  beforeEach(() => { jest.useFakeTimers(); jest.setSystemTime(new Date('2026-11-30T00:00:00Z')); });
  afterEach(() => jest.useRealTimers());

  it('moves capacity atomically, increments version and preserves status/items/money/assignments', async () => {
    const { orders, writes, availability, audit, outbox } = ordersService({ order: confirmed() });
    await orders.reschedule('f1', 'o1', dto, source);
    expect(writes[0]).toEqual(['order.updateMany', { where: { id: 'o1', facilityId: 'f1', status: 'CONFIRMED', version: 0 }, data: { version: { increment: 1 } } }]);
    expect(availability.reserve).toHaveBeenCalledWith(expect.anything(), { facilityId: 'f1', mode: 'HOMECARE', startsAt: new Date(dto.scheduledAt), durationMinutes: 60 }, expect.any(Date));
    expect(availability.release).toHaveBeenCalledWith(expect.anything(), 's-old', 'f1');
    expect(writes.find(([name]) => name === 'order.update')![1]).toEqual({ where: { id: 'o1' }, data: { scheduledAt: new Date(dto.scheduledAt), slotId: 'slot-1' } });
    expect(writes.find(([name]) => name === 'history.create')![1]).toMatchObject({ data: { previousStatus: 'CONFIRMED', newStatus: 'CONFIRMED', reason: expect.stringContaining(dto.reason) } });
    expect(audit.record).toHaveBeenCalledWith(source, expect.objectContaining({ event: 'ORDER_RESCHEDULED', before: expect.objectContaining({ slotId: 's-old' }), after: expect.objectContaining({ version: 1, reason: dto.reason }) }), expect.anything());
    expect(outbox.enqueue).toHaveBeenCalledWith(expect.objectContaining({ eventType: 'ORDER_RESCHEDULED' }), expect.anything());
    expect(writes.some(([name]) => ['item.updateMany', 'assignment.updateMany'].includes(name))).toBe(false);
  });

  it('lists snapshot-duration slots and excludes the current time', async () => {
    const { orders, availability } = ordersService({ order: confirmed() });
    const result = await orders.rescheduleSlots('f1', 'o1', '2026-12-02');
    expect(availability.slotsForVisit).toHaveBeenCalledWith('f1', 'HOMECARE', '2026-12-02', 60);
    expect(result.slots).toHaveLength(1);
  });

  it.each(['PENDING_APPROVAL', 'IN_PROGRESS', 'COMPLETED', 'CANCELLED', 'REJECTED', 'EXPIRED', 'NO_SHOW'])('refuses %s orders', async (status) => {
    await expect(ordersService({ order: confirmed({ status }) }).orders.reschedule('f1', 'o1', dto, source)).rejects.toMatchObject({ code: 'ORDER_NOT_RESCHEDULABLE' });
  });

  it('rejects past originals, progressed/empty items, absent reservation and foreign clinics', async () => {
    for (const extra of [{ scheduledAt: new Date('2026-11-29') }, { items: [] }, { items: [{ status: 'IN_PROGRESS', durationMinutes: 60, quantity: 1 }] }]) await expect(ordersService({ order: confirmed(extra) }).orders.reschedule('f1', 'o1', dto, source)).rejects.toMatchObject({ code: 'ORDER_NOT_RESCHEDULABLE' });
    await expect(ordersService({ order: confirmed({ slotId: null }) }).orders.reschedule('f1', 'o1', dto, source)).rejects.toMatchObject({ code: 'SLOT_RESERVATION_MISSING' });
    await expect(ordersService({ order: confirmed() }).orders.reschedule('f2', 'o1', dto, source)).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });

  it('validates time/version/reason and rejects unchanged or stale submissions without writes', async () => {
    const { orders, writes } = ordersService({ order: confirmed() });
    for (const extra of [{ reason: '  ' }, { reason: 'x'.repeat(1001) }, { version: -1 }, { version: 0.5 }, { scheduledAt: 'invalid' }]) await expect(orders.reschedule('f1', 'o1', { ...dto, ...extra }, source)).rejects.toMatchObject({ code: 'VALIDATION_FAILED' });
    await expect(orders.reschedule('f1', 'o1', { ...dto, version: 4 }, source)).rejects.toMatchObject({ code: 'ORDER_STATE_CHANGED' });
    await expect(orders.reschedule('f1', 'o1', { ...dto, scheduledAt: '2026-12-01T01:00:00Z' }, source)).rejects.toMatchObject({ code: 'SCHEDULE_UNCHANGED' });
    await expect(orders.reschedule('f1', 'o1', { ...dto, scheduledAt: '2026-11-29T01:00:00Z' }, source)).rejects.toMatchObject({ code: 'SLOT_UNAVAILABLE' });
    expect(writes).toHaveLength(0);
  });

  it('rechecks active provider/clinic and nakes affiliation before moving capacity', async () => {
    for (const facility of [{ verificationStatus: 'VERIFIED', operatingStatus: 'SUSPENDED' }, { verificationStatus: 'VERIFIED', operatingStatus: 'ACTIVE', provider: { status: 'INACTIVE' } }]) await expect(ordersService({ order: confirmed(), facility }).orders.reschedule('f1', 'o1', dto, source)).rejects.toMatchObject({ code: 'FACILITY_NOT_ACTIVE' });
    const { orders, availability } = ordersService({ order: confirmed({ assignments: [assignment('pr1')] }), eligible: [] });
    await expect(orders.reschedule('f1', 'o1', dto, source)).rejects.toMatchObject({ code: 'PRACTITIONER_NOT_AVAILABLE' });
    expect(availability.reserve).not.toHaveBeenCalled();
  });

  it('uses the clinic local day for target affiliation and locks nakes in stable ID order', async () => {
    const { orders, writes, prisma } = ordersService({ order: confirmed({ assignments: [assignment('prB'), assignment('prA')] }), eligible: [{ practitionerId: 'prA' }, { practitionerId: 'prB' }] });
    await orders.reschedule('f1', 'o1', { ...dto, scheduledAt: '2026-12-01T17:30:00Z' }, source);
    expect(writes.filter(([name]) => name === 'practitioner.update').map(([, args]) => (args as { where: { id: string } }).where.id)).toEqual(['prA', 'prB']);
    expect((prisma.practitionerAffiliation as { findMany: jest.Mock }).findMany).toHaveBeenCalledWith(expect.objectContaining({ where: expect.objectContaining({ OR: [{ startDate: null }, { startDate: { lte: new Date('2026-12-02T00:00:00Z') } }] }) }));
  });

  it('detects conflicts even when another visit started more than 24 hours earlier', async () => {
    const { orders, availability } = ordersService({ order: confirmed({ assignments: [assignment('pr1')] }), conflicts: [{ order: { code: 'LONG-VISIT', scheduledAt: new Date('2026-11-30T23:00:00Z'), items: [{ durationMinutes: 1800, quantity: 1 }] } }] });
    await expect(orders.reschedule('f1', 'o1', dto, source)).rejects.toMatchObject({ code: 'PRACTITIONER_SCHEDULE_CONFLICT' });
    expect(availability.reserve).not.toHaveBeenCalled();
  });

  it('does not release the original slot on a full target, and propagates release/outbox failures for rollback', async () => {
    const full = ordersService({ order: confirmed() });
    jest.mocked(full.availability.reserve).mockRejectedValueOnce(Object.assign(new Error('full'), { code: 'SLOT_FULL' }));
    await expect(full.orders.reschedule('f1', 'o1', dto, source)).rejects.toMatchObject({ code: 'SLOT_FULL' });
    expect(full.availability.release).not.toHaveBeenCalled();
    const failed = ordersService({ order: confirmed() });
    jest.mocked(failed.outbox.enqueue).mockRejectedValueOnce(new Error('outbox failed'));
    await expect(failed.orders.reschedule('f1', 'o1', dto, source)).rejects.toThrow('outbox failed');
  });

  it('lost order CAS never acquires capacity', async () => {
    const { orders, prisma, availability } = ordersService({ order: confirmed() });
    (prisma.order as { updateMany: jest.Mock }).updateMany.mockResolvedValueOnce({ count: 0 });
    await expect(orders.reschedule('f1', 'o1', dto, source)).rejects.toMatchObject({ code: 'ORDER_STATE_CHANGED' });
    expect(availability.reserve).not.toHaveBeenCalled();
  });
});

describe('manual no-show', () => {
  const reason = 'Pasien tidak datang dan tidak dapat dihubungi';
  beforeEach(() => { jest.useFakeTimers(); jest.setSystemTime(new Date('2026-12-01T02:00:00Z')); });
  afterEach(() => jest.useRealTimers());
  const confirmed = (extra: Record<string, unknown> = {}) => orderRecord({ status: 'CONFIRMED', slotId: 's1', assignmentStatus: 'ASSIGNED', ...extra });

  it('marks unstarted services not performed and retires assignments atomically, keeping historical capacity and money', async () => {
    const { orders, writes, availability, audit, outbox } = ordersService({ order: confirmed() });
    await orders.noShow('f1', 'o1', { reason: `  ${reason}  ` }, source);
    expect(writes.find(([name]) => name === 'order.updateMany')![1]).toMatchObject({ where: { id: 'o1', status: 'CONFIRMED', version: 0 }, data: { status: 'NO_SHOW' } });
    expect(writes.find(([name]) => name === 'item.updateMany')![1]).toMatchObject({ where: { orderId: 'o1', id: { in: ['i1', 'i2'] }, status: 'PENDING' }, data: { status: 'NOT_PERFORMED', notPerformedReason: reason } });
    expect(writes.find(([name]) => name === 'itemHistory.createMany')![1]).toEqual({ data: ['i1', 'i2'].map((orderItemId) => ({ orderItemId, previousStatus: 'PENDING', newStatus: 'NOT_PERFORMED', actorId: source.actorId, reason })) });
    expect(writes.find(([name]) => name === 'order.update')![1]).toEqual({ where: { id: 'o1' }, data: { assignmentStatus: 'UNASSIGNED' } });
    expect(availability.release).not.toHaveBeenCalled(); expect(availability.reserve).not.toHaveBeenCalled();
    expect(audit.record).toHaveBeenCalledWith(source, expect.objectContaining({ event: 'ORDER_NO_SHOW', facilityId: 'f1' }), expect.anything());
    expect(outbox.enqueue).toHaveBeenCalledWith(expect.objectContaining({ eventType: 'ORDER_STATUS_CHANGED', payload: expect.objectContaining({ status: 'NO_SHOW', reason }) }), expect.anything());
  });

  it('rejects one millisecond before the summed duration × quantity ends', async () => {
    const { orders, writes } = ordersService({ order: confirmed({ items: [{ id: 'i1', durationMinutes: 15, quantity: 2, status: 'PENDING' }, { id: 'i2', durationMinutes: 15, quantity: 2, status: 'PENDING' }] }) });
    jest.setSystemTime(new Date('2026-12-01T01:59:59.999Z'));
    await expect(orders.noShow('f1', 'o1', { reason }, source)).rejects.toMatchObject({ code: 'NO_SHOW_TOO_EARLY', details: { eligibleAt: '2026-12-01T02:00:00.000Z' } });
    expect(writes).toHaveLength(0);
    jest.setSystemTime(new Date('2026-12-01T02:00:00Z'));
    await expect(orders.noShow('f1', 'o1', { reason }, source)).resolves.toBeDefined();
  });

  it.each(['PENDING_APPROVAL', 'IN_PROGRESS', 'COMPLETED', 'CANCELLED', 'REJECTED', 'EXPIRED', 'NO_SHOW'])('never changes a %s order', async (status) => {
    const { orders, writes } = ordersService({ order: confirmed({ status }) });
    await expect(orders.noShow('f1', 'o1', { reason }, source)).rejects.toMatchObject({ code: 'ORDER_TRANSITION_NOT_ALLOWED' });
    expect(writes).toHaveLength(0);
  });

  it.each(['IN_PROGRESS', 'COMPLETED', 'NOT_PERFORMED'])('does not overwrite a %s service', async (status) => {
    const { orders, writes } = ordersService({ order: confirmed({ items: [{ id: 'i1', durationMinutes: 30, quantity: 1, status }] }) });
    await expect(orders.noShow('f1', 'o1', { reason }, source)).rejects.toMatchObject({ code: 'ORDER_SERVICES_ALREADY_PROGRESSED' });
    expect(writes).toHaveLength(0);
  });

  it('requires a valid reason, own clinic and a nonempty visit', async () => {
    const { orders, writes } = ordersService({ order: confirmed() });
    for (const invalid of ['', '   ', 'abc', 'a'.repeat(1001)]) await expect(orders.noShow('f1', 'o1', { reason: invalid }, source)).rejects.toMatchObject({ code: 'VALIDATION_FAILED' });
    await expect(orders.noShow('f2', 'o1', { reason }, source)).rejects.toMatchObject({ code: 'NOT_FOUND' });
    await expect(ordersService({ order: confirmed({ items: [] }) }).orders.noShow('f1', 'o1', { reason }, source)).rejects.toMatchObject({ code: 'ORDER_SERVICES_ALREADY_PROGRESSED' });
    expect(writes).toHaveLength(0);
  });

  it('a lost race with start/cancel/assignment never changes services or emits events', async () => {
    const { orders, prisma, audit, outbox } = ordersService({ order: confirmed() });
    (prisma.order as { updateMany: jest.Mock }).updateMany.mockResolvedValueOnce({ count: 0 });
    await expect(orders.noShow('f1', 'o1', { reason }, source)).rejects.toMatchObject({ code: 'ORDER_STATE_CHANGED' });
    expect((prisma.orderItem as { updateMany: jest.Mock }).updateMany).not.toHaveBeenCalled();
    expect(audit.record).not.toHaveBeenCalled(); expect(outbox.enqueue).not.toHaveBeenCalled();
  });

  it('refuses partial item updates and propagates outbox failure for transaction rollback', async () => {
    const partial = ordersService({ order: confirmed() });
    (partial.prisma.orderItem as { updateMany: jest.Mock }).updateMany.mockResolvedValueOnce({ count: 1 });
    await expect(partial.orders.noShow('f1', 'o1', { reason }, source)).rejects.toMatchObject({ code: 'ITEM_STATE_CHANGED' });
    expect(partial.outbox.enqueue).not.toHaveBeenCalled();
    const failed = ordersService({ order: confirmed() });
    jest.mocked(failed.outbox.enqueue).mockRejectedValueOnce(new Error('outbox failed'));
    await expect(failed.orders.noShow('f1', 'o1', { reason }, source)).rejects.toThrow('outbox failed');
  });
});

describe('clinic orders', () => {
  it('commits expiry on late approval and returns 409 without reserving capacity', async () => {
    const { orders, expiry, writes, availability } = ordersService();
    jest.mocked(expiry.expire).mockResolvedValueOnce(true);
    await expect(orders.approve('f1', 'o1', source)).rejects.toMatchObject({ code: 'ORDER_APPROVAL_EXPIRED' });
    expect(writes).toHaveLength(0);
    expect(availability.reserve).not.toHaveBeenCalled();
  });
  it('cancels pending orders without releasing an unreserved slot and queues history/audit/outbox', async () => {
    const { orders, writes, availability, audit, outbox } = ordersService();
    await orders.cancel('f1', 'o1', { reason: '  Permintaan pelanggan  ' }, source);
    expect(availability.release).not.toHaveBeenCalled();
    expect(writes.find(([name]) => name === 'history.create')![1]).toMatchObject({ data: { previousStatus: 'PENDING_APPROVAL', newStatus: 'CANCELLED', reason: 'Permintaan pelanggan', actorId: source.actorId } });
    expect(audit.record).toHaveBeenCalledWith(source, expect.objectContaining({ event: 'ORDER_CANCELLED', facilityId: 'f1' }), expect.anything());
    expect(outbox.enqueue).toHaveBeenCalledWith(expect.objectContaining({ eventType: 'ORDER_STATUS_CHANGED', payload: expect.objectContaining({ status: 'CANCELLED' }) }), expect.anything());
  });

  it('releases one confirmed slot and retires assignments without changing payment/prices/items', async () => {
    const { orders, writes, availability } = ordersService({ order: orderRecord({ status: 'CONFIRMED', slotId: 's1', assignmentStatus: 'ASSIGNED' }) });
    await orders.cancel('f1', 'o1', { reason: 'Nakes berhalangan' }, source);
    expect(availability.release).toHaveBeenCalledWith(expect.anything(), 's1', 'f1');
    expect(writes.find(([name]) => name === 'assignment.updateMany')![1]).toMatchObject({ where: { orderId: 'o1', state: 'ACTIVE' }, data: { state: 'UNASSIGNED', unassignedAt: expect.any(Date) } });
    expect(writes.find(([name]) => name === 'order.update')![1]).toEqual({ where: { id: 'o1' }, data: { assignmentStatus: 'UNASSIGNED' } });
  });

  it.each(['IN_PROGRESS', 'COMPLETED', 'REJECTED', 'CANCELLED', 'EXPIRED', 'NO_SHOW'])('cannot cancel %s orders', async (status) => {
    const { orders, writes, availability } = ordersService({ order: orderRecord({ status }) });
    await expect(orders.cancel('f1', 'o1', { reason: 'Permintaan pelanggan' }, source)).rejects.toMatchObject({ code: 'ORDER_TRANSITION_NOT_ALLOWED' });
    expect(writes).toHaveLength(0);
    expect(availability.release).not.toHaveBeenCalled();
  });

  it('validates reason and clinic scope before any mutation', async () => {
    const { orders, writes } = ordersService();
    for (const reason of ['', '    ', 'abc', 'a'.repeat(1001)]) await expect(orders.cancel('f1', 'o1', { reason }, source)).rejects.toMatchObject({ code: 'VALIDATION_FAILED' });
    await expect(orders.cancel('f2', 'o1', { reason: 'Permintaan pelanggan' }, source)).rejects.toMatchObject({ code: 'NOT_FOUND' });
    expect(writes).toHaveLength(0);
  });

  it('a lost concurrent cancellation never releases capacity or assignments', async () => {
    const { orders, prisma, availability, writes } = ordersService({ order: orderRecord({ status: 'CONFIRMED', slotId: 's1' }) });
    (prisma.order as { updateMany: jest.Mock }).updateMany.mockResolvedValueOnce({ count: 0 });
    await expect(orders.cancel('f1', 'o1', { reason: 'Permintaan pelanggan' }, source)).rejects.toMatchObject({ code: 'ORDER_STATE_CHANGED' });
    expect(availability.release).not.toHaveBeenCalled();
    expect(writes).toHaveLength(0);
  });

  it('rejects a confirmed order with no reservation rather than silently corrupting capacity', async () => {
    const { orders } = ordersService({ order: orderRecord({ status: 'CONFIRMED', slotId: null }) });
    await expect(orders.cancel('f1', 'o1', { reason: 'Permintaan pelanggan' }, source)).rejects.toMatchObject({ code: 'SLOT_RESERVATION_MISSING' });
  });

  it('stale assignment edits cannot reactivate a cancelled order assignment', async () => {
    const { orders, prisma, writes } = ordersService({ order: orderRecord({ status: 'CONFIRMED', slotId: 's1' }) });
    (prisma.order as { updateMany: jest.Mock }).updateMany.mockResolvedValue({ count: 0 });
    await expect(orders.assign('f1', 'o1', { practitionerId: 'pr1' }, source)).rejects.toMatchObject({ code: 'ORDER_STATE_CHANGED' });
    await expect(orders.unassign('f1', 'o1', 'as-1', source)).rejects.toMatchObject({ code: 'ORDER_STATE_CHANGED' });
    expect(writes).toHaveLength(0);
  });
  it("answers 404 for another clinic's order (AC-ORD-07)", async () => {
    const { orders } = ordersService();
    await expect(orders.detail('f2', 'o1')).rejects.toMatchObject({ code: 'NOT_FOUND' });
    await expect(orders.approve('f2', 'o1', source)).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });

  it('approves the whole order, reserves the slot for the whole visit, and logs it (AC-ORD-03)', async () => {
    const { orders, writes, availability } = ordersService();
    await orders.approve('f1', 'o1', source);
    expect(writes.find(([name]) => name === 'order.updateMany')![1]).toMatchObject({ data: { status: 'CONFIRMED' } });
    expect(availability.reserve).toHaveBeenCalledWith(expect.anything(), { facilityId: 'f1', mode: 'HOMECARE', startsAt: new Date('2026-12-01T01:00:00Z'), durationMinutes: 60 });
    expect(writes.find(([name]) => name === 'history.create')![1]).toMatchObject({ data: { newStatus: 'CONFIRMED', actorId: 'staff-1' } });
  });

  it('cannot approve for a suspended clinic (AC-FAC-05)', async () => {
    const { orders } = ordersService({ facility: { verificationStatus: 'VERIFIED', operatingStatus: 'SUSPENDED' } });
    await expect(orders.approve('f1', 'o1', source)).rejects.toMatchObject({ code: 'FACILITY_NOT_ACTIVE' });
  });

  it('needs a reason to reject (AC-ORD-04) and stores it (AC-ORD-05)', async () => {
    const { orders, writes } = ordersService();
    await expect(orders.reject('f1', 'o1', { reason: '' }, source)).rejects.toMatchObject({ code: 'VALIDATION_FAILED' });
    await orders.reject('f1', 'o1', { reason: 'Jadwal nakes penuh' }, source);
    expect(writes.find(([name]) => name === 'order.updateMany')![1]).toMatchObject({ data: { status: 'REJECTED', rejectionReason: 'Jadwal nakes penuh' } });
    expect(writes.find(([name]) => name === 'history.create')![1]).toMatchObject({ data: { reason: 'Jadwal nakes penuh' } });
  });

  it('cannot start an unapproved order (AC-ORD-08) or an unassigned one', async () => {
    await expect(ordersService().orders.start('f1', 'o1', source)).rejects.toMatchObject({ code: 'ORDER_TRANSITION_NOT_ALLOWED' });
    await expect(ordersService({ order: orderRecord({ status: 'CONFIRMED' }) }).orders.start('f1', 'o1', source)).rejects.toMatchObject({ code: 'ORDER_NOT_ASSIGNED' });
  });

  it('cannot complete with unfinished services (AC-ORD-09)', async () => {
    const { orders } = ordersService({ order: orderRecord({ status: 'IN_PROGRESS', items: [{ id: 'i1', durationMinutes: 30, quantity: 1, status: 'COMPLETED' }, { id: 'i2', durationMinutes: 30, quantity: 1, status: 'IN_PROGRESS' }] }) });
    await expect(orders.complete('f1', 'o1', source)).rejects.toMatchObject({ code: 'ORDER_ITEMS_UNFINISHED', details: { items: ['i2'] } });
  });

  it('assigns an affiliated practitioner and keeps clinic ownership (AC-PRA-01)', async () => {
    const { orders, writes } = ordersService({ order: orderRecord({ status: 'CONFIRMED' }) });
    await orders.assign('f1', 'o1', { practitionerId: 'pr1' }, source);
    expect(writes.find(([name]) => name === 'assignment.create')![1]).toMatchObject({ data: { orderId: 'o1', practitionerId: 'pr1', orderItemId: null, state: 'ACTIVE', assignedById: 'staff-1' } });
    expect(writes.find(([name]) => name === 'order.update')![1]).toMatchObject({ data: { assignmentStatus: 'ASSIGNED' } });
  });

  it('refuses an overlapping confirmed visit of the same practitioner (AC-PRA-02)', async () => {
    const { orders, writes } = ordersService({ order: orderRecord({ status: 'CONFIRMED' }), conflicts: [{ order: { code: 'NK-OTHER', scheduledAt: new Date('2026-12-01T01:30:00Z'), items: [{ durationMinutes: 60, quantity: 1 }] } }] });
    await expect(orders.assign('f1', 'o1', { practitionerId: 'pr1' }, source)).rejects.toMatchObject({ code: 'PRACTITIONER_SCHEDULE_CONFLICT' });
    expect(writes.find(([name]) => name === 'assignment.create')).toBeUndefined();
  });

  it('allows a back-to-back visit and refuses unaffiliated practitioners', async () => {
    const backToBack = ordersService({ order: orderRecord({ status: 'CONFIRMED' }), conflicts: [{ order: { code: 'NK-EARLIER', scheduledAt: new Date('2026-12-01T00:00:00Z'), items: [{ durationMinutes: 60, quantity: 1 }] } }] });
    await expect(backToBack.orders.assign('f1', 'o1', { practitionerId: 'pr1' }, source)).resolves.toBeDefined();
    const unaffiliated = ordersService({ order: orderRecord({ status: 'CONFIRMED' }), affiliation: null });
    await expect(unaffiliated.orders.assign('f1', 'o1', { practitionerId: 'pr9' }, source)).rejects.toMatchObject({ code: 'PRACTITIONER_NOT_AFFILIATED' });
  });

  it('only assigns while the order is confirmed or in progress', async () => {
    await expect(ordersService().orders.assign('f1', 'o1', { practitionerId: 'pr1' }, source)).rejects.toMatchObject({ code: 'ORDER_NOT_ASSIGNABLE' });
  });

  it('gives platform views a masked patient and no address', async () => {
    const { orders } = ordersService();
    const prisma = (orders as unknown as { prisma: { order: { findUnique?: jest.Mock } } }).prisma;
    prisma.order.findUnique = jest.fn(async () => orderRecord());
    const detail = await orders.adminDetail('o1');
    expect(detail.patient).toEqual({ name: 'Si** Ra***', phone: '0812****890', sex: null, birthYear: null });
    expect(detail.address).toBeNull();
    expect(JSON.stringify(detail)).not.toContain('Siti');
  });
});
