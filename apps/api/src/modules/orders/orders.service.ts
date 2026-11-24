import { Injectable } from '@nestjs/common';
import { Prisma, type AssignmentStatus } from '@prisma/client';
import { AppError } from '../../common/errors/app-error';
import { paginate, skipTake } from '../../common/dto/pagination.dto';
import { PrismaService, type Db } from '../../prisma/prisma.service';
import { AuditService, type AuditSource } from '../audit/audit.service';
import { AvailabilityService } from '../availability/availability.service';
import { addDays, localDate, localToUtc } from '../availability/slot-math';
import { OutboxService } from '../notifications/outbox.service';
import type { AdminOrderQueryDto, AssignPractitionerDto, CancelOrderDto, ItemStatusDto, NoShowOrderDto, OrderQueryDto, RejectOrderDto, RescheduleOrderDto } from './dto/order.dto';
import { TERMINAL_ITEM, transitionItem, transitionOrder } from './order-state';
import { OrderExpiryService } from './order-expiry.service';

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
    private readonly expiry: OrderExpiryService,
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
    const expired = await this.prisma.$transaction(async (tx) => {
      // Commit expiry before returning 409; throwing inside this callback would roll it back.
      if (await this.expiry.expire(tx, order)) return true;
      await transitionOrder(tx, order, 'CONFIRMED', source.actorId, null);
      const slotId = await this.availability.reserve(tx, { facilityId, mode: order.mode, startsAt: order.scheduledAt, durationMinutes: visitMinutes(order.items) });
      await tx.order.update({ where: { id }, data: { slotId } });
      await this.audit.record(source, { event: 'ORDER_APPROVED', entityType: 'Order', entityId: id, facilityId, before: { status: order.status }, after: { status: 'CONFIRMED', slotId } }, tx);
      await this.statusEvent(tx, order, 'CONFIRMED', null);
      return false;
    });
    if (expired) throw AppError.conflict('ORDER_APPROVAL_EXPIRED', 'The approval deadline has passed. This order has expired; reload to see its latest status.');
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

  /** Clinic-authorised pre-visit cancellation; no financial side effects or automatic customer cancellation. */
  async cancel(facilityId: string, id: string, dto: CancelOrderDto, source: Source) {
    const reason = typeof dto.reason === 'string' ? dto.reason.trim() : '';
    if (reason.length < 5 || reason.length > 1000) throw AppError.unprocessable('VALIDATION_FAILED', 'A cancellation reason of 5–1000 characters is required.', { fields: { reason: ['reason must be 5–1000 characters'] } });
    const order = await this.owned(facilityId, id);
    await this.prisma.$transaction(async (tx) => {
      // CAS acquires the order lock first; only the winning request may release capacity or assignments.
      await transitionOrder(tx, order, 'CANCELLED', source.actorId, reason);
      if (order.status === 'CONFIRMED') {
        if (!order.slotId) throw AppError.conflict('SLOT_RESERVATION_MISSING', 'The confirmed order has no slot reservation. Contact an administrator.');
        await this.availability.release(tx, order.slotId, facilityId);
      }
      await tx.orderAssignment.updateMany({ where: { orderId: id, state: 'ACTIVE' }, data: { state: 'UNASSIGNED', unassignedAt: new Date() } });
      // Keep slotId and item/price snapshots for historical traceability; status prevents a second release.
      await tx.order.update({ where: { id }, data: { assignmentStatus: 'UNASSIGNED' } });
      await this.audit.record(source, { event: 'ORDER_CANCELLED', entityType: 'Order', entityId: id, facilityId, before: { status: order.status, assignmentStatus: order.assignmentStatus }, after: { status: 'CANCELLED', assignmentStatus: 'UNASSIGNED', reason, releasedSlotId: order.status === 'CONFIRMED' ? order.slotId : null } }, tx);
      await this.statusEvent(tx, order, 'CANCELLED', reason);
    });
    return this.detail(facilityId, id);
  }

  /** Assign a verified active affiliate; overlapping confirmed visits are refused across all clinics. */
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
      await this.lockAssignmentChange(tx, order);
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
      await this.lockAssignmentChange(tx, order);
      const removed = await tx.orderAssignment.updateMany({ where: { id: assignmentId, orderId: id, state: 'ACTIVE' }, data: { state: 'UNASSIGNED', unassignedAt: new Date() } });
      if (removed.count === 0) throw AppError.notFound();
      await this.refreshAssignmentStatus(tx, id);
      await this.audit.record(source, { event: 'ORDER_PRACTITIONER_UNASSIGNED', entityType: 'Order', entityId: id, facilityId, after: { assignmentId } }, tx);
    });
    return this.detail(facilityId, id);
  }

  // ─── Fulfilment ────────────────────────────────────────────────────────────

  private assertReschedulable(order: OrderDetail, now = new Date()) {
    if (order.status !== 'CONFIRMED' || order.scheduledAt <= now || !order.items.length || order.items.some((item) => item.status !== 'PENDING')) throw AppError.conflict('ORDER_NOT_RESCHEDULABLE', 'Only future confirmed, unstarted visits can be rescheduled.');
    if (!order.slotId) throw AppError.conflict('SLOT_RESERVATION_MISSING', 'The confirmed order has no original reservation.');
  }

  async rescheduleSlots(facilityId: string, id: string, date: string) {
    const order = await this.owned(facilityId, id);
    this.assertReschedulable(order);
    const slots = await this.availability.slotsForVisit(facilityId, order.mode, date, visitMinutes(order.items));
    return { ...slots, slots: slots.slots.filter((slot) => slot.startsAt.getTime() !== order.scheduledAt.getTime()) };
  }

  /** Move only time/capacity, with optimistic order locking and stable practitioner/slot lock ordering. */
  async reschedule(facilityId: string, id: string, dto: RescheduleOrderDto, source: Source) {
    const reason = typeof dto.reason === 'string' ? dto.reason.trim() : '';
    const startsAt = new Date(dto.scheduledAt);
    if (reason.length < 5 || reason.length > 1000 || !Number.isFinite(startsAt.getTime()) || !Number.isInteger(dto.version) || dto.version < 0) throw AppError.unprocessable('VALIDATION_FAILED', 'A valid time, order version and 5–1000-character reason are required.');
    const order = await this.owned(facilityId, id);
    this.assertReschedulable(order);
    if (dto.version !== order.version) throw AppError.conflict('ORDER_STATE_CHANGED', 'Reload the latest order before rescheduling.');
    if (startsAt.getTime() === order.scheduledAt.getTime()) throw AppError.conflict('SCHEDULE_UNCHANGED', 'Choose a different visit time.');
    if (startsAt <= new Date()) throw AppError.conflict('SLOT_UNAVAILABLE', 'Choose a future visit time.');
    await this.prisma.$transaction(async (tx) => {
      await this.lockAssignmentChange(tx, order);
      this.assertReschedulable(order);
      const facility = await tx.facility.findUniqueOrThrow({ where: { id: facilityId }, select: { verificationStatus: true, operatingStatus: true, provider: { select: { status: true } } } });
      if (facility.verificationStatus !== 'VERIFIED' || facility.operatingStatus !== 'ACTIVE' || facility.provider?.status !== 'ACTIVE') throw AppError.conflict('FACILITY_NOT_ACTIVE', 'The clinic must be verified and active to reschedule.');
      const practitioners = [...new Set(order.assignments.map((assignment) => assignment.practitioner.id))].sort();
      for (const practitionerId of practitioners) await tx.practitioner.update({ where: { id: practitionerId }, data: { updatedAt: new Date() } });
      if (practitioners.length) {
        const visitDay = new Date(`${localDate(startsAt, order.timezone)}T00:00:00Z`);
        const eligible = await tx.practitionerAffiliation.findMany({ where: { facilityId, practitionerId: { in: practitioners }, status: 'ACTIVE', OR: [{ startDate: null }, { startDate: { lte: visitDay } }], AND: [{ OR: [{ endDate: null }, { endDate: { gte: visitDay } }] }], practitioner: { verificationStatus: 'VERIFIED', operatingStatus: 'ACTIVE' } }, select: { practitionerId: true } });
        if (new Set(eligible.map((entry) => entry.practitionerId)).size !== practitioners.length) throw AppError.conflict('PRACTITIONER_NOT_AVAILABLE', 'An assigned practitioner is not active or affiliated on the new visit date.');
        const endsAt = new Date(startsAt.getTime() + visitMinutes(order.items) * 60_000);
        for (const practitionerId of practitioners) {
          const conflict = await this.conflictFor(tx, practitionerId, id, startsAt, endsAt);
          if (conflict) throw AppError.conflict('PRACTITIONER_SCHEDULE_CONFLICT', 'An assigned practitioner has an overlapping visit.', { orderCode: conflict.code });
        }
      }
      // Existing source/target slots are locked in ID order, so two simultaneous moves cannot deadlock by swapping slots.
      const locks = await tx.facilitySlot.findMany({ where: { OR: [{ id: order.slotId! }, { facilityId, mode: order.mode, startsAt }] }, orderBy: { id: 'asc' }, select: { id: true } });
      for (const slot of locks) await tx.facilitySlot.updateMany({ where: { id: slot.id }, data: { version: { increment: 1 } } });
      const slotId = await this.availability.reserve(tx, { facilityId, mode: order.mode, startsAt, durationMinutes: visitMinutes(order.items) }, new Date());
      await this.availability.release(tx, order.slotId!, facilityId);
      await tx.order.update({ where: { id }, data: { scheduledAt: startsAt, slotId } });
      const display = (date: Date) => new Intl.DateTimeFormat('id-ID', { timeZone: order.timezone, dateStyle: 'medium', timeStyle: 'short' }).format(date);
      await tx.orderStatusHistory.create({ data: { orderId: id, previousStatus: 'CONFIRMED', newStatus: 'CONFIRMED', actorId: source.actorId, reason: `Jadwal diubah: ${display(order.scheduledAt)} → ${display(startsAt)} (${order.timezone}). Alasan: ${reason}` } });
      await this.audit.record(source, { event: 'ORDER_RESCHEDULED', entityType: 'Order', entityId: id, facilityId, before: { scheduledAt: order.scheduledAt.toISOString(), slotId: order.slotId, version: order.version }, after: { scheduledAt: startsAt.toISOString(), slotId, version: order.version + 1, reason } }, tx);
      await this.outbox.enqueue({ eventType: 'ORDER_RESCHEDULED', entityType: 'Order', entityId: id, payload: { code: order.code, customerId: order.customerId, previousScheduledAt: order.scheduledAt.toISOString(), scheduledAt: startsAt.toISOString(), reason } }, tx);
    });
    return this.detail(facilityId, id);
  }

  /** Manual no-show only after the full visit window, never a payment/penalty operation. */
  async noShow(facilityId: string, id: string, dto: NoShowOrderDto, source: Source) {
    const reason = typeof dto.reason === 'string' ? dto.reason.trim() : '';
    if (reason.length < 5 || reason.length > 1000) throw AppError.unprocessable('VALIDATION_FAILED', 'A no-show reason of 5–1000 characters is required.', { fields: { reason: ['reason must be 5–1000 characters'] } });
    const order = await this.owned(facilityId, id);
    if (order.status !== 'CONFIRMED') throw AppError.conflict('ORDER_TRANSITION_NOT_ALLOWED', 'Only a confirmed, unstarted order can be marked no-show.');
    const endsAt = new Date(order.scheduledAt.getTime() + visitMinutes(order.items) * 60_000);
    const now = new Date();
    if (endsAt > now) throw AppError.conflict('NO_SHOW_TOO_EARLY', 'The full scheduled visit window must end before recording a no-show.', { eligibleAt: endsAt.toISOString() });
    if (!order.items.length || order.items.some((item) => item.status !== 'PENDING')) throw AppError.conflict('ORDER_SERVICES_ALREADY_PROGRESSED', 'Started or already processed services cannot be marked no-show.');
    await this.prisma.$transaction(async (tx) => {
      await transitionOrder(tx, order, 'NO_SHOW', source.actorId, reason);
      const changed = await tx.orderItem.updateMany({ where: { orderId: id, id: { in: order.items.map((item) => item.id) }, status: 'PENDING' }, data: { status: 'NOT_PERFORMED', notPerformedReason: reason } });
      if (changed.count !== order.items.length) throw AppError.conflict('ITEM_STATE_CHANGED', 'Service progress changed. Reload before recording no-show.');
      await tx.orderItemStatusHistory.createMany({ data: order.items.map((item) => ({ orderItemId: item.id, previousStatus: 'PENDING' as const, newStatus: 'NOT_PERFORMED' as const, actorId: source.actorId, reason })) });
      await tx.orderAssignment.updateMany({ where: { orderId: id, state: 'ACTIVE' }, data: { state: 'UNASSIGNED', unassignedAt: now } });
      await tx.order.update({ where: { id }, data: { assignmentStatus: 'UNASSIGNED' } });
      // The elapsed appointment consumed its historical window; never reopen capacity or change money.
      await this.audit.record(source, { event: 'ORDER_NO_SHOW', entityType: 'Order', entityId: id, facilityId, before: { status: order.status, assignmentStatus: order.assignmentStatus }, after: { status: 'NO_SHOW', reason, itemStatus: 'NOT_PERFORMED', itemIds: order.items.map((item) => item.id), assignmentStatus: 'UNASSIGNED', slotId: order.slotId, scheduledEnd: endsAt.toISOString() } }, tx);
      await this.statusEvent(tx, order, 'NO_SHOW', reason);
    });
    return this.detail(facilityId, id);
  }

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
      where: { practitionerId, state: 'ACTIVE', orderId: { not: orderId }, order: { status: { in: [...BUSY] }, scheduledAt: { lt: end } } },
      select: { order: { select: { code: true, scheduledAt: true, items: { select: { durationMinutes: true, quantity: true } } } } },
    });
    const clash = candidates.find(({ order }) => overlaps(start, end, order.scheduledAt, new Date(order.scheduledAt.getTime() + visitMinutes(order.items) * 60_000)));
    return clash ? { code: clash.order.code, scheduledAt: clash.order.scheduledAt } : null;
  }

  /** Serialize assignment edits against cancellation/start and invalidate stale assignment snapshots. */
  private async lockAssignmentChange(tx: Db, order: OrderDetail) {
    const locked = await tx.order.updateMany({ where: { id: order.id, facilityId: order.facilityId, status: order.status, version: order.version }, data: { version: { increment: 1 } } });
    if (!locked.count) throw AppError.conflict('ORDER_STATE_CHANGED', 'The order changed in the meantime. Reload to see its latest status.');
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
