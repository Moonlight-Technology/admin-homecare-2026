import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService, type Db } from '../../prisma/prisma.service';

export type OutboxEvent = {
  eventType: string;
  entityType: string;
  entityId: string;
  recipient?: string;
  payload: Record<string, unknown>;
};

/**
 * Transactional outbox: domain events are written in the same transaction as the change. Delivery (email, push,
 * WhatsApp) is still open (spec §14); a dispatcher implementing `NotificationDispatcher` will drain this table.
 */
@Injectable()
export class OutboxService {
  constructor(private readonly prisma: PrismaService) {}

  async enqueue(event: OutboxEvent, db: Db = this.prisma) {
    await db.notificationOutbox.create({
      data: {
        eventType: event.eventType,
        entityType: event.entityType,
        entityId: event.entityId,
        recipient: event.recipient ?? null,
        payload: event.payload as Prisma.InputJsonValue,
      },
    });
  }
}

/** Channel adapter to implement once the delivery provider is chosen. */
export interface NotificationDispatcher {
  send(event: OutboxEvent & { id: string }): Promise<void>;
}
