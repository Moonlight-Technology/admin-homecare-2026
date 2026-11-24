/** Additional real HTTP/PostgreSQL scenario. Called ONLY by the isolated-schema runner, never standalone. */
import { randomUUID } from 'node:crypto';
import { countOutboxStatus } from './notification-test-utils.mjs';

export async function orderCancellation({ database: db, a, b, practitionerId, password, expect, call, check, setupOnly = false, notificationSecret }) {
  const provider = await db.provider.findFirstOrThrow({ where: { facilityId: a.id } });
  const owner = await db.user.findUniqueOrThrow({ where: { email: 'owner-a@isolated.test' } });
  const role = await db.role.findUniqueOrThrow({ where: { code: 'CLINIC_STAFF' } });
  await db.user.create({ data: { email: 'order-staff@isolated.test', name: 'Order staff', passwordHash: owner.passwordHash, status: 'ACTIVE', memberships: { create: { scopeType: 'FACILITY', facilityId: a.id, roleId: role.id } } } });
  const staff = (await expect('POST', '/auth/login', null, { email: 'order-staff@isolated.test', password }, 200, 'order staff login')).accessToken;
  const category = await db.serviceCategory.create({ data: { slug: 'cancel-test', name: 'Cancellation test' } });
  const service = await db.masterService.create({ data: { categoryId: category.id, code: 'CANCEL_TEST', name: 'Cancellation test' } });
  const offering = await db.serviceOffering.create({ data: { providerId: provider.id, masterServiceId: service.id, name: 'Test visit', basePrice: '50000', durationMinutes: 30, status: 'PUBLISHED', modes: { create: { mode: 'ON_SITE', enabled: true } } } });
  const day = new Date(Date.now() + 3 * 86400000).toISOString().slice(0, 10);
  const startsAt = new Date(`${day}T01:00:00Z`);
  await db.facilitySchedule.create({ data: { facilityId: a.id, mode: 'ON_SITE', dayOfWeek: startsAt.getUTCDay(), startTime: '08:00', endTime: '12:00', slotMinutes: 60, capacityPerSlot: 1 } });
  await db.practitioner.update({ where: { id: practitionerId }, data: { verificationStatus: 'VERIFIED', operatingStatus: 'ACTIVE' } });
  await db.practitionerAffiliation.updateMany({ where: { facilityId: a.id, practitionerId }, data: { status: 'ACTIVE' } });
  const make = (status = 'PENDING_APPROVAL', extra = {}) => db.order.create({ data: {
    code: `TEST-${randomUUID()}`, customerId: randomUUID(), patientId: randomUUID(), providerId: provider.id,
    facilityId: a.id, mode: 'ON_SITE', scheduledAt: startsAt, patientSnapshot: { name: 'Test Patient' },
    itemSubtotal: '50000', grandTotal: '50000', status, ...extra,
    items: { create: { offeringId: offering.id, masterServiceId: service.id, nameSnapshot: 'Test visit', priceSnapshot: '50000', durationMinutes: 30, modeSnapshot: 'ON_SITE' } },
  } });
  if (setupOnly) return { owner, staff, provider, offering };
  const endpoint = (id, action = 'cancel') => `/clinic/orders/${id}/${action}`;
  const reason = { reason: 'Permintaan pembatalan pasien' };
  const pending = await make();
  await expect('POST', endpoint(pending.id), null, reason, 401, 'anonymous cannot cancel');
  await expect('POST', endpoint(pending.id), staff, reason, 403, 'read/assign/progress permission cannot cancel');
  await expect('POST', endpoint(pending.id), b.token, reason, 404, 'other clinic cannot cancel');
  for (const input of [{}, { reason: '    ' }, { reason: 'abc' }, { reason: 'x'.repeat(1001) }, { ...reason, facilityId: b.id }]) {
    await expect('POST', endpoint(pending.id), a.token, input, 422, 'cancellation DTO validation');
  }
  const cancelled = await expect('POST', endpoint(pending.id), a.token, reason, 200, 'pending order cancelled');
  check('pending cancellation keeps money/items and records actor/reason', cancelled.status === 'CANCELLED' && cancelled.grandTotal === '50000' && cancelled.paymentStatus === 'NOT_CONFIGURED' && cancelled.items[0].status === 'PENDING' && cancelled.history.some((h) => h.newStatus === 'CANCELLED' && h.reason === reason.reason && h.actor.id === owner.id));
  check('pending cancellation does not materialise capacity', await db.facilitySlot.count({ where: { facilityId: a.id } }) === 0);
  await expect('POST', endpoint(pending.id), a.token, reason, 409, 'repeated cancel rejected');
  await expect('POST', endpoint(pending.id, 'approve'), a.token, undefined, 409, 'cancelled order cannot be approved');
  for (const status of ['IN_PROGRESS', 'COMPLETED', 'REJECTED', 'EXPIRED', 'NO_SHOW']) {
    const order = await make(status);
    await expect('POST', endpoint(order.id), a.token, reason, 409, `${status} cannot be cancelled`);
    check(`${status} has no cancellation history`, await db.orderStatusHistory.count({ where: { orderId: order.id } }) === 0);
  }
  const confirmed = await make();
  const accepted = await expect('POST', endpoint(confirmed.id, 'approve'), a.token, undefined, 200, 'reserve capacity by real approval');
  await expect('POST', endpoint(confirmed.id, 'assignments'), a.token, { practitionerId }, 201, 'assign verified practitioner before cancellation');
  const race = await Promise.all([0, 1].map(() => call('POST', endpoint(confirmed.id), a.token, reason)));
  check('concurrent cancellation commits exactly once', race.map((r) => r.status).sort().join(',') === '200,409');
  const slot = await db.facilitySlot.findUniqueOrThrow({ where: { id: accepted.slotId } });
  check('confirmed capacity released exactly once', slot.reserved === 0);
  const after = await db.order.findUniqueOrThrow({ where: { id: confirmed.id } });
  check('cancelled order retains historical slot and clears assignment status', after.status === 'CANCELLED' && after.slotId === slot.id && after.assignmentStatus === 'UNASSIGNED');
  check('assignment history retained and inactive', await db.orderAssignment.count({ where: { orderId: confirmed.id, state: 'UNASSIGNED', unassignedAt: { not: null } } }) === 1 && await db.orderAssignment.count({ where: { orderId: confirmed.id, state: 'ACTIVE' } }) === 0);
  check('one cancellation history/audit/outbox event', await db.orderStatusHistory.count({ where: { orderId: confirmed.id, newStatus: 'CANCELLED' } }) === 1 && await db.auditLog.count({ where: { entityId: confirmed.id, event: 'ORDER_CANCELLED', facilityId: a.id } }) === 1 && await countOutboxStatus(db, confirmed.id, 'CANCELLED', notificationSecret) === 1);
  const replacement = await make();
  await expect('POST', endpoint(replacement.id, 'approve'), a.token, undefined, 200, 'released capacity can be approved again');
  await expect('POST', endpoint(replacement.id, 'assignments'), a.token, { practitionerId }, 201, 'cancelled assignment no longer conflicts');
  await expect('POST', endpoint(confirmed.id, 'assignments'), a.token, { practitionerId }, 409, 'cannot assign a cancelled order');

  // Inconsistent reservation is an explicit conflict and rolls status/history/audit/outbox back together.
  const broken = await make('CONFIRMED', { slotId: slot.id });
  await db.facilitySlot.update({ where: { id: slot.id }, data: { reserved: 0 } });
  await expect('POST', endpoint(broken.id), a.token, reason, 409, 'missing reserved capacity rejects cancellation');
  check('failed capacity release rolls back order/history/events', (await db.order.findUniqueOrThrow({ where: { id: broken.id } })).status === 'CONFIRMED' && await db.orderStatusHistory.count({ where: { orderId: broken.id } }) === 0 && await db.auditLog.count({ where: { entityId: broken.id } }) === 0 && await db.notificationOutbox.count({ where: { entityId: broken.id } }) === 0);
  // Restore the fixture count before testing approval/cancellation races on the full slot.
  await db.facilitySlot.update({ where: { id: slot.id }, data: { reserved: 1 } });
  const competing = await make();
  const contested = await Promise.all([
    call('POST', endpoint(competing.id, 'approve'), a.token),
    call('POST', endpoint(competing.id), a.token, reason),
  ]);
  check('approval/cancel race has no server error', contested.every((r) => [200, 409].includes(r.status)));
  const final = await db.order.findUniqueOrThrow({ where: { id: competing.id } });
  check('approval/cancel race preserves existing capacity', final.status === 'CANCELLED' && (await db.facilitySlot.findUniqueOrThrow({ where: { id: slot.id } })).reserved === 1);

  const later = new Date(startsAt.getTime() + 3600000);
  const laterSlot = await db.facilitySlot.create({ data: { facilityId: a.id, mode: 'ON_SITE', startsAt: later, endsAt: new Date(later.getTime() + 3600000), capacity: 1, reserved: 1 } });
  const assigning = await make('CONFIRMED', { slotId: laterSlot.id, scheduledAt: later });
  const assignRace = await Promise.all([
    call('POST', endpoint(assigning.id, 'assignments'), a.token, { practitionerId }),
    call('POST', endpoint(assigning.id), a.token, reason),
  ]);
  check('assignment/cancel race has only success or conflict', [201, 409].includes(assignRace[0].status) && [200, 409].includes(assignRace[1].status));
  const raceOrder = await db.order.findUniqueOrThrow({ where: { id: assigning.id } });
  const activeAssignments = await db.orderAssignment.count({ where: { orderId: assigning.id, state: 'ACTIVE' } });
  const raceSlot = await db.facilitySlot.findUniqueOrThrow({ where: { id: laterSlot.id } });
  check('assignment/cancel race cannot leave active assignments on cancelled order', raceOrder.status === 'CANCELLED' ? activeAssignments === 0 && raceSlot.reserved === 0 : raceOrder.status === 'CONFIRMED' && activeAssignments === 1 && raceSlot.reserved === 1);
  if (raceOrder.status === 'CONFIRMED') await expect('POST', endpoint(assigning.id), a.token, reason, 200, 'fresh cancellation after assignment conflict');
}
