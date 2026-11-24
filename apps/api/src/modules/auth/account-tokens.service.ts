import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { AppError } from '../../common/errors/app-error';
import { PrismaService, type Db } from '../../prisma/prisma.service';
import { AuditService, type AuditSource } from '../audit/audit.service';
import { OutboxService } from '../notifications/outbox.service';
import { PasswordService } from './password.service';
import { hashToken, newOpaqueToken } from './tokens';

/**
 * Invitations for accounts created by an admin (spec §5.2): a one-time, time-limited link lets the owner set their
 * own password, so no password is ever generated or sent.
 */
@Injectable()
export class AccountTokensService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
    private readonly passwords: PasswordService,
    private readonly outbox: OutboxService,
    private readonly audit: AuditService,
  ) {}

  /** Replaces any earlier unused invitation, so only the newest link works. Call inside the creating transaction. */
  async issueInvitation(db: Db, user: { id: string; email: string; name: string }, context: { facilityName: string }) {
    const token = newOpaqueToken();
    const ttlHours = this.config.get<number>('INVITATION_TTL_HOURS', 72);
    await db.passwordResetToken.updateMany({ where: { userId: user.id, purpose: 'INVITATION', usedAt: null }, data: { usedAt: new Date() } });
    await db.passwordResetToken.create({
      data: { userId: user.id, purpose: 'INVITATION', tokenHash: hashToken(token), expiresAt: new Date(Date.now() + ttlHours * 3_600_000) },
    });
    await this.outbox.enqueue(
      {
        eventType: 'ACCOUNT_INVITATION',
        entityType: 'User',
        entityId: user.id,
        recipient: user.email,
        payload: { name: user.name, facilityName: context.facilityName, invitationUrl: `${this.config.getOrThrow<string>('INVITATION_URL')}?token=${token}`, expiresInHours: ttlHours },
      },
      db,
    );
  }

  /** Sets the password and activates the account; the link works once. */
  async acceptInvitation(token: string, password: string, source: AuditSource) {
    const invalid = () => AppError.unprocessable('INVALID_INVITATION', 'This invitation link is invalid or has expired. Ask the admin to send a new one.');
    const stored = await this.prisma.passwordResetToken.findUnique({ where: { tokenHash: hashToken(token) }, include: { user: { select: { status: true } } } });
    if (!stored || stored.purpose !== 'INVITATION' || stored.usedAt || stored.expiresAt <= new Date() || stored.user.status !== 'INVITED') throw invalid();
    const passwordHash = await this.passwords.hash(password);
    await this.prisma.$transaction(async (tx) => {
      const consumed = await tx.passwordResetToken.updateMany({ where: { id: stored.id, usedAt: null, expiresAt: { gt: new Date() } }, data: { usedAt: new Date() } });
      if (consumed.count === 0) throw invalid();
      const activated = await tx.user.updateMany({ where: { id: stored.userId, status: 'INVITED' }, data: { passwordHash, status: 'ACTIVE' } });
      if (activated.count === 0) throw invalid();
      await this.audit.record({ ...source, actorId: stored.userId }, { event: 'AUTH_INVITATION_ACCEPTED', entityType: 'User', entityId: stored.userId }, tx);
    });
  }
}
