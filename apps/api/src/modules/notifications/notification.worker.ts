import { randomUUID } from 'node:crypto';
import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../../prisma/prisma.service';
import { DeliveryError, GmailSmtpAdapter } from './gmail-smtp.adapter';
import { NotificationRepository } from './notification.repository';
import { NotificationRouter } from './notification.router';
import { renderEmail } from './notification.templates';

@Injectable()
export class NotificationWorker {
  readonly workerId = randomUUID();
  private readonly logger = new Logger('NotificationWorker');
  private stopping = false;
  constructor(private readonly prisma: PrismaService, private readonly config: ConfigService, private readonly repository: NotificationRepository, private readonly router: NotificationRouter, private readonly email: GmailSmtpAdapter) {}
  stop() { this.stopping = true; }

  async tick() {
    if (this.stopping || !this.config.get<boolean>('NOTIFICATIONS_ENABLED', false)) return;
    await this.repository.heartbeat(this.workerId);
    const limit = this.config.get<number>('NOTIFICATIONS_BATCH_SIZE', 10);
    if (this.config.get<string>('NOTIFICATIONS_MODE', 'dry-run') !== 'live') { await this.repository.simulate(limit); return; }
    if (!this.config.get<boolean>('NOTIFICATIONS_EMAIL_ENABLED', false)) return;
    await this.repository.maintenance();
    await this.repository.recoverExpired();
    await this.repository.materialize(limit);
    for (let index = 0; index < limit && !this.stopping; index++) {
      const delivery = await this.repository.claim();
      if (!delivery) break;
      let submitted = false;
      try {
        const event = await this.prisma.notificationOutbox.findUniqueOrThrow({ where: { id: delivery.outboxId } });
        const cutoff = new Date(this.config.getOrThrow<string>('NOTIFICATIONS_LIVE_FROM'));
        if (event.createdAt < cutoff) { await this.repository.finish(delivery, 'SKIPPED', 'BEFORE_LIVE_CUTOFF'); continue; }
        const route = await this.router.resolve(event); // Recheck token, account, membership and domain freshness immediately before sending.
        if (route.outcome !== 'READY') { await this.repository.finish(delivery, route.outcome, route.code); continue; }
        const recipient = delivery.recipientEncrypted ? this.router.cipher.decrypt(delivery.recipientEncrypted) : '';
        if (!route.recipients.includes(recipient)) { await this.repository.finish(delivery, 'SKIPPED', 'RECIPIENT_NO_LONGER_ELIGIBLE'); continue; }
        const allowlist = this.config.get<string>('NOTIFICATIONS_RECIPIENT_ALLOWLIST', '').split(',').filter(Boolean);
        if (allowlist.length && !allowlist.includes(recipient)) { await this.repository.finish(delivery, 'BLOCKED', 'RECIPIENT_NOT_ALLOWLISTED'); continue; }
        const content = renderEmail(event.eventType, route.payload, this.config.getOrThrow<string>('WEB_ORIGIN'));
        const retryAt = await this.repository.reserveBudget();
        if (retryAt) { await this.repository.finish(delivery, 'PENDING', 'CHANNEL_PAUSED_OR_RATE_LIMITED', { availableAt: retryAt }); continue; }
        if (this.stopping) { await this.repository.finish(delivery, 'PENDING', 'WORKER_STOPPING'); break; }
        if (!await this.repository.submitted(delivery)) continue; // Fencing token lost: never send.
        submitted = true;
        const messageId = await this.email.send(recipient, content, delivery.id);
        await this.repository.finish(delivery, 'ACCEPTED', null, { messageId });
      } catch (error) {
        // Unknown DB/provider failures after submit are never blindly retried. Do not log raw errors.
        const failure = error instanceof DeliveryError ? error : new DeliveryError(submitted ? 'SUBMISSION_RESULT_UNKNOWN' : 'PREPARATION_FAILED', submitted ? 'unknown' : 'permanent');
        const attempt = delivery.attempts + (submitted ? 1 : 0);
        const max = this.config.get<number>('NOTIFICATIONS_MAX_ATTEMPTS', 5);
        if (failure.kind === 'pause') {
          const until = new Date(Date.now() + 24 * 3600000);
          await this.repository.pause(failure.safeCode, until);
          await this.repository.finish(delivery, attempt >= max ? 'FAILED' : 'PENDING', failure.safeCode, { availableAt: until });
          this.logger.warn(failure.safeCode);
        } else if (failure.kind === 'transient' && attempt < max) {
          const delays = [60000, 300000, 900000, 3600000];
          const delay = delays[Math.min(Math.max(attempt - 1, 0), delays.length - 1)]!;
          await this.repository.finish(delivery, 'PENDING', failure.safeCode, { availableAt: new Date(Date.now() + delay + Math.floor(Math.random() * delay * .1)) });
        } else await this.repository.finish(delivery, failure.kind === 'unknown' ? 'UNKNOWN' : 'FAILED', failure.safeCode);
      }
    }
  }
}
