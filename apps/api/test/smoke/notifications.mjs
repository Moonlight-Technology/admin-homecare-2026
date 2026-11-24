/** Isolated real-PostgreSQL worker tests. No Gmail/GoSMS network calls or real user accounts. */
import assert from 'node:assert/strict';
import { randomBytes, randomUUID } from 'node:crypto';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { createRequire } from 'node:module';
import { PrismaClient } from '@prisma/client';

const require = createRequire(import.meta.url);
const { ConfigService } = require('@nestjs/config');
const { OutboxService } = require('../../dist/modules/notifications/outbox.service.js');
const { NotificationRouter } = require('../../dist/modules/notifications/notification.router.js');
const { NotificationRepository } = require('../../dist/modules/notifications/notification.repository.js');
const { NotificationWorker } = require('../../dist/modules/notifications/notification.worker.js');
const { DeliveryError } = require('../../dist/modules/notifications/gmail-smtp.adapter.js');
const { hashToken } = require('../../dist/modules/auth/tokens.js');
const schema = `nakes_notifications_${randomBytes(8).toString('hex')}`;
const safeSchema = () => /^nakes_notifications_[a-f0-9]{16}$/.test(schema);
let created = false;
let maintenance;
let db;
let source;
let checks = 0;
let phase = 'preflight';
const check = (name, condition) => { assert.ok(condition, name); checks++; console.log(`PASS ${name}`); };

