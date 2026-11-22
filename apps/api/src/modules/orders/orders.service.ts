import { Injectable } from '@nestjs/common';
import { Prisma, type AssignmentStatus } from '@prisma/client';
import { AppError } from '../../common/errors/app-error';
import { paginate, skipTake } from '../../common/dto/pagination.dto';
import { PrismaService, type Db } from '../../prisma/prisma.service';
import { AuditService, type AuditSource } from '../audit/audit.service';
import { AvailabilityService } from '../availability/availability.service';
import { addDays, localToUtc } from '../availability/slot-math';
import { OutboxService } from '../notifications/outbox.service';
import type { AdminOrderQueryDto, AssignPractitionerDto, ItemStatusDto, OrderQueryDto, RejectOrderDto } from './dto/order.dto';
import { TERMINAL_ITEM, transitionItem, transitionOrder } from './order-state';

type Source = AuditSource & { actorId: string };
/** Orders a practitioner is busy with: confirmed or under way. */
const BUSY = ['CONFIRMED', 'IN_PROGRESS'] as const;

const orderDetailInclude = {
  items: { orderBy: { createdAt: 'asc' }, select: { id: true, offeringId: true, masterServiceId: true, nameSnapshot: true, priceSnapshot: true, durationMinutes: true, modeSnapshot: true, quantity: true, status: true, notPerformedReason: true } },
  assignments: { where: { state: 'ACTIVE' }, orderBy: { assignedAt: 'asc' }, select: { id: true, orderItemId: true, assignedAt: true, assignedById: true, practitioner: { select: { id: true, fullName: true, practitionerType: { select: { name: true } } } } } },
  statusHistory: { orderBy: { createdAt: 'asc' }, select: { id: true, previousStatus: true, newStatus: true, actorId: true, reason: true, createdAt: true } },
  facility: { select: { id: true, displayName: true } },
} satisfies Prisma.OrderInclude;

type OrderDetail = Prisma.OrderGetPayload<{ include: typeof orderDetailInclude }>;

/** Total visit length: every service, times its quantity. */
export const visitMinutes = (items: Array<{ durationMinutes: number; quantity: number }>) => items.reduce((total, item) => total + item.durationMinutes * item.quantity, 0);

/** Whole-visit assignment covers everything; otherwise each item needs its own practitioner (spec §6). */
export function assignmentStatusOf(items: Array<{ id: string }>, assignments: Array<{ orderItemId: string | null }>): AssignmentStatus {
  if (!assignments.length) return 'UNASSIGNED';
  if (assignments.some((assignment) => assignment.orderItemId === null)) return 'ASSIGNED';
  const covered = new Set(assignments.map((assignment) => assignment.orderItemId));
  return items.every((item) => covered.has(item.id)) ? 'ASSIGNED' : 'PARTIALLY_ASSIGNED';
}

/** "Siti Rahma" → "Si** Ra***"; platform views see who booked, not the full identity (spec §8). */
export const maskName = (name: string) => name.split(/\s+/).filter(Boolean).map((part) => `${part.slice(0, 2)}${'*'.repeat(Math.max(1, part.length - 2))}`).join(' ');
export const maskPhone = (phone: string | null) => (phone ? `${phone.replace(/\D/g, '').slice(0, 4)}****${phone.replace(/\D/g, '').slice(-3)}` : null);

const overlaps = (aStart: Date, aEnd: Date, bStart: Date, bEnd: Date) => aStart < bEnd && bStart < aEnd;

/**
 * Clinic order handling (spec §5.5 steps 4–9) and platform read views. Every query is scoped by the caller's
 * facility, so another clinic's order answers 404 and lists only ever contain the caller's orders (AC-ORD-07).
 */
