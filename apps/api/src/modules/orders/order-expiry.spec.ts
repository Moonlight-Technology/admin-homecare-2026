import { ConfigService } from '@nestjs/config';
import { Logger } from '@nestjs/common';
import type { PrismaService } from '../../prisma/prisma.service';
import { AppError } from '../../common/errors/app-error';
import { validateEnv } from '../../config/env.validation';
import type { AuditService } from '../audit/audit.service';
import type { OutboxService } from '../notifications/outbox.service';
import { approvalDeadline, OrderExpiryService, type ExpiryPolicy } from './order-expiry.service';

const now = new Date('2026-12-01T03:00:00Z');
const order = { id: 'o1', code: 'NK-TEST', facilityId: 'f1', customerId: 'c1', status: 'PENDING_APPROVAL' as const, version: 0, createdAt: new Date('2026-12-01T01:00:00Z'), scheduledAt: new Date('2026-12-01T08:00:00Z'), slotId: null };
function setup(policy: ExpiryPolicy = { mode: 'after_creation', minutes: 120 }) {
  const tx = { order: { findMany: jest.fn(async () => [order]), updateMany: jest.fn(async () => ({ count: 1 })), update: jest.fn() }, orderStatusHistory: { create: jest.fn() }, orderAssignment: { updateMany: jest.fn() }, $transaction: jest.fn() };
  tx.$transaction.mockImplementation((work: (db: unknown) => unknown) => work(tx));
  const audit = { record: jest.fn() };
  const outbox = { enqueue: jest.fn() };
  const config = new ConfigService({ ORDER_APPROVAL_EXPIRY_MODE: policy.mode, ORDER_APPROVAL_EXPIRY_MINUTES: policy.minutes });
  return { service: new OrderExpiryService(tx as unknown as PrismaService, config, audit as unknown as AuditService, outbox as unknown as OutboxService), tx, audit, outbox };
}

