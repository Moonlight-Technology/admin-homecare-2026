/** Helpers for isolated fixtures only. Never log the decrypted payload or its key. */
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { NotificationCipher } = require('../../dist/modules/notifications/notification.crypto.js');
export async function countOutboxStatus(db, entityId, status, secret) {
  const cipher = new NotificationCipher(secret);
  const events = await db.notificationOutbox.findMany({ where: { entityId, eventType: 'ORDER_STATUS_CHANGED' } });
  return events.filter((event) => cipher.decode(event.payload).status === status).length;
}
