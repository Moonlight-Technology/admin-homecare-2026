import { randomUUID } from 'node:crypto';
import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Prisma, type NotificationDelivery, type NotificationDeliveryStatus, type NotificationOutbox } from '@prisma/client';
import { PrismaService, type Db } from '../../prisma/prisma.service';
import { accountEvent, NotificationRouter } from './notification.router';

@Injectable()
export class NotificationRepository {
  constructor(private readonly prisma: PrismaService, private readonly config: ConfigService, private readonly router: NotificationRouter) {}

  private table(name: 'notification_outbox' | 'notification_deliveries' | 'notification_simulations') {
    const schema = new URL(this.config.getOrThrow<string>('DATABASE_URL')).searchParams.get('schema') || 'public';
    if (!/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(schema)) throw new Error('UNSUPPORTED_NOTIFICATION_SCHEMA');
    // Raw Prisma queries do not always inherit a transaction-pooler's schema search_path.
    return Prisma.raw(`"${schema}"."${name}"`);
  }

  async simulate(limit: number) {
    const events = await this.prisma.$queryRaw<NotificationOutbox[]>`SELECT o.* FROM ${this.table('notification_outbox')} o LEFT JOIN ${this.table('notification_simulations')} s ON s."outboxId" = o.id WHERE s."outboxId" IS NULL AND o.status = 'PENDING' ORDER BY o."createdAt" LIMIT ${limit}`;
    for (const event of events) {
      const route = await this.router.resolve(event);
      await this.prisma.notificationSimulation.upsert({ where: { outboxId: event.id }, create: { outboxId: event.id, outcome: route.code, recipientCount: route.recipients.length }, update: { outcome: route.code, recipientCount: route.recipients.length } });
    }
    return events.length;
  }

  async materialize(limit: number) {
    for (let index = 0; index < limit; index++) {
      const found = await this.prisma.$transaction(async (tx) => {
        const [event] = await tx.$queryRaw<NotificationOutbox[]>`SELECT * FROM ${this.table('notification_outbox')} WHERE "materializedAt" IS NULL AND status = 'PENDING' AND "availableAt" <= NOW() ORDER BY "createdAt" LIMIT 1 FOR UPDATE SKIP LOCKED`;
        if (!event) return false;
        const cutoff = new Date(this.config.getOrThrow<string>('NOTIFICATIONS_LIVE_FROM'));
        if (event.createdAt < cutoff) {
          await tx.notificationOutbox.update({ where: { id: event.id }, data: { materializedAt: new Date(), skipReason: 'BEFORE_LIVE_CUTOFF', ...(accountEvent(event.eventType) ? { payload: { redacted: true } } : {}) } });
          return true;
        }
        const route = await this.router.resolve(event, tx);
        const recipients = route.recipients.length ? route.recipients : [null];
        for (const recipient of recipients) {
          const recipientKey = recipient ? this.router.cipher.recipientKey(recipient) : 'unresolved';
          await tx.notificationDelivery.createMany({ data: [{ outboxId: event.id, recipientKey, recipientEncrypted: recipient ? this.router.cipher.encrypt(recipient) : null, status: route.outcome === 'READY' ? 'PENDING' : route.outcome, lastErrorCode: route.outcome === 'READY' ? null : route.code }], skipDuplicates: true });
        }
        await tx.notificationOutbox.update({ where: { id: event.id }, data: { materializedAt: new Date(), ...(route.outcome === 'SKIPPED' ? { skipReason: route.code, ...(accountEvent(event.eventType) ? { payload: { redacted: true } } : {}) } : {}) } });
        return true;
      });
      if (!found) break;
    }
  }

  async recoverExpired() {
    // A reservation abandoned before submission is safe; one that may have reached the provider is not.
    await this.prisma.notificationDelivery.updateMany({ where: { status: 'PROCESSING', leaseUntil: { lt: new Date() }, submittedAt: null }, data: { status: 'PENDING', leaseToken: null, leaseUntil: null, lastErrorCode: 'LEASE_EXPIRED_BEFORE_SUBMIT' } });
    await this.prisma.notificationDelivery.updateMany({ where: { status: 'PROCESSING', leaseUntil: { lt: new Date() }, submittedAt: { not: null } }, data: { status: 'UNKNOWN', leaseToken: null, leaseUntil: null, lastErrorCode: 'LEASE_EXPIRED_AFTER_SUBMIT' } });
  }

  async claim(): Promise<NotificationDelivery | null> {
    const token = randomUUID();
    const [delivery] = await this.prisma.$queryRaw<NotificationDelivery[]>`
      UPDATE ${this.table('notification_deliveries')} SET status = 'PROCESSING', "leaseToken" = ${token}::uuid,
      "leaseUntil" = NOW() + INTERVAL '5 minutes', "submittedAt" = NULL, "updatedAt" = NOW()
      WHERE id = (SELECT id FROM ${this.table('notification_deliveries')} WHERE status = 'PENDING' AND channel = 'EMAIL'
        AND "availableAt" <= NOW() ORDER BY "availableAt", "createdAt" LIMIT 1 FOR UPDATE SKIP LOCKED) RETURNING *`;
    return delivery ?? null;
  }

