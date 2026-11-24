/** Real PostgreSQL/HTTP tests invoked only inside the isolated-schema runner. */
import { randomUUID } from 'node:crypto';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { OrdersService } = require('../../dist/modules/orders/orders.service.js');
const { AvailabilityService } = require('../../dist/modules/availability/availability.service.js');
const { AuditService } = require('../../dist/modules/audit/audit.service.js');

export async function orderReschedule({ database: db, a, b, practitionerId, expect, call, check, owner, staff, provider, offering }) {
  await db.facilitySchedule.updateMany({ where: { facilityId: a.id }, data: { active: false } });
  await db.facilitySchedule.createMany({ data: Array.from({ length: 7 }, (_, dayOfWeek) => ({ facilityId: a.id, mode: 'ON_SITE', dayOfWeek, startTime: '08:00', endTime: '18:00', slotMinutes: 60, capacityPerSlot: 1 })) });
  let sequence = 0;
  async function make({ status = 'CONFIRMED', assigned = false, start, itemStatus = 'PENDING' } = {}) {
    const day = new Date(Date.now() + (3 + sequence++) * 86400000).toISOString().slice(0, 10);
    const startsAt = start ?? new Date(`${day}T01:00:00Z`);
    const target = new Date(startsAt.getTime() + 3600000);
    const slot = await db.facilitySlot.create({ data: { facilityId: a.id, mode: 'ON_SITE', startsAt, endsAt: new Date(startsAt.getTime() + 3600000), capacity: 1, reserved: 1 } });
    const order = await db.order.create({ data: { code: `MOVE-${randomUUID()}`, customerId: randomUUID(), patientId: randomUUID(), providerId: provider.id, facilityId: a.id, mode: 'ON_SITE', scheduledAt: startsAt, slotId: slot.id, status, assignmentStatus: assigned ? 'ASSIGNED' : 'UNASSIGNED', patientSnapshot: { name: 'Reschedule Test' }, itemSubtotal: '100000', grandTotal: '100000', items: { create: [0, 1].map(() => ({ offeringId: offering.id, masterServiceId: offering.masterServiceId, nameSnapshot: 'Snapshot Service', priceSnapshot: '25000', durationMinutes: 15, quantity: 2, modeSnapshot: 'ON_SITE', status: itemStatus })) }, ...(assigned ? { assignments: { create: { practitionerId, assignedById: owner.id } } } : {}) } });
    return { order, slot, target };
  }
  const path = (id, action = 'reschedule') => `/clinic/orders/${id}/${action}`;
  const body = (fixture, extra = {}) => ({ scheduledAt: fixture.target.toISOString(), version: 0, reason: 'Pasien meminta pindah jadwal', ...extra });
  const unchanged = async (fixture) => {
    const current = await db.order.findUniqueOrThrow({ where: { id: fixture.order.id } });
    return current.version === 0 && current.slotId === fixture.slot.id && current.scheduledAt.getTime() === fixture.order.scheduledAt.getTime() && (await db.facilitySlot.findUniqueOrThrow({ where: { id: fixture.slot.id } })).reserved === 1;
  };
  const original = await make({ assigned: true });
  await expect('POST', path(original.order.id), null, body(original), 401, 'anonymous cannot reschedule');
  await expect('POST', path(original.order.id), staff, body(original), 403, 'progress/assignment permission cannot reschedule');
  await expect('POST', path(original.order.id), b.token, body(original), 404, 'other clinic cannot reschedule');
  const localDay = original.order.scheduledAt.toISOString().slice(0, 10);
  await expect('GET', path(original.order.id, `reschedule-slots?date=${localDay}`), staff, undefined, 403, 'staff cannot access replacement picker');
  const slots = await expect('GET', path(original.order.id, `reschedule-slots?date=${localDay}`), a.token, undefined, 200, 'snapshot-based replacement picker');
  check('picker sums quantities and excludes old slot', slots.durationMinutes === 60 && slots.slots.some((slot) => slot.startsAt === original.target.toISOString()) && !slots.slots.some((slot) => slot.startsAt === original.order.scheduledAt.toISOString()));
  await expect('GET', path(original.order.id, 'reschedule-slots?date=2026-02-31'), a.token, undefined, 422, 'invalid calendar date rejected');
  for (const input of [{ ...body(original), version: undefined }, body(original, { version: -1 }), body(original, { reason: '  ' }), body(original, { reason: 'x'.repeat(1001) }), body(original, { scheduledAt: 'invalid' }), { ...body(original), facilityId: b.id }]) await expect('POST', path(original.order.id), a.token, input, 422, 'reschedule DTO validation');
  await expect('POST', path(original.order.id), a.token, body(original, { scheduledAt: original.order.scheduledAt.toISOString() }), 409, 'unchanged schedule rejected');
  await expect('POST', path(original.order.id), a.token, body(original, { version: 100 }), 409, 'stale version rejected');
  const moved = await expect('POST', path(original.order.id), a.token, body(original), 200, 'assigned visit rescheduled');
  check('time/version change but status/money/items/assignment stay intact', moved.scheduledAt === original.target.toISOString() && moved.version === 1 && moved.status === 'CONFIRMED' && moved.grandTotal === '100000' && moved.paymentStatus === 'NOT_CONFIGURED' && moved.items.every((item) => item.quantity === 2 && item.priceSnapshot === '25000' && item.status === 'PENDING') && moved.assignments.length === 1);
  check('source released and new capacity reserved once', (await db.facilitySlot.findUniqueOrThrow({ where: { id: original.slot.id } })).reserved === 0 && (await db.facilitySlot.findUniqueOrThrow({ where: { id: moved.slotId } })).reserved === 1);
  check('reschedule history/audit/outbox recorded exactly once', moved.history.some((h) => h.previousStatus === 'CONFIRMED' && h.newStatus === 'CONFIRMED' && h.reason.includes('Jadwal diubah')) && await db.auditLog.count({ where: { entityId: original.order.id, event: 'ORDER_RESCHEDULED' } }) === 1 && await db.notificationOutbox.count({ where: { entityId: original.order.id, eventType: 'ORDER_RESCHEDULED' } }) === 1);
  await expect('POST', path(original.order.id), a.token, body(original), 409, 'old request cannot replay a completed move');

  const full = await make();
  await db.facilitySlot.create({ data: { facilityId: a.id, mode: 'ON_SITE', startsAt: full.target, endsAt: new Date(full.target.getTime() + 3600000), capacity: 1, reserved: 1 } });
  await expect('POST', path(full.order.id), a.token, body(full), 409, 'full destination rejected');
  check('full destination preserves original capacity and version', await unchanged(full));
  const blocked = await make();
  await db.scheduleBlock.create({ data: { facilityId: a.id, mode: 'ON_SITE', startsAt: blocked.target, endsAt: new Date(blocked.target.getTime() + 3600000), reason: 'Fixture closure' } });
  await expect('POST', path(blocked.order.id), a.token, body(blocked), 409, 'blocked destination rejected');
  check('block failure leaves original reservation untouched', await unchanged(blocked));
  const invalid = await make();
  for (const target of [new Date(Date.now() - 3600000), new Date(Date.now() + 80 * 86400000), new Date(invalid.target.getTime() + 15000), new Date(`${invalid.target.toISOString().slice(0, 10)}T10:30:00Z`)]) await expect('POST', path(invalid.order.id), a.token, body(invalid, { scheduledAt: target.toISOString() }), 409, 'past/out-of-horizon/off-grid/nonfitting target rejected');
  for (const status of ['PENDING_APPROVAL', 'IN_PROGRESS', 'COMPLETED', 'CANCELLED', 'REJECTED', 'EXPIRED', 'NO_SHOW']) {
    const terminal = await make({ status });
    await expect('POST', path(terminal.order.id), a.token, body(terminal), 409, `${status} cannot reschedule`);
  }
  const past = await make({ start: new Date(Date.now() - 7200000) });
  await expect('POST', path(past.order.id), a.token, body(past, { scheduledAt: new Date(Date.now() + 86400000).toISOString() }), 409, 'past original cannot evade no-show by rescheduling');

  const conflict = await make({ assigned: true });
  const otherProvider = await db.provider.findFirstOrThrow({ where: { facilityId: b.id } });
  const otherOffering = await db.serviceOffering.create({ data: { providerId: otherProvider.id, masterServiceId: offering.masterServiceId, name: 'Other clinic test', basePrice: '50000', durationMinutes: 60, status: 'PUBLISHED' } });
  await db.practitionerAffiliation.create({ data: { facilityId: b.id, practitionerId, status: 'ACTIVE' } });
  await db.order.create({ data: { code: `BUSY-${randomUUID()}`, customerId: randomUUID(), patientId: randomUUID(), providerId: otherProvider.id, facilityId: b.id, mode: 'ON_SITE', scheduledAt: conflict.target, status: 'CONFIRMED', assignmentStatus: 'ASSIGNED', patientSnapshot: { name: 'Other test' }, itemSubtotal: '50000', grandTotal: '50000', items: { create: { offeringId: otherOffering.id, masterServiceId: offering.masterServiceId, nameSnapshot: 'Other service', priceSnapshot: '50000', durationMinutes: 60, modeSnapshot: 'ON_SITE' } }, assignments: { create: { practitionerId, assignedById: owner.id } } } });
  const clash = await expect('POST', path(conflict.order.id), a.token, body(conflict), 409, 'cross-clinic practitioner conflict rejected');
  check('practitioner conflict leaves old reservation', clash.code === 'PRACTITIONER_SCHEDULE_CONFLICT' && await unchanged(conflict));
  const affiliation = await make({ assigned: true });
  await db.practitionerAffiliation.updateMany({ where: { facilityId: a.id, practitionerId }, data: { endDate: new Date('2020-01-01') } });
  await expect('POST', path(affiliation.order.id), a.token, body(affiliation), 409, 'expired affiliation cannot move with appointment');
  await db.practitionerAffiliation.updateMany({ where: { facilityId: a.id, practitionerId }, data: { endDate: null } });

  const competing = await make();
  const targets = [competing.target, new Date(competing.target.getTime() + 3600000)];
  const race = await Promise.all(targets.map((target) => call('POST', path(competing.order.id), a.token, body(competing, { scheduledAt: target.toISOString() }))));
  check('two moves of same version have one winner', race.map((r) => r.status).sort().join(',') === '200,409');
  check('concurrent moves reserve one new place only', (await db.order.findUniqueOrThrow({ where: { id: competing.order.id } })).version === 1 && (await db.facilitySlot.aggregate({ where: { facilityId: a.id, startsAt: { in: [competing.order.scheduledAt, ...targets] } }, _sum: { reserved: true } }))._sum.reserved === 1);

  const broken = await make();
  const audit = new AuditService(db);
  const failing = new OrdersService(db, new AvailabilityService(db, audit), audit, { enqueue: async () => { throw new Error('isolated outbox failure'); } }, null);
  let rejected = false;
  try { await failing.reschedule(a.id, broken.order.id, body(broken), { actorId: owner.id, scope: 'FACILITY' }); } catch { rejected = true; }
  check('outbox failure rolls entire move/history/audit/capacity back', rejected && await unchanged(broken) && await db.facilitySlot.count({ where: { facilityId: a.id, startsAt: broken.target } }) === 0 && await db.orderStatusHistory.count({ where: { orderId: broken.order.id } }) === 0 && await db.auditLog.count({ where: { entityId: broken.order.id } }) === 0);
}
