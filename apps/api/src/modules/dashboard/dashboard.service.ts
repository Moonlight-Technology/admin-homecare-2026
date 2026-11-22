import { Injectable } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';

const IN_REVIEW = ['SUBMITTED', 'UNDER_REVIEW'] as const;
const QUEUE_SIZE = 5;

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

  async platformSummary() {
    const pendingFacility: Prisma.FacilityWhereInput = { verificationStatus: { in: [...IN_REVIEW] } };
    const pendingPractitioner: Prisma.PractitionerWhereInput = { verificationStatus: { in: [...IN_REVIEW] } };
    const [pendingFacilityReviews, pendingPractitionerReviews, activeFacilities, pendingOrderApprovals, openOrders, facilityQueue, practitionerQueue, recentOrders] = await Promise.all([
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
    ]);
    return {
      kpis: { pendingFacilityReviews, pendingPractitionerReviews, activeFacilities, pendingOrderApprovals, openOrders },
      facilityQueue,
      practitionerQueue,
      recentOrders: recentOrders.map(({ _count, facility, ...order }) => ({ ...order, facilityName: facility?.displayName ?? null, itemCount: _count.items })),
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