describe('approval expiry policy', () => {
  it('defaults to off and validates opt-in modes and duration', () => {
    const base = { DATABASE_URL: 'postgresql://test', WEB_ORIGIN: 'http://web', API_PUBLIC_URL: 'http://api', JWT_ACCESS_SECRET: 'a'.repeat(32), STORAGE_SIGNING_SECRET: 'b'.repeat(32), CREDENTIAL_ENCRYPTION_KEY: 'c'.repeat(32) };
    expect(validateEnv(base).ORDER_APPROVAL_EXPIRY_MODE).toBe('off');
    expect(validateEnv({ ...base, ORDER_APPROVAL_EXPIRY_MODE: 'at_visit' }).ORDER_APPROVAL_EXPIRY_MODE).toBe('at_visit');
    for (const minutes of ['', '0', '-1', '1.5', 'NaN', '525601']) expect(() => validateEnv({ ...base, ORDER_APPROVAL_EXPIRY_MODE: 'after_creation', ORDER_APPROVAL_EXPIRY_MINUTES: minutes })).toThrow('ORDER_APPROVAL_EXPIRY_MINUTES');
    expect(() => validateEnv({ ...base, ORDER_APPROVAL_EXPIRY_MODE: 'sometimes' })).toThrow('ORDER_APPROVAL_EXPIRY_MODE');
    expect(validateEnv({ ...base, ORDER_APPROVAL_EXPIRY_MODE: 'after_creation', ORDER_APPROVAL_EXPIRY_MINUTES: '1440' }).ORDER_APPROVAL_EXPIRY_MINUTES).toBe(1440);
  });

  it('uses exact deadline boundaries and does not invent a visit cutoff for creation-based TTL', () => {
    expect(approvalDeadline(order, { mode: 'off', minutes: 0 })).toBeNull();
    expect(approvalDeadline(order, { mode: 'at_visit', minutes: 0 })).toEqual(order.scheduledAt);
    const { service } = setup();
    expect(service.isDue(order, new Date(now.getTime() - 1))).toBe(false);
    expect(service.isDue(order, now)).toBe(true);
    expect(setup({ mode: 'at_visit', minutes: 0 }).service.isDue(order, now)).toBe(false);
  });

  it.each(['CONFIRMED', 'IN_PROGRESS', 'COMPLETED', 'CANCELLED', 'REJECTED', 'EXPIRED', 'NO_SHOW'] as const)('never expires %s', async (status) => {
    const { service, tx } = setup();
    await expect(service.expire(tx as never, { ...order, status }, now)).resolves.toBe(false);
    expect(tx.order.updateMany).not.toHaveBeenCalled();
  });

  it('writes system history/audit/outbox in caller transaction without touching money or capacity', async () => {
    const { service, tx, audit, outbox } = setup();
    await expect(service.expire(tx as never, order, now)).resolves.toBe(true);
    expect(tx.order.updateMany).toHaveBeenCalledWith({ where: { id: order.id, status: 'PENDING_APPROVAL', version: 0 }, data: { status: 'EXPIRED', version: { increment: 1 } } });
    expect(tx.orderStatusHistory.create).toHaveBeenCalledWith({ data: expect.objectContaining({ newStatus: 'EXPIRED', actorId: null, reason: expect.any(String) }) });
    expect(audit.record).toHaveBeenCalledWith({ scope: 'SYSTEM', actorId: null }, expect.objectContaining({ event: 'ORDER_EXPIRED', facilityId: 'f1' }), tx);
    expect(outbox.enqueue).toHaveBeenCalledWith(expect.objectContaining({ eventType: 'ORDER_STATUS_CHANGED', payload: expect.objectContaining({ status: 'EXPIRED', deadline: now.toISOString() }) }), tx);
    expect(tx.order.update).toHaveBeenCalledWith({ where: { id: 'o1' }, data: { assignmentStatus: 'UNASSIGNED' } });
  });

  it('a stale worker cannot expire approved/cancelled orders or duplicate events', async () => {
    const { service, tx, audit, outbox } = setup();
    tx.order.updateMany.mockResolvedValueOnce({ count: 0 });
    await expect(service.expire(tx as never, order, now)).rejects.toMatchObject({ code: 'ORDER_STATE_CHANGED' });
    expect(audit.record).not.toHaveBeenCalled(); expect(outbox.enqueue).not.toHaveBeenCalled();
    expect(tx.orderAssignment.updateMany).not.toHaveBeenCalled();
  });

  it('refuses an inconsistent pending reservation instead of freeing possibly foreign capacity', async () => {
    const { service, tx } = setup();
    await expect(service.expire(tx as never, { ...order, slotId: 's1' }, now)).rejects.toMatchObject({ code: 'PENDING_ORDER_HAS_RESERVATION' });
    expect(tx.order.updateMany).not.toHaveBeenCalled();
  });

  it('off mode performs no database queries', async () => {
    const { service, tx } = setup({ mode: 'off', minutes: 0 });
    await service.runOnce(now); service.onModuleInit(); await service.onModuleDestroy();
    expect(tx.order.findMany).not.toHaveBeenCalled();
  });

  it('bounds the sweep and ignores CAS conflicts from another replica', async () => {
    const { service, tx } = setup();
    tx.$transaction.mockRejectedValueOnce(AppError.conflict('ORDER_STATE_CHANGED', 'Changed'));
    await service.runOnce(now);
    expect(tx.order.findMany).toHaveBeenCalledWith({ where: { status: 'PENDING_APPROVAL', createdAt: { lte: order.createdAt } }, orderBy: { createdAt: 'asc' }, take: 25 });
  });

  it('visit-based sweeping queries the UTC scheduled start, not order age', async () => {
    const { service, tx } = setup({ mode: 'at_visit', minutes: 0 });
    tx.order.findMany.mockResolvedValueOnce([]);
    await service.runOnce(now);
    expect(tx.order.findMany).toHaveBeenCalledWith({ where: { status: 'PENDING_APPROVAL', scheduledAt: { lte: now } }, orderBy: { createdAt: 'asc' }, take: 25 });
  });

  it('does not overlap timer sweeps and waits for in-flight shutdown', async () => {
    jest.useFakeTimers();
    const { service, tx } = setup();
    let finish!: () => void;
    tx.order.findMany.mockImplementation(() => new Promise((done) => { finish = () => done([]); }));
    try {
      service.onModuleInit(); jest.advanceTimersByTime(180000);
      expect(tx.order.findMany).toHaveBeenCalledTimes(1);
      const stopped = service.onModuleDestroy(); finish(); await stopped;
      jest.advanceTimersByTime(60000); expect(tx.order.findMany).toHaveBeenCalledTimes(1);
    } finally { jest.useRealTimers(); }
  });

  it('logs safe errors and continues to later candidates', async () => {
    const log = jest.spyOn(Logger.prototype, 'error').mockImplementation(() => {});
    try {
      const { service, tx } = setup();
      tx.order.findMany.mockResolvedValueOnce([order, { ...order, id: 'o2' }]);
      tx.$transaction.mockRejectedValueOnce(new Error('postgresql://secret'));
      await service.runOnce(now);
      expect(tx.$transaction).toHaveBeenCalledTimes(2);
      expect(JSON.stringify(log.mock.calls)).not.toContain('secret');
    } finally { log.mockRestore(); }
  });
});
