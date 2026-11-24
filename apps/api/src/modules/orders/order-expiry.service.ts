import { Injectable, Logger, type OnModuleDestroy, type OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Prisma, type Order } from '@prisma/client';
import { AppError } from '../../common/errors/app-error';
import { PrismaService, type Db } from '../../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { OutboxService } from '../notifications/outbox.service';
import { transitionOrder } from './order-state';

export type ExpiryPolicy = { mode: 'off' | 'after_creation' | 'at_visit'; minutes: number };
type ExpirableOrder = Pick<Order, 'id' | 'code' | 'status' | 'version' | 'createdAt' | 'scheduledAt' | 'facilityId' | 'customerId' | 'slotId'>;

export function approvalDeadline(order: Pick<Order, 'createdAt' | 'scheduledAt'>, policy: ExpiryPolicy): Date | null {
  if (policy.mode === 'off') return null;
  return policy.mode === 'at_visit' ? order.scheduledAt : new Date(order.createdAt.getTime() + policy.minutes * 60_000);
}

/** Opt-in expiry, safe across replicas through the existing status/version CAS. No paid/confirmed order is touched. */
@Injectable()
export class OrderExpiryService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger('OrderExpiry');
  private timer?: ReturnType<typeof setInterval>;
  private active?: Promise<void>;
  private stopping = false;

  constructor(private readonly prisma: PrismaService, private readonly config: ConfigService, private readonly audit: AuditService, private readonly outbox: OutboxService) {}

  policy(): ExpiryPolicy {
    return { mode: this.config.get<ExpiryPolicy['mode']>('ORDER_APPROVAL_EXPIRY_MODE', 'off'), minutes: this.config.get<number>('ORDER_APPROVAL_EXPIRY_MINUTES', 0) };
  }

  isDue(order: ExpirableOrder, now = new Date()) {
    const deadline = approvalDeadline(order, this.policy());
    return order.status === 'PENDING_APPROVAL' && deadline !== null && deadline <= now;
  }

  /** Caller owns the transaction; expiry and all its events either commit together or roll back together. */
  async expire(tx: Db, order: ExpirableOrder, now = new Date()) {
    if (!this.isDue(order, now)) return false;
    if (order.slotId) throw AppError.conflict('PENDING_ORDER_HAS_RESERVATION', 'Pending order has unexpected reserved capacity; administrator review is required.');
    const deadline = approvalDeadline(order, this.policy())!;
    const reason = 'Batas waktu persetujuan order telah berakhir.';
    await transitionOrder(tx, order, 'EXPIRED', null, reason);
    await tx.orderAssignment.updateMany({ where: { orderId: order.id, state: 'ACTIVE' }, data: { state: 'UNASSIGNED', unassignedAt: now } });
    await tx.order.update({ where: { id: order.id }, data: { assignmentStatus: 'UNASSIGNED' } });
    await this.audit.record({ actorId: null, scope: 'SYSTEM' }, { event: 'ORDER_EXPIRED', entityType: 'Order', entityId: order.id, facilityId: order.facilityId, before: { status: order.status }, after: { status: 'EXPIRED', reason, deadline: deadline.toISOString(), policy: this.policy() } }, tx);
    await this.outbox.enqueue({ eventType: 'ORDER_STATUS_CHANGED', entityType: 'Order', entityId: order.id, payload: { code: order.code, customerId: order.customerId, status: 'EXPIRED', reason, scheduledAt: order.scheduledAt.toISOString(), deadline: deadline.toISOString() } }, tx);
    return true;
  }

  async runOnce(now = new Date()) {
    const policy = this.policy();
    if (policy.mode === 'off' || this.stopping) return;
    const due = policy.mode === 'at_visit' ? { scheduledAt: { lte: now } } : { createdAt: { lte: new Date(now.getTime() - policy.minutes * 60_000) } };
    const orders = await this.prisma.order.findMany({ where: { status: 'PENDING_APPROVAL', ...due }, orderBy: { createdAt: 'asc' }, take: 25 });
    for (const order of orders) {
      if (this.stopping) break;
      try { await this.prisma.$transaction((tx) => this.expire(tx, order, now)); }
      catch (error) {
        if (error instanceof AppError && ['ORDER_STATE_CHANGED', 'ORDER_TRANSITION_NOT_ALLOWED'].includes(error.code)) continue;
        // No patient data, request bodies, SQL or connection details in worker logs.
        this.logger.error({ event: 'ORDER_EXPIRY_FAILED', orderId: order.id, code: error instanceof AppError || error instanceof Prisma.PrismaClientKnownRequestError ? error.code : 'UNEXPECTED_ERROR' });
      }
    }
  }

  private tick() {
    if (this.active || this.stopping) return;
    this.active = this.runOnce().catch(() => this.logger.error({ event: 'ORDER_EXPIRY_SWEEP_FAILED' })).finally(() => { this.active = undefined; });
  }

  onModuleInit() {
    if (this.policy().mode === 'off') return;
    this.timer = setInterval(() => this.tick(), 60_000);
    this.timer.unref();
    this.tick();
  }

  async onModuleDestroy() {
    this.stopping = true;
    if (this.timer) clearInterval(this.timer);
    await this.active;
  }
}
