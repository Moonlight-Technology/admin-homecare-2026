import { Injectable } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';

const IN_REVIEW = ['SUBMITTED', 'UNDER_REVIEW'] as const;
const QUEUE_SIZE = 5;
/** Display window for unassigned confirmed visits; not an SLA (spec §14 keeps deadlines open). */
const UNASSIGNED_WINDOW_MS = 24 * 60 * 60 * 1000;

export type OrderExceptionReason = 'PENDING_PAST_SCHEDULE' | 'NOT_STARTED_PAST_SCHEDULE' | 'UNASSIGNED_SOON';

/**
 * Objective order exceptions (spec §4 platform dashboard): facts from status and schedule only, no invented SLA.
 * - pending approval while the visit start has already passed;
 * - confirmed but not started although the visit start has passed;
 * - confirmed without full assignment and starting within the next 24 hours (or already started).
 */
export function orderExceptionWheres(now: Date) {
  const soon = new Date(now.getTime() + UNASSIGNED_WINDOW_MS);
  return {
    PENDING_PAST_SCHEDULE: { status: 'PENDING_APPROVAL', scheduledAt: { lte: now } },
    NOT_STARTED_PAST_SCHEDULE: { status: 'CONFIRMED', scheduledAt: { lte: now } },
    UNASSIGNED_SOON: { status: 'CONFIRMED', assignmentStatus: { not: 'ASSIGNED' }, scheduledAt: { lt: soon } },
  } satisfies Record<OrderExceptionReason, Prisma.OrderWhereInput>;
}

export function orderExceptionReasons(
  order: { status: string; assignmentStatus: string; scheduledAt: Date },
  now: Date,
): OrderExceptionReason[] {
  const started = order.scheduledAt.getTime() <= now.getTime();
  const reasons: OrderExceptionReason[] = [];
  if (order.status === 'PENDING_APPROVAL' && started) reasons.push('PENDING_PAST_SCHEDULE');
  if (order.status === 'CONFIRMED' && started) reasons.push('NOT_STARTED_PAST_SCHEDULE');
  if (order.status === 'CONFIRMED' && order.assignmentStatus !== 'ASSIGNED' &&
      order.scheduledAt.getTime() < now.getTime() + UNASSIGNED_WINDOW_MS) reasons.push('UNASSIGNED_SOON');
  return reasons;
}

/** Start and end of "today" in a facility timezone; MVP facilities are all Asia/Jakarta (UTC+7, no DST). */
export function jakartaDayBounds(now = new Date()) {
  const offsetMs = 7 * 60 * 60 * 1000;
  const local = new Date(now.getTime() + offsetMs);
  const start = new Date(Date.UTC(local.getUTCFullYear(), local.getUTCMonth(), local.getUTCDate()) - offsetMs);
  return { start, end: new Date(start.getTime() + 86_400_000) };
}

/**
 * Dashboard KPIs from authorised queries (spec §9). Order queues carry no patient identity: the dashboard
 * only needs codes, schedule, mode, and status (least privilege).
 */
@Injectable()
export class DashboardService {
  constructor(private readonly prisma: PrismaService) {}