  /** Serialize quota reservations across replicas, with durable UTC minute/day buckets and circuit breaker. */
  async reserveBudget() {
    return this.prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(73738219)`;
      const pause = await tx.notificationControl.findUnique({ where: { key: 'channel:EMAIL' } });
      const now = new Date();
      if (pause?.pausedUntil && pause.pausedUntil > now) return pause.pausedUntil;
      const iso = now.toISOString();
      const limits = [
        { key: `email-rate:minute:${iso.slice(0, 16)}`, max: this.config.get<number>('SMTP_MAX_MESSAGES_PER_MINUTE', 5), next: new Date(Math.floor(now.getTime() / 60000) * 60000 + 60000) },
        { key: `email-rate:day:${iso.slice(0, 10)}`, max: this.config.get<number>('SMTP_MAX_MESSAGES_PER_DAY', 100), next: new Date(`${iso.slice(0, 10)}T00:00:00Z`) },
      ];
      limits[1]!.next = new Date(limits[1]!.next.getTime() + 86400000);
      for (const bucket of limits) {
        const count = await tx.notificationControl.findUnique({ where: { key: bucket.key } });
        if ((count?.count ?? 0) >= bucket.max) return bucket.next;
      }
      for (const bucket of limits) await tx.notificationControl.upsert({ where: { key: bucket.key }, create: { key: bucket.key, count: 1 }, update: { count: { increment: 1 } } });
      return null;
    });
  }

  async pause(code: string, until: Date) {
    await this.prisma.notificationControl.upsert({ where: { key: 'channel:EMAIL' }, create: { key: 'channel:EMAIL', pausedUntil: until, reason: code }, update: { pausedUntil: until, reason: code } });
  }

  async submitted(delivery: NotificationDelivery) {
    const changed = await this.prisma.notificationDelivery.updateMany({ where: { id: delivery.id, status: 'PROCESSING', leaseToken: delivery.leaseToken, leaseUntil: { gt: new Date() } }, data: { submittedAt: new Date(), attempts: { increment: 1 } } });
    return changed.count === 1;
  }

  async finish(delivery: NotificationDelivery, status: NotificationDeliveryStatus, code: string | null, options: { availableAt?: Date; messageId?: string } = {}) {
    // Persist acknowledgment, aggregate state and token redaction together. A DB outage cannot leave
    // ACCEPTED delivery with an unacknowledged outbox and a forgotten plaintext delivery token.
    return this.prisma.$transaction(async (tx) => {
      const updated = await tx.notificationDelivery.updateMany({ where: { id: delivery.id, status: 'PROCESSING', leaseToken: delivery.leaseToken }, data: { status, lastErrorCode: code, leaseToken: null, leaseUntil: null, ...(options.availableAt ? { availableAt: options.availableAt } : {}), ...(status === 'ACCEPTED' ? { acceptedAt: new Date(), providerMessageId: options.messageId } : {}) } });
      if (updated.count) await this.aggregate(delivery.outboxId, tx);
      return updated.count === 1;
    });
  }

  async aggregate(outboxId: string, db?: Db) {
    const summarize = async (tx: Db) => {
      const [outbox] = await tx.$queryRaw<NotificationOutbox[]>`SELECT * FROM ${this.table('notification_outbox')} WHERE id = ${outboxId}::uuid FOR UPDATE`;
      if (!outbox) return;
      const deliveries = await tx.notificationDelivery.findMany({ where: { outboxId } });
      const unresolved = deliveries.some((d) => ['PENDING', 'PROCESSING', 'BLOCKED', 'UNKNOWN'].includes(d.status));
      const accepted = deliveries.some((d) => d.status === 'ACCEPTED');
      const failed = deliveries.some((d) => d.status === 'FAILED');
      const allSkipped = deliveries.length > 0 && deliveries.every((d) => d.status === 'SKIPPED');
      const status = unresolved ? 'PENDING' : failed ? 'FAILED' : accepted ? 'SENT' : 'PENDING';
      await tx.notificationOutbox.update({ where: { id: outboxId }, data: { status, attempts: deliveries.reduce((n, d) => n + d.attempts, 0), sentAt: status === 'SENT' ? new Date() : null, lastError: deliveries.find((d) => ['FAILED', 'BLOCKED', 'UNKNOWN'].includes(d.status))?.lastErrorCode ?? null, ...(allSkipped ? { skipReason: 'ALL_DELIVERIES_SKIPPED' } : {}), ...(!unresolved && accountEvent(outbox.eventType) ? { payload: { redacted: true } } : {}) } });
    };
    if (db) await summarize(db);
    else await this.prisma.$transaction(summarize);
  }

  async heartbeat(workerId: string) {
    await this.prisma.notificationControl.upsert({ where: { key: `worker:${workerId}` }, create: { key: `worker:${workerId}` }, update: { count: { increment: 1 } } });
  }

  async maintenance() {
    const retention = new Date(Date.now() - 30 * 86400000);
    // No useful account token lasts 30 days. Purge material even for ambiguous/manual-review records.
    await this.prisma.notificationOutbox.updateMany({ where: { eventType: { in: ['ACCOUNT_INVITATION', 'PASSWORD_RESET_REQUESTED'] }, createdAt: { lt: retention }, deliveries: { none: { status: 'PROCESSING' } } }, data: { payload: { redacted: true } } });
    await this.prisma.notificationControl.deleteMany({ where: { key: { startsWith: 'email-rate:' }, updatedAt: { lt: new Date(Date.now() - 2 * 86400000) } } });
    await this.prisma.notificationControl.deleteMany({ where: { key: { startsWith: 'worker:' }, updatedAt: { lt: retention } } });
  }
}
