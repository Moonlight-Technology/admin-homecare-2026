import 'reflect-metadata';
import { ConfigService } from '@nestjs/config';
import { NestFactory } from '@nestjs/core';
import { PrismaService } from './prisma/prisma.service';
import { NotificationsModule } from './modules/notifications/notifications.module';
import { GmailSmtpAdapter } from './modules/notifications/gmail-smtp.adapter';

async function main() {
  const app = await NestFactory.createApplicationContext(NotificationsModule, { logger: false });
  try {
    if (process.argv.includes('--smtp')) {
      const config = app.get(ConfigService);
      if (!config.get<boolean>('NOTIFICATIONS_ENABLED') || config.get<string>('NOTIFICATIONS_MODE') !== 'live' || !config.get<boolean>('NOTIFICATIONS_EMAIL_ENABLED')) throw new Error('SMTP_CHECK_REQUIRES_EXPLICIT_LIVE_CONFIG');
      await app.get(GmailSmtpAdapter).verify();
      console.log('SMTP_CONNECTION_AUTH_OK_NOT_A_DELIVERY_TEST');
    } else {
      const db = app.get(PrismaService);
      if (process.argv.includes('--health') && !app.get(ConfigService).get<boolean>('NOTIFICATIONS_ENABLED')) {
        console.log('NOTIFICATIONS_DISABLED'); return;
      }
      const [counts, heartbeat, oldest, pause] = await Promise.all([
        db.notificationDelivery.groupBy({ by: ['status'], _count: true }),
        db.notificationControl.findFirst({ where: { key: { startsWith: 'worker:' } }, orderBy: { updatedAt: 'desc' }, select: { updatedAt: true } }),
        db.notificationDelivery.findFirst({ where: { status: 'PENDING' }, orderBy: { createdAt: 'asc' }, select: { createdAt: true } }),
        db.notificationControl.findUnique({ where: { key: 'channel:EMAIL' }, select: { reason: true, pausedUntil: true } }),
      ]);
      if (process.argv.includes('--health') && (!heartbeat || Date.now() - heartbeat.updatedAt.getTime() > 180000)) throw new Error('WORKER_HEARTBEAT_STALE');
      console.log(JSON.stringify({ counts, heartbeat, oldestPending: oldest?.createdAt ?? null, emailPause: pause }));
    }
  } finally { await app.close(); }
}
if (require.main === module) main().catch(() => { console.error('NOTIFICATION_CHECK_FAILED'); process.exitCode = 1; });