@Injectable()
export class OrdersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly availability: AvailabilityService,
    private readonly audit: AuditService,
    private readonly outbox: OutboxService,
  ) {}

  // ─── Reads ─────────────────────────────────────────────────────────────────

  async list(facilityId: string | null, query: OrderQueryDto & { facilityId?: string }, masked = false) {
    const timezone = 'Asia/Jakarta';
    const where: Prisma.OrderWhereInput = {
      ...(facilityId ? { facilityId } : query.facilityId ? { facilityId: query.facilityId } : {}),
      ...(query.status ? { status: query.status } : {}),
      ...(query.mode ? { mode: query.mode } : {}),
      ...(query.assignmentStatus ? { assignmentStatus: query.assignmentStatus } : {}),
      ...(query.from || query.to ? { scheduledAt: { ...(query.from ? { gte: localToUtc(query.from, 0, timezone) } : {}), ...(query.to ? { lt: localToUtc(addDays(query.to, 1), 0, timezone) } : {}) } } : {}),
      ...(query.search ? { code: { contains: query.search.trim().toUpperCase() } } : {}),
    };
    // The approval inbox reads soonest visit first; other views newest booking first.
    const orderBy: Prisma.OrderOrderByWithRelationInput = query.status === 'PENDING_APPROVAL' ? { scheduledAt: 'asc' } : { createdAt: query.sortOrder };
    const [items, total, counts] = await Promise.all([
      this.prisma.order.findMany({
        where,
        orderBy,
        ...skipTake(query),
        select: { id: true, code: true, status: true, assignmentStatus: true, paymentStatus: true, mode: true, scheduledAt: true, timezone: true, grandTotal: true, currency: true, createdAt: true, patientSnapshot: true, facility: { select: { id: true, displayName: true } }, items: { select: { nameSnapshot: true, quantity: true, durationMinutes: true } } },
      }),
      this.prisma.order.count({ where }),
      this.prisma.order.groupBy({ by: ['status'], where: facilityId ? { facilityId } : query.facilityId ? { facilityId: query.facilityId } : {}, _count: { _all: true } }),
    ]);
    return {
      ...paginate(items.map(({ patientSnapshot, items: lines, ...order }) => ({
        ...order,
        patientName: this.patientName(patientSnapshot, masked),
        itemCount: lines.length,
        itemNames: lines.map((line) => line.nameSnapshot),
        durationMinutes: visitMinutes(lines),
      })), total, query),
      counts: Object.fromEntries(counts.map((row) => [row.status, row._count._all])),
    };
  }

  async detail(facilityId: string, id: string) {
    return this.present(await this.owned(facilityId, id), false);
  }

  async adminDetail(id: string) {
    const order = await this.prisma.order.findUnique({ where: { id }, include: orderDetailInclude });
    if (!order) throw AppError.notFound();
    return this.present(order, true);
  }

  /** Affiliated, verified, active practitioners the clinic can assign, with their conflicts for this visit. */
  async assignablePractitioners(facilityId: string, id: string) {
    const order = await this.owned(facilityId, id);
    const visitDate = order.scheduledAt;
    const affiliations = await this.prisma.practitionerAffiliation.findMany({
      where: { facilityId, status: 'ACTIVE', OR: [{ startDate: null }, { startDate: { lte: visitDate } }], AND: [{ OR: [{ endDate: null }, { endDate: { gte: new Date(visitDate.toISOString().slice(0, 10)) } }] }], practitioner: { verificationStatus: 'VERIFIED', operatingStatus: 'ACTIVE' } },
      select: { practitioner: { select: { id: true, fullName: true, practitionerType: { select: { name: true } } } } },
      orderBy: { practitioner: { fullName: 'asc' } },
    });
    const ends = new Date(order.scheduledAt.getTime() + visitMinutes(order.items) * 60_000);
    const results = [];
    for (const { practitioner } of affiliations) {
      const conflict = await this.conflictFor(this.prisma, practitioner.id, order.id, order.scheduledAt, ends);
      results.push({ ...practitioner, conflict: conflict ? { orderCode: conflict.code, scheduledAt: conflict.scheduledAt } : null });
    }
    return results;
  }

  // ─── Approval ──────────────────────────────────────────────────────────────

  /**
   * Approve the whole order (spec §5.5 step 5, AC-ORD-03): the clinic must still be verified and active, then the
   * status changes and confirmed capacity is reserved in the same transaction; a full slot rolls everything back.
   */
  async approve(facilityId: string, id: string, source: Source) {
    const order = await this.owned(facilityId, id);
    const facility = await this.prisma.facility.findUniqueOrThrow({ where: { id: facilityId }, select: { verificationStatus: true, operatingStatus: true } });
    if (facility.verificationStatus !== 'VERIFIED' || facility.operatingStatus !== 'ACTIVE') throw AppError.unprocessable('FACILITY_NOT_ACTIVE', 'Your clinic must be verified and active to accept bookings.');
    await this.prisma.$transaction(async (tx) => {
      await transitionOrder(tx, order, 'CONFIRMED', source.actorId, null);
      const slotId = await this.availability.reserve(tx, { facilityId, mode: order.mode, startsAt: order.scheduledAt, durationMinutes: visitMinutes(order.items) });
      await tx.order.update({ where: { id }, data: { slotId } });
      await this.audit.record(source, { event: 'ORDER_APPROVED', entityType: 'Order', entityId: id, facilityId, before: { status: order.status }, after: { status: 'CONFIRMED', slotId } }, tx);
      await this.statusEvent(tx, order, 'CONFIRMED', null);
    });
    return this.detail(facilityId, id);
  }

  /** Reject the whole order with a reason (AC-ORD-04/05). Pending orders hold no capacity, so nothing is released. */
  async reject(facilityId: string, id: string, dto: RejectOrderDto, source: Source) {
    if ((dto.reason ?? '').length < 5) throw AppError.unprocessable('VALIDATION_FAILED', 'A reason is required to reject an order.', { fields: { reason: ['reason must be at least 5 characters'] } });
    const order = await this.owned(facilityId, id);
    await this.prisma.$transaction(async (tx) => {
      await transitionOrder(tx, order, 'REJECTED', source.actorId, dto.reason, { rejectionReason: dto.reason });
      await this.audit.record(source, { event: 'ORDER_REJECTED', entityType: 'Order', entityId: id, facilityId, before: { status: order.status }, after: { status: 'REJECTED', reason: dto.reason } }, tx);
      await this.statusEvent(tx, order, 'REJECTED', dto.reason);
    });
    return this.detail(facilityId, id);
  }

  // ─── Assignment ────────────────────────────────────────────────────────────

  /**
   * Assign a practitioner to the visit or one item (spec §5.4 step 4, AC-PRA-01/02): only an active, verified
   * practitioner with an active affiliation to this clinic on the visit date, and never two overlapping confirmed
   * visits for the same person across all their clinics. Ownership of the order stays with the clinic.
   */
  async assign(facilityId: string, id: string, dto: AssignPractitionerDto, source: Source) {
    const order = await this.owned(facilityId, id);
    if (!BUSY.includes(order.status as (typeof BUSY)[number])) throw AppError.conflict('ORDER_NOT_ASSIGNABLE', 'Practitioners can be assigned once the order is confirmed and until it is completed.');
    if (dto.orderItemId && !order.items.some((item) => item.id === dto.orderItemId)) throw AppError.notFound('This service is not part of the order.');
    if (order.assignments.some((assignment) => assignment.practitioner.id === dto.practitionerId && assignment.orderItemId === (dto.orderItemId ?? null))) {
      throw AppError.conflict('ALREADY_ASSIGNED', 'This practitioner is already assigned here.');
    }
    const visitDay = new Date(order.scheduledAt.toISOString().slice(0, 10));
    const affiliation = await this.prisma.practitionerAffiliation.findFirst({
      where: { facilityId, practitionerId: dto.practitionerId, status: 'ACTIVE', OR: [{ startDate: null }, { startDate: { lte: order.scheduledAt } }], AND: [{ OR: [{ endDate: null }, { endDate: { gte: visitDay } }] }] },
      select: { practitioner: { select: { fullName: true, verificationStatus: true, operatingStatus: true } } },
    });
    if (!affiliation) throw AppError.unprocessable('PRACTITIONER_NOT_AFFILIATED', 'This practitioner is not actively affiliated with your clinic on the visit date.');
    if (affiliation.practitioner.verificationStatus !== 'VERIFIED' || affiliation.practitioner.operatingStatus !== 'ACTIVE') throw AppError.unprocessable('PRACTITIONER_NOT_ACTIVE', 'Only a verified, active practitioner can be assigned.');

    const ends = new Date(order.scheduledAt.getTime() + visitMinutes(order.items) * 60_000);
    await this.prisma.$transaction(async (tx) => {
      // Lock the practitioner row so two assignments of the same person cannot pass the conflict check together.
      await tx.practitioner.update({ where: { id: dto.practitionerId }, data: { updatedAt: new Date() } });
      const conflict = await this.conflictFor(tx, dto.practitionerId, order.id, order.scheduledAt, ends);
      if (conflict) throw AppError.conflict('PRACTITIONER_SCHEDULE_CONFLICT', `${affiliation.practitioner.fullName} already has a confirmed visit at that time (${conflict.code}).`, { orderCode: conflict.code });
      const created = await tx.orderAssignment.create({ data: { orderId: id, orderItemId: dto.orderItemId ?? null, practitionerId: dto.practitionerId, state: 'ACTIVE', assignedById: source.actorId } });
      await this.refreshAssignmentStatus(tx, id);
      await this.audit.record(source, { event: 'ORDER_PRACTITIONER_ASSIGNED', entityType: 'Order', entityId: id, facilityId, after: { assignmentId: created.id, practitionerId: dto.practitionerId, orderItemId: dto.orderItemId ?? null } }, tx);
    });
    return this.detail(facilityId, id);
  }

  async unassign(facilityId: string, id: string, assignmentId: string, source: Source) {
    const order = await this.owned(facilityId, id);
    if (!BUSY.includes(order.status as (typeof BUSY)[number])) throw AppError.conflict('ORDER_NOT_ASSIGNABLE', 'Assignments can only change while the order is confirmed or in progress.');
    await this.prisma.$transaction(async (tx) => {
      const removed = await tx.orderAssignment.updateMany({ where: { id: assignmentId, orderId: id, state: 'ACTIVE' }, data: { state: 'UNASSIGNED', unassignedAt: new Date() } });
      if (removed.count === 0) throw AppError.notFound();
      await this.refreshAssignmentStatus(tx, id);
      await this.audit.record(source, { event: 'ORDER_PRACTITIONER_UNASSIGNED', entityType: 'Order', entityId: id, facilityId, after: { assignmentId } }, tx);
    });
    return this.detail(facilityId, id);
  }

  // ─── Fulfilment ────────────────────────────────────────────────────────────

  /** CONFIRMED → IN_PROGRESS, only once everything is assigned; an unapproved order cannot start (AC-ORD-08). */
  async start(facilityId: string, id: string, source: Source) {
    const order = await this.owned(facilityId, id);
    if (order.status === 'CONFIRMED' && order.assignmentStatus !== 'ASSIGNED') throw AppError.unprocessable('ORDER_NOT_ASSIGNED', 'Assign a practitioner to every service before starting the visit.');
    await this.prisma.$transaction(async (tx) => {
      await transitionOrder(tx, order, 'IN_PROGRESS', source.actorId, null);
      await this.audit.record(source, { event: 'ORDER_STARTED', entityType: 'Order', entityId: id, facilityId, before: { status: order.status }, after: { status: 'IN_PROGRESS' } }, tx);
      await this.statusEvent(tx, order, 'IN_PROGRESS', null);
    });
    return this.detail(facilityId, id);
  }

  async itemStatus(facilityId: string, id: string, itemId: string, dto: ItemStatusDto, source: Source) {
    const order = await this.owned(facilityId, id);
    if (order.status !== 'IN_PROGRESS') throw AppError.conflict('ORDER_NOT_IN_PROGRESS', 'Start the visit before updating service progress.');
    const item = order.items.find((candidate) => candidate.id === itemId);
    if (!item) throw AppError.notFound();
    await this.prisma.$transaction(async (tx) => {
      await transitionItem(tx, item, dto.status, source.actorId, dto.reason ?? null);
      await this.audit.record(source, { event: 'ORDER_ITEM_STATUS_CHANGED', entityType: 'OrderItem', entityId: itemId, facilityId, before: { status: item.status }, after: { status: dto.status, reason: dto.reason ?? null } }, tx);
    });
    return this.detail(facilityId, id);
  }

  /** IN_PROGRESS → COMPLETED only when every item reached a terminal state (AC-ORD-09). */
  async complete(facilityId: string, id: string, source: Source) {
    const order = await this.owned(facilityId, id);
    const unfinished = order.items.filter((item) => !TERMINAL_ITEM.includes(item.status));
    if (order.status === 'IN_PROGRESS' && unfinished.length) {
      throw AppError.unprocessable('ORDER_ITEMS_UNFINISHED', 'Mark every service as completed or not performed before completing the order.', { items: unfinished.map((item) => item.id) });
    }
    await this.prisma.$transaction(async (tx) => {
      await transitionOrder(tx, order, 'COMPLETED', source.actorId, null);
      await this.audit.record(source, { event: 'ORDER_COMPLETED', entityType: 'Order', entityId: id, facilityId, before: { status: order.status }, after: { status: 'COMPLETED' } }, tx);
      await this.statusEvent(tx, order, 'COMPLETED', null);
    });
    return this.detail(facilityId, id);
  }

  // ─── Helpers ───────────────────────────────────────────────────────────────

  /** Orders of another clinic answer 404, never 403 (AC-ORD-07). */
  private async owned(facilityId: string, id: string) {
    const order = await this.prisma.order.findFirst({ where: { id, facilityId }, include: orderDetailInclude });
    if (!order) throw AppError.notFound();
    return order;
  }

  /** Another confirmed or in-progress visit of this practitioner that overlaps [start, end), at any clinic. */
  private async conflictFor(db: Db, practitionerId: string, orderId: string, start: Date, end: Date) {
    const candidates = await db.orderAssignment.findMany({
      where: { practitionerId, state: 'ACTIVE', orderId: { not: orderId }, order: { status: { in: [...BUSY] }, scheduledAt: { lt: end, gte: new Date(start.getTime() - 24 * 3_600_000) } } },
      select: { order: { select: { code: true, scheduledAt: true, items: { select: { durationMinutes: true, quantity: true } } } } },
    });
    const clash = candidates.find(({ order }) => overlaps(start, end, order.scheduledAt, new Date(order.scheduledAt.getTime() + visitMinutes(order.items) * 60_000)));
    return clash ? { code: clash.order.code, scheduledAt: clash.order.scheduledAt } : null;
  }

  private async refreshAssignmentStatus(tx: Db, orderId: string) {
    const [items, assignments] = await Promise.all([
      tx.orderItem.findMany({ where: { orderId }, select: { id: true } }),
      tx.orderAssignment.findMany({ where: { orderId, state: 'ACTIVE' }, select: { orderItemId: true } }),
    ]);
    await tx.order.update({ where: { id: orderId }, data: { assignmentStatus: assignmentStatusOf(items, assignments) } });
  }

  /** Customer-facing status change as a domain event (spec §5.5 step 9); delivery is decided later. */
  private async statusEvent(tx: Db, order: OrderDetail, status: string, reason: string | null) {
    await this.outbox.enqueue({ eventType: 'ORDER_STATUS_CHANGED', entityType: 'Order', entityId: order.id, payload: { code: order.code, customerId: order.customerId, status, reason, scheduledAt: order.scheduledAt.toISOString() } }, tx);
  }

  private patientName(snapshot: Prisma.JsonValue, masked: boolean) {
    const name = typeof snapshot === 'object' && snapshot && !Array.isArray(snapshot) && typeof snapshot.name === 'string' ? snapshot.name : '';
    return masked ? maskName(name) : name;
  }

  /** API shape with actor names; platform views get a masked patient and no visit address (least privilege). */
  private async present(order: OrderDetail, masked: boolean) {
    const actorIds = [...new Set([...order.statusHistory.map((entry) => entry.actorId), ...order.assignments.map((assignment) => assignment.assignedById)].filter((value): value is string => Boolean(value)))];
    const actors = actorIds.length ? await this.prisma.user.findMany({ where: { id: { in: actorIds } }, select: { id: true, name: true } }) : [];
    const names = new Map(actors.map((actor) => [actor.id, actor.name]));
    const patient = (order.patientSnapshot ?? {}) as { name?: string; phone?: string | null; sex?: string | null; birthYear?: number | null };
    const { idempotencyKey: _key, customerId: _customer, patientId: _patient, patientSnapshot: _snapshot, addressSnapshot, statusHistory, assignments, ...rest } = order;
    return {
      ...rest,
      durationMinutes: visitMinutes(order.items),
      patient: masked ? { name: maskName(patient.name ?? ''), phone: maskPhone(patient.phone ?? null), sex: patient.sex ?? null, birthYear: null } : { name: patient.name ?? '', phone: patient.phone ?? null, sex: patient.sex ?? null, birthYear: patient.birthYear ?? null },
      address: masked ? null : addressSnapshot,
      assignments: assignments.map(({ assignedById, ...assignment }) => ({ ...assignment, assignedBy: { id: assignedById, name: names.get(assignedById) ?? 'Staf' } })),
      history: statusHistory.map(({ actorId, ...entry }) => ({ ...entry, actor: actorId ? { id: actorId, name: names.get(actorId) ?? 'Staf' } : null })),
    };
  }
}
