import type { OrderItemStatus, OrderStatus } from '@prisma/client';
import { AppError } from '../../common/errors/app-error';
import type { Db } from '../../prisma/prisma.service';

/**
 * The one place order and item transitions are decided (spec §6). Clinic cancellation is pre-visit only;
 * EXPIRED is opt-in for pending approval only; manual NO_SHOW is guarded by the elapsed visit window.
 */
export const ORDER_TRANSITIONS: Record<OrderStatus, OrderStatus[]> = {
  PENDING_APPROVAL: ['CONFIRMED', 'REJECTED', 'CANCELLED', 'EXPIRED'],
  CONFIRMED: ['IN_PROGRESS', 'CANCELLED', 'NO_SHOW'],
  IN_PROGRESS: ['COMPLETED'],
  REJECTED: [],
  COMPLETED: [],
  CANCELLED: [],
  EXPIRED: [],
  NO_SHOW: [],
};

export const ITEM_TRANSITIONS: Record<OrderItemStatus, OrderItemStatus[]> = {
  PENDING: ['IN_PROGRESS', 'COMPLETED', 'NOT_PERFORMED'],
  IN_PROGRESS: ['COMPLETED', 'NOT_PERFORMED'],
  COMPLETED: [],
  NOT_PERFORMED: [],
};

export const TERMINAL_ITEM: OrderItemStatus[] = ['COMPLETED', 'NOT_PERFORMED'];

export const canTransition = (from: OrderStatus, to: OrderStatus) => ORDER_TRANSITIONS[from].includes(to);

const LABELS: Partial<Record<OrderStatus, string>> = { PENDING_APPROVAL: 'waiting for approval', CONFIRMED: 'confirmed', IN_PROGRESS: 'in progress', REJECTED: 'rejected', COMPLETED: 'completed' };

/**
 * Moves an order from `from` to `to` inside the caller's transaction. The update is conditional on the status and
 * version the caller read, so of two concurrent transitions only the first commits; the other gets 409 and none of
 * its side effects run (AC-ORD-06). Appends the status history row.
 */
export async function transitionOrder(
  tx: Db,
  order: { id: string; status: OrderStatus; version: number },
  to: OrderStatus,
  actorId: string | null,
  reason: string | null,
  data: { rejectionReason?: string | null } = {},
) {
  if (!canTransition(order.status, to)) {
    throw AppError.conflict('ORDER_TRANSITION_NOT_ALLOWED', `An order that is ${LABELS[order.status] ?? order.status.toLowerCase()} cannot become ${LABELS[to] ?? to.toLowerCase()}.`);
  }
  const moved = await tx.order.updateMany({ where: { id: order.id, status: order.status, version: order.version }, data: { status: to, version: { increment: 1 }, ...data } });
  if (moved.count === 0) throw AppError.conflict('ORDER_STATE_CHANGED', 'The order changed in the meantime. Reload to see its latest status.');
  await tx.orderStatusHistory.create({ data: { orderId: order.id, previousStatus: order.status, newStatus: to, actorId, reason } });
}

/** Item progress, with the same conditional-update guarantee. NOT_PERFORMED needs a reason (also a DB check). */
export async function transitionItem(tx: Db, item: { id: string; status: OrderItemStatus }, to: OrderItemStatus, actorId: string, reason: string | null) {
  if (!ITEM_TRANSITIONS[item.status].includes(to)) throw AppError.conflict('ITEM_TRANSITION_NOT_ALLOWED', `A ${item.status.toLowerCase().replace('_', ' ')} item cannot become ${to.toLowerCase().replace('_', ' ')}.`);
  if (to === 'NOT_PERFORMED' && (reason ?? '').length < 5) throw AppError.unprocessable('VALIDATION_FAILED', 'A reason is required when a service was not performed.', { fields: { reason: ['reason must be at least 5 characters'] } });
  const moved = await tx.orderItem.updateMany({ where: { id: item.id, status: item.status }, data: { status: to, ...(to === 'NOT_PERFORMED' ? { notPerformedReason: reason } : {}) } });
  if (moved.count === 0) throw AppError.conflict('ITEM_STATE_CHANGED', 'The service status changed in the meantime. Reload and try again.');
  await tx.orderItemStatusHistory.create({ data: { orderItemId: item.id, previousStatus: item.status, newStatus: to, actorId, reason } });
}