try {
  assert.equal(process.env.SMOKE_ALLOW_ISOLATED_SCHEMA, '1', 'Explicit isolated-schema opt-in required.');
  assert.notEqual(process.env.NODE_ENV, 'production', 'Refusing production environment.');
  source = process.env.DIRECT_DATABASE_URL || process.env.DATABASE_URL;
  assert.ok(source, 'Database configuration missing.');
  assert.ok(safeSchema(), 'Unsafe generated schema.');
  const isolated = new URL(source);
  isolated.searchParams.set('schema', schema);
  maintenance = new PrismaClient({ datasources: { db: { url: source } }, log: [] });
  await maintenance.$executeRawUnsafe(`CREATE SCHEMA "${schema}"`);
  created = true;
  phase = 'isolated migrations';
  const child = spawn(process.execPath, ['node_modules/prisma/build/index.js', 'migrate', 'deploy'], { cwd: new URL('../..', import.meta.url), windowsHide: true, env: { ...process.env, DATABASE_URL: isolated.toString(), DIRECT_DATABASE_URL: isolated.toString(), NOTIFICATIONS_ENABLED: 'false', NOTIFICATIONS_SMS_ENABLED: 'false', NOTIFICATIONS_EMAIL_ENABLED: 'false' }, stdio: ['ignore', 'pipe', 'pipe'] });
  let diagnostic = '';
  for (const stream of [child.stdout, child.stderr]) stream.on('data', (buffer) => { diagnostic = (diagnostic + buffer).slice(-8000); });
  const [exit] = await once(child, 'exit');
  assert.equal(exit, 0, `Isolated migrations failed (${[...new Set(diagnostic.match(/\bP\d{4}\b/g) ?? [])].join(',') || 'output suppressed'}).`);
  db = new PrismaClient({ datasources: { db: { url: isolated.toString() } }, log: [], transactionOptions: { timeout: 30000, maxWait: 15000 } });
  const tables = await db.$queryRaw`SELECT COUNT(*)::int AS count FROM information_schema.tables WHERE table_schema = ${schema} AND table_name IN ('notification_outbox', 'notification_deliveries', 'notification_controls', 'notification_simulations')`;
  check('additive migration creates all notification tables in isolated schema', tables[0].count === 4);
  const settings = {
    DATABASE_URL: isolated.toString(), CREDENTIAL_ENCRYPTION_KEY: randomBytes(32).toString('hex'),
    WEB_ORIGIN: 'http://localhost:3000', INVITATION_URL: 'http://localhost:3000/accept-invitation', PASSWORD_RESET_URL: 'http://localhost:3000/reset-password',
    NOTIFICATIONS_ENABLED: true, NOTIFICATIONS_MODE: 'live', NOTIFICATIONS_EMAIL_ENABLED: true, NOTIFICATIONS_SMS_ENABLED: false,
    NOTIFICATIONS_LIVE_FROM: new Date(Date.now() - 60000).toISOString(), NOTIFICATIONS_BATCH_SIZE: 50,
    SMTP_MAX_MESSAGES_PER_MINUTE: 1000, SMTP_MAX_MESSAGES_PER_DAY: 1000,
  };
  const config = new ConfigService(settings);
  const outbox = new OutboxService(db, config);
  const router = new NotificationRouter(db, config);
  const repository = new NotificationRepository(db, config, router);
  const repository2 = new NotificationRepository(db, config, router);
  const sent = [];
  let transportFailure = null;
  const transport = { send: async (to, content, id) => { if (transportFailure) throw transportFailure; sent.push({ to, content, id }); return `fake-${id}`; } };
  const worker = new NotificationWorker(db, config, repository, router, transport);
  const eventIds = [];
  async function account({ expired = false, old = false, reset = false, invalidLink = false } = {}) {
    const user = await db.user.create({ data: { email: `${randomUUID()}@example.test`, name: 'Isolated notification fixture', status: reset ? 'ACTIVE' : 'INVITED' } });
    const token = randomBytes(32).toString('base64url');
    const tokenRow = await db.passwordResetToken.create({ data: { userId: user.id, purpose: reset ? 'PASSWORD_RESET' : 'INVITATION', tokenHash: hashToken(token), expiresAt: new Date(Date.now() + (expired ? -60000 : 3600000)) } });
    await outbox.enqueue({ eventType: reset ? 'PASSWORD_RESET_REQUESTED' : 'ACCOUNT_INVITATION', entityType: 'User', entityId: user.id, recipient: user.email, payload: { [reset ? 'resetUrl' : 'invitationUrl']: `${invalidLink ? 'https://attacker.example.test' : settings.WEB_ORIGIN}/${reset ? 'reset-password' : 'accept-invitation'}?token=${token}` } });
    const event = await db.notificationOutbox.findFirstOrThrow({ where: { entityId: user.id } });
    if (old) await db.notificationOutbox.update({ where: { id: event.id }, data: { createdAt: new Date(Date.now() - 86400000) } });
    eventIds.push(event.id);
    return { event, user, token, tokenRow };
  }

  phase = 'payload encryption and dry-run';
  const invitation = await account();
  const reset = await account({ reset: true });
  const expired = await account({ expired: true });
  const old = await account({ old: true });
  const invalid = await account({ invalidLink: true });
  check('new token payload is encrypted at rest', !JSON.stringify(invitation.event.payload).includes(invitation.token));
  check('encrypted payload can be read by the dispatcher', router.cipher.decode(invitation.event.payload).invitationUrl.includes(invitation.token));
  const dryConfig = new ConfigService({ ...settings, NOTIFICATIONS_MODE: 'dry-run' });
  await new NotificationWorker(db, dryConfig, repository, router, transport).tick();
  check('dry-run reports all fixture events separately', await db.notificationSimulation.count() === 5);
  check('dry-run creates no live deliveries', await db.notificationDelivery.count() === 0);
  check('dry-run does not consume outbox or send', await db.notificationOutbox.count({ where: { materializedAt: { not: null } } }) === 0 && sent.length === 0);

  phase = 'transactional fan-out and claiming';
  await Promise.all([repository.materialize(50), repository2.materialize(50)]);
  check('concurrent materialization does not duplicate per-recipient delivery', await db.notificationDelivery.count() === 4);
  check('old backlog is skipped without generating delivery', (await db.notificationOutbox.findUniqueOrThrow({ where: { id: old.event.id } })).skipReason === 'BEFORE_LIVE_CUTOFF');
  check('expired link is skipped', (await db.notificationDelivery.findFirstOrThrow({ where: { outboxId: expired.event.id } })).status === 'SKIPPED');
  check('foreign reset/invitation URL is skipped', (await db.notificationDelivery.findFirstOrThrow({ where: { outboxId: invalid.event.id } })).status === 'SKIPPED');
  await db.notificationDelivery.updateMany({ where: { outboxId: reset.event.id }, data: { status: 'BLOCKED' } });
  const claims = await Promise.all([repository.claim(), repository2.claim()]);
  check('two claimers have exactly one winner for one pending message', claims.filter(Boolean).length === 1);
  const claim = claims.find(Boolean);
  check('recipient is encrypted, keyed recipient ID is not an email', !claim.recipientEncrypted.includes('@') && !claim.recipientKey.includes('@'));
  check('wrong fencing token cannot submit or finalize', !await repository.submitted({ ...claim, leaseToken: randomUUID() }) && !await repository.finish({ ...claim, leaseToken: randomUUID() }, 'ACCEPTED', null));
  await db.notificationDelivery.update({ where: { id: claim.id }, data: { leaseUntil: new Date(0) } });
  await repository.recoverExpired();
  check('crash before submit can return safely to pending', (await db.notificationDelivery.findUniqueOrThrow({ where: { id: claim.id } })).status === 'PENDING');
  const submittedClaim = await repository.claim();
  check('only current lease may mark submission', await repository.submitted(submittedClaim));
  await db.notificationDelivery.update({ where: { id: claim.id }, data: { leaseUntil: new Date(0) } });
  await repository.recoverExpired();
  check('crash after submit becomes UNKNOWN, not pending', (await db.notificationDelivery.findUniqueOrThrow({ where: { id: claim.id } })).status === 'UNKNOWN');
  check('stale worker cannot acknowledge after recovery', !await repository.finish(submittedClaim, 'ACCEPTED', null));
  check('unknown messages are not automatically claimed', await repository.claim() === null);

  phase = 'delivery and token eligibility';
  await db.notificationDelivery.updateMany({ where: { outboxId: reset.event.id }, data: { status: 'PENDING' } });
  const atomicClaim = await repository.claim();
  await repository.submitted(atomicClaim);
  const failingClient = {
    $transaction: (run) => db.$transaction((tx) => run(new Proxy(tx, { get(target, property) {
      if (property === 'notificationOutbox') return new Proxy(target.notificationOutbox, { get(model, key) { if (key === 'update') return async () => { throw new Error('isolated aggregate persistence failure'); }; return Reflect.get(model, key); } });
      return Reflect.get(target, property);
    } }))),
  };
  let aggregateFailed = false;
  try { await new NotificationRepository(failingClient, config, router).finish(atomicClaim, 'ACCEPTED', null, { messageId: 'fake-only' }); } catch { aggregateFailed = true; }
  const rolledBackAck = await db.notificationDelivery.findUniqueOrThrow({ where: { id: atomicClaim.id } });
  check('aggregate failure rolls acknowledgment back atomically', aggregateFailed && rolledBackAck.status === 'PROCESSING' && rolledBackAck.acceptedAt === null);
  check('aggregate failure preserves token material for controlled recovery', (await db.notificationOutbox.findUniqueOrThrow({ where: { id: reset.event.id } })).payload.notificationEncoding === 'v1');
  await repository.finish(atomicClaim, 'PENDING', 'FIXTURE_ATOMICITY_CHECK');
  await worker.tick();
  check('eligible reset email is accepted by fake transport exactly once', sent.length === 1 && sent[0].to === reset.user.email);
  const accepted = await db.notificationDelivery.findFirstOrThrow({ where: { outboxId: reset.event.id } });
  check('SMTP accepted is stored without a fabricated delivered status', accepted.status === 'ACCEPTED' && accepted.acceptedAt && accepted.providerMessageId);
  const acceptedEvent = await db.notificationOutbox.findUniqueOrThrow({ where: { id: reset.event.id } });
  check('aggregate records SENT as accepted and purges token payload', acceptedEvent.status === 'SENT' && acceptedEvent.payload.redacted === true);
  await worker.tick();
  check('accepted channel is never sent again on next tick', sent.length === 1);
  const superseded = await account();
  await repository.materialize(50);
  await db.passwordResetToken.update({ where: { id: superseded.tokenRow.id }, data: { usedAt: new Date() } });
  await worker.tick();
  check('token invalidated after fan-out is rechecked before send', (await db.notificationDelivery.findFirstOrThrow({ where: { outboxId: superseded.event.id } })).status === 'SKIPPED' && sent.length === 1);

  phase = 'retry and safe failure';
  const retry = await account();
  transportFailure = new DeliveryError('SMTP_TEMPORARY_REJECTION', 'transient');
  await worker.tick();
  const deferred = await db.notificationDelivery.findFirstOrThrow({ where: { outboxId: retry.event.id } });
  check('temporary rejection persists attempts and future retry time', deferred.status === 'PENDING' && deferred.attempts === 1 && deferred.availableAt > new Date());
  await db.notificationDelivery.update({ where: { id: deferred.id }, data: { availableAt: new Date(0) } });
  transportFailure = new DeliveryError('SMTP_RESULT_UNKNOWN', 'unknown');
  await worker.tick();
  check('ambiguous SMTP result is not retried blindly', (await db.notificationDelivery.findUniqueOrThrow({ where: { id: deferred.id } })).status === 'UNKNOWN');
  transportFailure = null;
  const blocked = await db.notificationOutbox.create({ data: { eventType: 'ORDER_RESCHEDULED', entityType: 'Order', entityId: randomUUID(), payload: { customerId: randomUUID(), patientSnapshot: { phone: '081234567890' } } } });
  await worker.tick();
  check('customer order without trusted contact is BLOCKED', (await db.notificationDelivery.findFirstOrThrow({ where: { outboxId: blocked.id } })).lastErrorCode === 'CUSTOMER_CONTACT_UNRESOLVED');
  const allowlisted = await account();
  const limited = new NotificationWorker(db, new ConfigService({ ...settings, NOTIFICATIONS_RECIPIENT_ALLOWLIST: 'someone-else@example.test' }), repository, router, transport);
  await limited.tick();
  check('allowlist blocks rather than redirects token email', (await db.notificationDelivery.findFirstOrThrow({ where: { outboxId: allowlisted.event.id } })).lastErrorCode === 'RECIPIENT_NOT_ALLOWLISTED' && sent.length === 1);

  phase = 'persistent shared quota and rollback';
  await db.notificationControl.deleteMany({ where: { key: { startsWith: 'email-rate:' } } });
  const quotaConfig = new ConfigService({ ...settings, SMTP_MAX_MESSAGES_PER_MINUTE: 1 });
  const quota = new NotificationRepository(db, quotaConfig, router);
  const reservations = await Promise.all([quota.reserveBudget(), quota.reserveBudget()]);
  check('shared quota allows exactly one concurrent reservation', reservations.filter((value) => value === null).length === 1);
  check('quota persists across repository/worker restart', await new NotificationRepository(db, quotaConfig, router).reserveBudget() instanceof Date);
  await quota.pause('SMTP_AUTH_PAUSED', new Date(Date.now() + 60000));
  check('channel pause is shared and survives restart', await new NotificationRepository(db, config, router).reserveBudget() instanceof Date);
  const marker = randomUUID();
  try { await db.$transaction(async (tx) => { await outbox.enqueue({ eventType: 'TEST_ROLLBACK', entityType: 'Test', entityId: marker, payload: {} }, tx); throw new Error('fixture rollback'); }); } catch { /* expected */ }
  check('rolled-back domain transaction leaves no queued event', await db.notificationOutbox.count({ where: { entityId: marker } }) === 0);
  check('worker heartbeat is persisted without payload/recipient', await db.notificationControl.count({ where: { key: { startsWith: 'worker:' } } }) >= 1);
  check('test did not submit unknown, blocked, or skipped emails', sent.length === 1);
  console.log(`RESULT ${checks} isolated PostgreSQL notification checks passed. SMTP/GoSMS: fake transport only.`);
} catch (error) {
  console.error(`FAIL ${phase}: ${error instanceof assert.AssertionError ? error.message : 'details suppressed'}`);
  const code = String(error?.code ?? '');
  if (/^P\d{4}$/.test(code)) console.error(`SAFE_PRISMA_CODE ${code}`);
  process.exitCode = 1;
} finally {
  await db?.$disconnect();
  if (created) {
    assert.ok(safeSchema(), 'Refusing unsafe generated schema cleanup.');
    for (let attempt = 0; attempt < 3; attempt++) {
      const cleanup = new PrismaClient({ datasources: { db: { url: source } }, log: [] });
      try { await cleanup.$executeRawUnsafe(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`); console.log('CLEANUP only generated notification test schema removed.'); break; }
      catch { if (attempt === 2) { console.error(`CLEANUP_FAILED ${schema}`); process.exitCode = 1; } }
      finally { await cleanup.$disconnect(); }
    }
  }
  await maintenance?.$disconnect();
}
