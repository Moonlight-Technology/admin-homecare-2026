import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import type { AuthenticatedRequest } from '../../common/access/auth-context';
import { PrismaService, type Db } from '../../prisma/prisma.service';
import { redact } from './redact';

export type AuditEntry = {
  event: string;
  entityType: string;
  entityId?: string | null;
  facilityId?: string | null;
  before?: unknown;
  after?: unknown;
};

/** Where an action came from: the actor and request metadata for the audit trail. */
export type AuditSource = { actorId: string | null; scope: 'PLATFORM' | 'FACILITY' | 'SYSTEM' | 'PUBLIC'; ip?: string; userAgent?: string; requestId?: string };

export const auditSource = (request: AuthenticatedRequest, scope: AuditSource['scope']): AuditSource => ({
  actorId: request.auth?.userId ?? null,
  scope,
  ip: request.ip,
  userAgent: request.header('user-agent')?.slice(0, 500),
  requestId: request.requestId,
});

/** Records sensitive actions (spec §10). Pass a transaction client so the entry commits with the change it describes. */
@Injectable()
export class AuditService {
  constructor(private readonly prisma: PrismaService) {}

  async record(source: AuditSource, entry: AuditEntry, db: Db = this.prisma) {
    await db.auditLog.create({
      data: {
        actorId: source.actorId,
        scope: source.scope,
        facilityId: entry.facilityId ?? null,
        event: entry.event,
        entityType: entry.entityType,
        entityId: entry.entityId ?? null,
        before: entry.before === undefined ? Prisma.JsonNull : (redact(entry.before) as Prisma.InputJsonValue),
        after: entry.after === undefined ? Prisma.JsonNull : (redact(entry.after) as Prisma.InputJsonValue),
        ip: source.ip ?? null,
        userAgent: source.userAgent ?? null,
        requestId: source.requestId ?? null,
      },
    });
  }
}
