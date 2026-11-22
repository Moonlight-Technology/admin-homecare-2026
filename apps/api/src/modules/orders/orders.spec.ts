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

const source = { actorId: 'staff-1', scope: 'FACILITY' as const };

describe('order state machine (spec §6)', () => {
  it('allows only the documented transitions', () => {
    expect(canTransition('PENDING_APPROVAL', 'CONFIRMED')).toBe(true);
    expect(canTransition('PENDING_APPROVAL', 'IN_PROGRESS')).toBe(false); // AC-ORD-08
    expect(canTransition('CONFIRMED', 'COMPLETED')).toBe(false);
    expect(canTransition('REJECTED', 'CONFIRMED')).toBe(false);
    expect(canTransition('PENDING_APPROVAL', 'CANCELLED')).toBe(false); // reserved, policy open
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
  assignments: [], statusHistory: [], facility: { id: 'f1', displayName: 'Klinik' }, ...overrides,
});

function ordersService(state: { order?: unknown; affiliation?: unknown; conflicts?: unknown[]; facility?: unknown } = {}) {
  const writes: Array<[string, unknown]> = [];
  const log = (name: string, result: unknown = {}) => jest.fn(async (args: unknown) => { writes.push([name, args]); return result; });
  const prisma: Record<string, unknown> = {
    order: { findFirst: jest.fn(async (args: { where: { facilityId: string } }) => (args.where.facilityId === 'f1' ? (state.order === undefined ? orderRecord() : state.order) : null)), updateMany: log('order.updateMany', { count: 1 }), update: log('order.update') },
    orderStatusHistory: { create: log('history.create') },
    facility: { findUniqueOrThrow: jest.fn(async () => state.facility ?? { verificationStatus: 'VERIFIED', operatingStatus: 'ACTIVE' }) },
    practitionerAffiliation: { findFirst: jest.fn(async () => (state.affiliation === undefined ? { practitioner: { fullName: 'dr. Rina', verificationStatus: 'VERIFIED', operatingStatus: 'ACTIVE' } } : state.affiliation)) },
    practitioner: { update: log('practitioner.update') },
    // Conflict checks query by practitioner; the assignment status refresh queries the order's own assignments.
    orderAssignment: {
      findMany: jest.fn(async (args: { where: { practitionerId?: string } }) => (args.where.practitionerId ? state.conflicts ?? [] : writes.filter(([name]) => name === 'assignment.create').map(([, call]) => ({ orderItemId: (call as { data: { orderItemId: string | null } }).data.orderItemId })))),
      create: log('assignment.create', { id: 'as-1' }),
    },
    orderItem: { findMany: jest.fn(async () => [{ id: 'i1' }, { id: 'i2' }]) },
    user: { findMany: jest.fn(async () => []) },
  };
  prisma.$transaction = jest.fn(async (run: (tx: unknown) => unknown) => run(prisma));
  const availability = { reserve: jest.fn(async () => 'slot-1') } as unknown as AvailabilityService;
  return { writes, availability, orders: new OrdersService(prisma as unknown as PrismaService, availability, { record: jest.fn() } as unknown as AuditService, { enqueue: jest.fn() } as unknown as OutboxService) };
}

describe('clinic orders', () => {
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
