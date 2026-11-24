import 'reflect-metadata';
import { setTimeout as delay } from 'node:timers/promises';
import { ConfigService } from '@nestjs/config';
import { NestFactory } from '@nestjs/core';
import { NotificationsModule } from './modules/notifications/notifications.module';
import { NotificationWorker } from './modules/notifications/notification.worker';

async function main() {
  const app = await NestFactory.createApplicationContext(NotificationsModule, { logger: false });
  const config = app.get(ConfigService);
  const worker = app.get(NotificationWorker);
  let stopping = false;
  const controller = new AbortController();
  const stop = () => { stopping = true; worker.stop(); controller.abort(); };
  process.once('SIGTERM', stop); process.once('SIGINT', stop);
  console.log(JSON.stringify({ service: 'notifications', mode: config.get('NOTIFICATIONS_MODE'), enabled: config.get('NOTIFICATIONS_ENABLED') }));
  try {
    while (!stopping) {
      try { await worker.tick(); } catch { console.error('NOTIFICATION_WORKER_TICK_FAILED'); }
      if (process.argv.includes('--once')) break;
      try { await delay(config.get<number>('NOTIFICATIONS_POLL_INTERVAL_MS', 5000), undefined, { signal: controller.signal }); } catch { /* shutdown */ }
    }
  } finally { await app.close(); }
}
if (require.main === module) main().catch(() => { console.error('NOTIFICATION_WORKER_START_FAILED'); process.exitCode = 1; });
