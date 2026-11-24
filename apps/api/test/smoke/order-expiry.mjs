/** Invoked only inside the random-schema runner; no operational data or real notifications. */
import { randomUUID } from 'node:crypto';
import { countOutboxStatus } from './notification-test-utils.mjs';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { ConfigService } = require('@nestjs/config');
const { OrderExpiryService } = require('../../dist/modules/orders/order-expiry.service.js');
const { AuditService } = require('../../dist/modules/audit/audit.service.js');
const { OutboxService } = require('../../dist/modules/notifications/outbox.service.js');

export async function orderExpiry({ database: db, a, expect, call, check, notificationSecret }) {
  const provider = await db.provider.findFirstOrThrow({ where: { facilityId: a.id } });
  const offering = await db.serviceOffering.findFirstOrThrow({ where: { providerId: provider.id } });
  const now = new Date();
  const service = new OrderExpiryService(db, new ConfigService({ ORDER_APPROVAL_EXPIRY_MODE: 'after_creation', ORDER_APPROVAL_EXPIRY_MINUTES: 60 }), new AuditService(db), new OutboxService(db, new ConfigService({ CREDENTIAL_ENCRYPTION_KEY: notificationSecret })));
  const make = (extra = {}) => db.order.create({ data: { code: `EXP-${randomUUID()}`, customerId: randomUUID(), patientId: randomUUID(), providerId: provider.id, facilityId: a.id, mode: 'ON_SITE', scheduledAt: new Date(now.getTime() + 86400000), createdAt: new Date(now.getTime() - 7200000), patientSnapshot: { name: 'Expiry Test' }, itemSubtotal: '50000', grandTotal: '50000', ...extra, items: { create: { offeringId: offering.id, masterServiceId: offering.masterServiceId, nameSnapshot: 'Expiry Test', priceSnapshot: '50000', durationMinutes: 30, modeSnapshot: 'ON_SITE' } } } });
  const endpoint = (id, action = 'approve') => `/clinic/orders/${id}/${action}`;
  const late = await make();
  await expect('POST', endpoint(late.id), a.token, undefined, 409, 'late approval expires instead of reserving capacity');
  const after = await db.order.findUniqueOrThrow({ where: { id: late.id } });
  check('late approval commits EXPIRED with original money/items', after.status === 'EXPIRED' && after.slotId === null && after.grandTotal.toString() === '50000' && after.paymentStatus === 'NOT_CONFIGURED');
  const simultaneous = await make();
  await Promise.all([service.runOnce(), service.runOnce()]);
  check('two real PostgreSQL sweepers expire pending order once', (await db.order.findUniqueOrThrow({ where: { id: simultaneous.id } })).status === 'EXPIRED');
  check('one system history/audit/outbox for concurrent sweepers', await db.orderStatusHistory.count({ where: { orderId: simultaneous.id, newStatus: 'EXPIRED', actorId: null } }) === 1 && await db.auditLog.count({ where: { entityId: simultaneous.id, event: 'ORDER_EXPIRED', scope: 'SYSTEM' } }) === 1 && await countOutboxStatus(db, simultaneous.id, 'EXPIRED', notificationSecret) === 1);
  const notDue = await make({ createdAt: now });
  const confirmed = await make({ status: 'CONFIRMED' });
  await service.runOnce();
  check('fresh pending and confirmed orders untouched', (await db.order.findUniqueOrThrow({ where: { id: notDue.id } })).status === 'PENDING_APPROVAL' && (await db.order.findUniqueOrThrow({ where: { id: confirmed.id } })).status === 'CONFIRMED');
  const cancelledRace = await make();
  const outcomes = await Promise.all([call('POST', endpoint(cancelledRace.id, 'cancel'), a.token, { reason: 'Pembatalan bersamaan dengan expiry' }), service.runOnce()]);
  const raced = await db.order.findUniqueOrThrow({ where: { id: cancelledRace.id } });
  check('cancel/expiry race has one terminal transition and no server error', [200, 409].includes(outcomes[0].status) && ['EXPIRED', 'CANCELLED'].includes(raced.status) && await db.orderStatusHistory.count({ where: { orderId: raced.id } }) === 1);
  await expect('POST', endpoint(simultaneous.id), a.token, undefined, 409, 'expired order cannot be approved again');
  await expect('POST', endpoint(simultaneous.id, 'cancel'), a.token, { reason: 'Tidak boleh dibatalkan kembali' }, 409, 'expired order cannot be cancelled');
  const automatic = await make();
  const timeout = Date.now() + 90000;
  while (Date.now() < timeout) {
    if ((await db.order.findUniqueOrThrow({ where: { id: automatic.id } })).status === 'EXPIRED') break;
    await new Promise((done) => setTimeout(done, 2000));
  }
  check('API background timer expires order without a user request', (await db.order.findUniqueOrThrow({ where: { id: automatic.id } })).status === 'EXPIRED');
  const rollback = await make({ createdAt: new Date() });
  const failing = new OrderExpiryService(db, new ConfigService({ ORDER_APPROVAL_EXPIRY_MODE: 'after_creation', ORDER_APPROVAL_EXPIRY_MINUTES: 60 }), new AuditService(db), { enqueue: async () => { throw new Error('isolated outbox failure'); } });
  let rejected = false;
  try { await db.$transaction((tx) => failing.expire(tx, rollback, new Date(now.getTime() + 7200000))); } catch { rejected = true; }
  check('outbox failure rolls expiry/history/audit back on PostgreSQL', rejected && (await db.order.findUniqueOrThrow({ where: { id: rollback.id } })).status === 'PENDING_APPROVAL' && await db.orderStatusHistory.count({ where: { orderId: rollback.id } }) === 0 && await db.auditLog.count({ where: { entityId: rollback.id } }) === 0 && await db.notificationOutbox.count({ where: { entityId: rollback.id } }) === 0);
  await service.onModuleDestroy();
}
