import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Prisma } from '@prisma/client';
import { PrismaService, type Db } from '../../prisma/prisma.service';
import { NotificationCipher } from './notification.crypto';

export type OutboxEvent = {
  eventType: string;
  entityType: string;
  entityId: string;
  recipient?: string;
  payload: Record<string, unknown>;
};

/**
 * Transactional outbox: encrypted domain events are written in the same transaction as the change.
 * The dedicated notification worker materializes and delivers messages only when explicitly enabled.
 */
@Injectable()
export class OutboxService {
  constructor(private readonly prisma: PrismaService, private readonly config: ConfigService) {}

  async enqueue(event: OutboxEvent, db: Db = this.prisma) {
    await db.notificationOutbox.create({
      data: {
        eventType: event.eventType,
        entityType: event.entityType,
        entityId: event.entityId,
        recipient: event.recipient ?? null,
        payload: new NotificationCipher(this.config.getOrThrow<string>('CREDENTIAL_ENCRYPTION_KEY')).encode(event.payload) as Prisma.InputJsonValue,
      },
    });
  }
}

/** Compatibility contract for future channel adapters; SMTP uses the dedicated worker pipeline. */
export interface NotificationDispatcher {
  send(event: OutboxEvent & { id: string }): Promise<void>;
}