  async platformSummary(now = new Date()) {
    const pendingFacility: Prisma.FacilityWhereInput = { verificationStatus: { in: [...IN_REVIEW] } };
    const pendingPractitioner: Prisma.PractitionerWhereInput = { verificationStatus: { in: [...IN_REVIEW] } };
    const exceptionWheres = orderExceptionWheres(now);
    const [
      [pendingFacilityReviews, pendingPractitionerReviews, activeFacilities, pendingOrderApprovals, openOrders, facilityQueue, practitionerQueue, recentOrders],
      [exceptionTotal, pendingPastSchedule, notStartedPastSchedule, unassignedSoon, exceptionOrders],
    ] = await Promise.all([Promise.all([
      this.prisma.facility.count({ where: pendingFacility }),
      this.prisma.practitioner.count({ where: pendingPractitioner }),
      this.prisma.facility.count({ where: { verificationStatus: 'VERIFIED', operatingStatus: 'ACTIVE' } }),
      this.prisma.order.count({ where: { status: 'PENDING_APPROVAL' } }),
      this.prisma.order.count({ where: { status: { in: ['CONFIRMED', 'IN_PROGRESS'] } } }),
      this.prisma.facility.findMany({
        where: pendingFacility,
        orderBy: { updatedAt: 'asc' },
        take: QUEUE_SIZE,
        select: { id: true, displayName: true, verificationStatus: true, updatedAt: true },
      }),
      this.prisma.practitioner.findMany({
        where: pendingPractitioner,
        orderBy: { updatedAt: 'asc' },
        take: QUEUE_SIZE,
        select: { id: true, fullName: true, verificationStatus: true, updatedAt: true, practitionerType: { select: { name: true } } },
      }),
      this.prisma.order.findMany({
        orderBy: { createdAt: 'desc' },
        take: QUEUE_SIZE,
        select: { id: true, code: true, status: true, mode: true, scheduledAt: true, createdAt: true, facility: { select: { displayName: true } }, _count: { select: { items: true } } },
      }),
    ]), Promise.all([
      this.prisma.order.count({ where: { OR: Object.values(exceptionWheres) } }),
      this.prisma.order.count({ where: exceptionWheres.PENDING_PAST_SCHEDULE }),
      this.prisma.order.count({ where: exceptionWheres.NOT_STARTED_PAST_SCHEDULE }),
      this.prisma.order.count({ where: exceptionWheres.UNASSIGNED_SOON }),
      this.prisma.order.findMany({
        where: { OR: Object.values(exceptionWheres) },
        orderBy: { scheduledAt: 'asc' },
        take: QUEUE_SIZE,
        select: { id: true, code: true, status: true, mode: true, assignmentStatus: true, scheduledAt: true, createdAt: true, facility: { select: { displayName: true } }, _count: { select: { items: true } } },
      }),
    ])]);
    return {
      kpis: { pendingFacilityReviews, pendingPractitionerReviews, activeFacilities, pendingOrderApprovals, openOrders },
      facilityQueue,
      practitionerQueue,
      recentOrders: recentOrders.map(({ _count, facility, ...order }) => ({ ...order, facilityName: facility?.displayName ?? null, itemCount: _count.items })),
      exceptions: {
        total: exceptionTotal,
        counts: { pendingPastSchedule, notStartedPastSchedule, unassignedSoon },
        orders: exceptionOrders.map(({ _count, facility, ...order }) => ({
          ...order,
          facilityName: facility?.displayName ?? null,
          itemCount: _count.items,
          reasons: orderExceptionReasons(order, now),
        })),
      },
    };
  }

  /** Always scoped to the caller's own facility, taken from their membership. */
  async clinicSummary(facilityId: string, now = new Date()) {
    const { start, end } = jakartaDayBounds(now);
    const today: Prisma.OrderWhereInput = { facilityId, scheduledAt: { gte: start, lt: end } };
    const [facility, pendingApproval, todayConfirmed, todayInProgress, activeOfferings, unassignedVisits, pendingQueue] = await Promise.all([
      this.prisma.facility.findUniqueOrThrow({ where: { id: facilityId }, select: { id: true, displayName: true, verificationStatus: true, operatingStatus: true } }),
      this.prisma.order.count({ where: { facilityId, status: 'PENDING_APPROVAL' } }),
      this.prisma.order.count({ where: { ...today, status: 'CONFIRMED' } }),
      this.prisma.order.count({ where: { ...today, status: 'IN_PROGRESS' } }),
      this.prisma.serviceOffering.count({ where: { status: 'PUBLISHED', provider: { facilityId } } }),
      this.prisma.order.count({ where: { facilityId, status: { in: ['CONFIRMED', 'IN_PROGRESS'] }, assignmentStatus: { not: 'ASSIGNED' } } }),
      this.prisma.order.findMany({
        where: { facilityId, status: 'PENDING_APPROVAL' },
        orderBy: { scheduledAt: 'asc' },
        take: QUEUE_SIZE,
        select: { id: true, code: true, status: true, mode: true, scheduledAt: true, createdAt: true, _count: { select: { items: true } } },
      }),
    ]);
    return {
      facility,
      kpis: { pendingApproval, todayConfirmed, todayInProgress, activeOfferings, unassignedVisits },
      pendingQueue: pendingQueue.map(({ _count, ...order }) => ({ ...order, itemCount: _count.items })),
    };
  }
}
