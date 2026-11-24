/** Real HTTP/PostgreSQL tests called only from the random-schema runner. */
import { randomUUID } from 'node:crypto';
import { countOutboxStatus } from './notification-test-utils.mjs';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { OrdersService } = require('../../dist/modules/orders/orders.service.js');
const { AuditService } = require('../../dist/modules/audit/audit.service.js');

export async function orderNoShow({ database: db, a, b, practitionerId, expect, call, check, owner, staff, provider, offering, notificationSecret }) {
  const permission = await db.permission.findUniqueOrThrow({ where: { code: 'order:read' } });
  const role = await db.role.create({ data: { code: 'NO_SHOW_READER', scope: 'FACILITY', name: 'No-show read only', permissions: { create: { permissionId: permission.id } } } });
  const staffAccount = await db.user.findUniqueOrThrow({ where: { email: 'order-staff@isolated.test' } });
  const membership = await db.membership.findFirstOrThrow({ where: { userId: staffAccount.id, facilityId: a.id } });
  let sequence = 0;
  async function make({ status = 'CONFIRMED', startsAt = new Date(Date.now() - 7200000 - sequence++ * 86400000), itemStatus = 'PENDING' } = {}) {
    const slot = await db.facilitySlot.create({ data: { facilityId: a.id, mode: 'ON_SITE', startsAt, endsAt: new Date(startsAt.getTime() + 3600000), capacity: 1, reserved: 1 } });
    const order = await db.order.create({ data: {
      code: `NOSHOW-${randomUUID()}`, customerId: randomUUID(), patientId: randomUUID(), providerId: provider.id, facilityId: a.id,
      mode: 'ON_SITE', scheduledAt: startsAt, slotId: slot.id, status, assignmentStatus: 'ASSIGNED', patientSnapshot: { name: 'No-show Test' },
      itemSubtotal: '100000', feeTotal: '0', grandTotal: '100000',
      items: { create: [0, 1].map(() => ({ offeringId: offering.id, masterServiceId: offering.masterServiceId, nameSnapshot: 'No-show Test', priceSnapshot: '25000', durationMinutes: 15, quantity: 2, modeSnapshot: 'ON_SITE', status: itemStatus, ...(itemStatus === 'NOT_PERFORMED' ? { notPerformedReason: 'Prior operational outcome' } : {}) })) },
      assignments: { create: { practitionerId, assignedById: owner.id, state: 'ACTIVE' } },
    } });
    return { order, slot };
  }
  const path = (id, action = 'no-show') => `/clinic/orders/${id}/${action}`;
  const reason = { reason: 'Pasien tidak datang dan tidak dapat dihubungi' };
  const { order, slot } = await make();
  await expect('POST', path(order.id), null, reason, 401, 'anonymous cannot mark no-show');
  // Reuse the existing session rather than exceed the real five-logins/minute guard.
  // Guards reload membership permissions; role changes here affect only disposable fixture data.
  await db.membership.update({ where: { id: membership.id }, data: { roleId: role.id } });
  await expect('POST', path(order.id), staff, reason, 403, 'read-only account cannot mark no-show');
  await db.membership.update({ where: { id: membership.id }, data: { roleId: membership.roleId } });
  await expect('POST', path(order.id), b.token, reason, 404, 'other clinic cannot mark no-show');
  for (const input of [{}, { reason: ' ' }, { reason: 'abc' }, { reason: 'x'.repeat(1001) }, { ...reason, facilityId: b.id }]) await expect('POST', path(order.id), staff, input, 422, 'no-show DTO validation');
  for (const startsAt of [new Date(Date.now() + 3600000), new Date(Date.now() - 1800000)]) {
    const early = await make({ startsAt });
    const response = await expect('POST', path(early.order.id), staff, reason, 409, 'no-show before complete visit window denied');
    check('early response identifies eligible time', response.code === 'NO_SHOW_TOO_EARLY' && response.details.eligibleAt === new Date(startsAt.getTime() + 3600000).toISOString());
    check('early request has no partial write', await db.orderStatusHistory.count({ where: { orderId: early.order.id } }) === 0);
  }
  const race = await Promise.all([0, 1].map(() => call('POST', path(order.id), staff, reason)));
  check('two no-show requests commit exactly once', race.map((r) => r.status).sort().join(',') === '200,409');
  const detail = await expect('GET', `/clinic/orders/${order.id}`, staff, undefined, 200, 'no-show detail stays readable');
  check('staff can record no-show without approval permission', detail.status === 'NO_SHOW' && detail.assignmentStatus === 'UNASSIGNED');
  check('every service is not performed with reason and snapshots intact', detail.items.length === 2 && detail.items.every((item) => item.status === 'NOT_PERFORMED' && item.notPerformedReason === reason.reason && item.quantity === 2 && item.priceSnapshot === '25000'));
  check('historical capacity and money retained', detail.slotId === slot.id && detail.grandTotal === '100000' && detail.paymentStatus === 'NOT_CONFIGURED' && (await db.facilitySlot.findUniqueOrThrow({ where: { id: slot.id } })).reserved === 1);
  check('one order history, two service histories and one audit/outbox', await db.orderStatusHistory.count({ where: { orderId: order.id, newStatus: 'NO_SHOW', actorId: staffAccount.id } }) === 1 && await db.orderItemStatusHistory.count({ where: { orderItem: { orderId: order.id }, newStatus: 'NOT_PERFORMED', actorId: staffAccount.id } }) === 2 && await db.auditLog.count({ where: { entityId: order.id, event: 'ORDER_NO_SHOW', facilityId: a.id } }) === 1 && await countOutboxStatus(db, order.id, 'NO_SHOW', notificationSecret) === 1);
  check('assignment retained as inactive history', detail.assignments.length === 0 && await db.orderAssignment.count({ where: { orderId: order.id, state: 'UNASSIGNED', unassignedAt: { not: null } } }) === 1);
  for (const action of ['no-show', 'start', 'cancel', 'approve', 'complete']) await expect('POST', path(order.id, action), a.token, ['no-show', 'cancel'].includes(action) ? reason : undefined, 409, `NO_SHOW cannot transition via ${action}`);
  for (const status of ['PENDING_APPROVAL', 'IN_PROGRESS', 'COMPLETED', 'REJECTED', 'CANCELLED', 'EXPIRED']) {
    const terminal = await make({ status });
    await expect('POST', path(terminal.order.id), staff, reason, 409, `${status} cannot become no-show`);
  }
  for (const itemStatus of ['IN_PROGRESS', 'COMPLETED', 'NOT_PERFORMED']) {
    const changed = await make({ itemStatus });
    const error = await expect('POST', path(changed.order.id), staff, reason, 409, 'no-show cannot overwrite existing item progress');
    check('progressed-item conflict is explicit', error.code === 'ORDER_SERVICES_ALREADY_PROGRESSED');
  }
  const competing = await make();
  const starts = await Promise.all([call('POST', path(competing.order.id), staff, reason), call('POST', path(competing.order.id, 'start'), staff)]);
  check('start/no-show race has one winner', starts.map((r) => r.status).sort().join(',') === '200,409');
  const after = await db.order.findUniqueOrThrow({ where: { id: competing.order.id }, include: { items: true } });
  check('no-show never overwrites started visit', after.status === 'NO_SHOW' ? after.items.every((item) => item.status === 'NOT_PERFORMED') : after.status === 'IN_PROGRESS' && after.items.every((item) => item.status === 'PENDING'));
  const broken = await make();
  const failing = new OrdersService(db, null, new AuditService(db), { enqueue: async () => { throw new Error('isolated outbox failure'); } }, null);
  let rejected = false;
  try { await failing.noShow(a.id, broken.order.id, reason, { actorId: owner.id, scope: 'FACILITY' }); } catch { rejected = true; }
  const rollback = await db.order.findUniqueOrThrow({ where: { id: broken.order.id }, include: { items: true, assignments: true } });
  check('outbox failure rolls all no-show effects back', rejected && rollback.status === 'CONFIRMED' && rollback.assignmentStatus === 'ASSIGNED' && rollback.items.every((item) => item.status === 'PENDING' && item.notPerformedReason === null) && rollback.assignments.every((assignment) => assignment.state === 'ACTIVE') && await db.orderStatusHistory.count({ where: { orderId: rollback.id } }) === 0 && await db.orderItemStatusHistory.count({ where: { orderItem: { orderId: rollback.id } } }) === 0 && await db.auditLog.count({ where: { entityId: rollback.id } }) === 0 && await db.notificationOutbox.count({ where: { entityId: rollback.id } }) === 0);
}
