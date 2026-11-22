import { randomUUID } from 'node:crypto';
import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { AppError } from '../../common/errors/app-error';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditService, type AuditSource } from '../audit/audit.service';
import { OutboxService } from '../notifications/outbox.service';
import type { AccessTokenPayload } from '../../common/access/auth-context.service';
import { PasswordService } from './password.service';
import { hashToken, newOpaqueToken } from './tokens';

export type IssuedSession = { accessToken: string; expiresIn: number; refreshToken: string; refreshTokenId: string; refreshMaxAgeMs: number };

const INVALID_LOGIN = 'Email or password is incorrect.';

@Injectable()
export class AuthService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly jwt: JwtService,
    private readonly config: ConfigService,
    private readonly passwords: PasswordService,
    private readonly audit: AuditService,
    private readonly outbox: OutboxService,
  ) {}

  /** Same message and timing for unknown email, wrong password, and inactive account (no enumeration). */
  async login(email: string, password: string, source: AuditSource): Promise<IssuedSession> {
    const user = await this.prisma.user.findUnique({ where: { email }, select: { id: true, passwordHash: true, status: true } });
    const valid = await this.passwords.verify(user?.passwordHash, password);
    if (!user || !valid || user.status !== 'ACTIVE') throw AppError.unauthorized(INVALID_LOGIN);

    const session = await this.issue(user.id, randomUUID(), source);
    await this.prisma.user.update({ where: { id: user.id }, data: { lastLoginAt: new Date() } });
    await this.audit.record({ ...source, actorId: user.id }, { event: 'AUTH_LOGIN', entityType: 'User', entityId: user.id });
    return session;
  }

  /**
   * Rotates the refresh token. A token that was already rotated or revoked means it was stolen or replayed,
   * so the whole session family is revoked and the user must sign in again.
   */
  async refresh(rawToken: string | undefined, source: AuditSource): Promise<IssuedSession> {
    if (!rawToken) throw AppError.unauthorized();
    const stored = await this.prisma.refreshToken.findUnique({
      where: { tokenHash: hashToken(rawToken) },
      include: { user: { select: { status: true } } },
    });
    if (!stored) throw AppError.unauthorized();
    if (stored.revokedAt) {
      await this.revokeFamily(stored.familyId);
      await this.audit.record({ ...source, actorId: stored.userId }, { event: 'AUTH_REFRESH_REUSE_DETECTED', entityType: 'User', entityId: stored.userId });
      throw AppError.unauthorized('The session is no longer valid. Please sign in again.');
    }
    if (stored.expiresAt <= new Date() || stored.user.status !== 'ACTIVE') {
      await this.revokeFamily(stored.familyId);
      throw AppError.unauthorized('The session has expired. Please sign in again.');
    }

    // Only one concurrent refresh can consume the token; a parallel one sees count 0 and is rejected.
    const consumed = await this.prisma.refreshToken.updateMany({
      where: { id: stored.id, revokedAt: null },
      data: { revokedAt: new Date() },
    });
    if (consumed.count === 0) throw AppError.unauthorized('The session is no longer valid. Please sign in again.');
    const session = await this.issue(stored.userId, stored.familyId, source);
    await this.prisma.refreshToken.update({ where: { id: stored.id }, data: { replacedBy: session.refreshTokenId } });
    return session;
  }

  async logout(rawToken: string | undefined, source: AuditSource) {
    if (!rawToken) return;
    const stored = await this.prisma.refreshToken.findUnique({ where: { tokenHash: hashToken(rawToken) } });
    if (!stored) return;
    await this.revokeFamily(stored.familyId);
    await this.audit.record({ ...source, actorId: stored.userId }, { event: 'AUTH_LOGOUT', entityType: 'User', entityId: stored.userId });
  }

  /** Always succeeds from the caller's view; a reset link is queued only for an active account (AC-SEC-01). */
  async forgotPassword(email: string, source: AuditSource) {
    const user = await this.prisma.user.findUnique({ where: { email }, select: { id: true, email: true, name: true, status: true } });
    if (!user || user.status !== 'ACTIVE') return;

    const token = newOpaqueToken();
    const ttlMinutes = this.config.get<number>('PASSWORD_RESET_TTL_MINUTES', 30);
    await this.prisma.$transaction(async (tx) => {
      // Only the newest link works.
      await tx.passwordResetToken.updateMany({ where: { userId: user.id, purpose: 'PASSWORD_RESET', usedAt: null }, data: { usedAt: new Date() } });
      await tx.passwordResetToken.create({
        data: { userId: user.id, purpose: 'PASSWORD_RESET', tokenHash: hashToken(token), expiresAt: new Date(Date.now() + ttlMinutes * 60_000) },
      });
      await this.outbox.enqueue({
        eventType: 'PASSWORD_RESET_REQUESTED',
        entityType: 'User',
        entityId: user.id,
        recipient: user.email,
        payload: { name: user.name, resetUrl: `${this.config.getOrThrow<string>('PASSWORD_RESET_URL')}?token=${token}`, expiresInMinutes: ttlMinutes },
      }, tx);
      await this.audit.record({ ...source, actorId: null }, { event: 'AUTH_PASSWORD_RESET_REQUESTED', entityType: 'User', entityId: user.id }, tx);
    });
  }

  /** One-time, time-limited; signs the user out everywhere. */
  async resetPassword(token: string, password: string, source: AuditSource) {
    const stored = await this.prisma.passwordResetToken.findUnique({ where: { tokenHash: hashToken(token) } });
    if (!stored || stored.purpose !== 'PASSWORD_RESET' || stored.usedAt || stored.expiresAt <= new Date()) {
      throw AppError.unprocessable('INVALID_RESET_TOKEN', 'This reset link is invalid or has expired. Please request a new one.');
    }
    const passwordHash = await this.passwords.hash(password);
    await this.prisma.$transaction(async (tx) => {
      const consumed = await tx.passwordResetToken.updateMany({ where: { id: stored.id, usedAt: null }, data: { usedAt: new Date() } });
      if (consumed.count === 0) throw AppError.unprocessable('INVALID_RESET_TOKEN', 'This reset link is invalid or has expired. Please request a new one.');
      await tx.user.update({ where: { id: stored.userId }, data: { passwordHash } });
      await tx.refreshToken.updateMany({ where: { userId: stored.userId, revokedAt: null }, data: { revokedAt: new Date() } });
      await this.audit.record({ ...source, actorId: stored.userId }, { event: 'AUTH_PASSWORD_RESET', entityType: 'User', entityId: stored.userId }, tx);
    });
  }

  private async issue(userId: string, familyId: string, source: AuditSource): Promise<IssuedSession> {
    const expiresIn = this.config.get<number>('JWT_ACCESS_TTL_SECONDS', 900);
    const refreshMaxAgeMs = this.config.get<number>('REFRESH_TOKEN_TTL_DAYS', 14) * 86_400_000;
    const refreshToken = newOpaqueToken();
    const { id: refreshTokenId } = await this.prisma.refreshToken.create({
      select: { id: true },
      data: {
        userId,
        familyId,
        tokenHash: hashToken(refreshToken),
        expiresAt: new Date(Date.now() + refreshMaxAgeMs),
        userAgent: source.userAgent ?? null,
        ip: source.ip ?? null,
      },
    });
    const accessToken = await this.jwt.signAsync({ sub: userId, typ: 'access' } satisfies AccessTokenPayload, { expiresIn });
    return { accessToken, expiresIn, refreshToken, refreshTokenId, refreshMaxAgeMs };
  }

  private revokeFamily(familyId: string) {
    return this.prisma.refreshToken.updateMany({ where: { familyId, revokedAt: null }, data: { revokedAt: new Date() } });
  }
}
