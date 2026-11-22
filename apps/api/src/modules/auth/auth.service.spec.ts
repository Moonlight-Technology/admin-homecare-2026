import type { ConfigService } from '@nestjs/config';
import type { JwtService } from '@nestjs/jwt';
import type { PrismaService } from '../../prisma/prisma.service';
import type { AuditService } from '../audit/audit.service';
import type { OutboxService } from '../notifications/outbox.service';
import { AuthService } from './auth.service';
import type { PasswordService } from './password.service';
import { hashToken } from './tokens';

const source = { actorId: null, scope: 'PUBLIC' as const, ip: '127.0.0.1' };
const future = () => new Date(Date.now() + 60_000);

function setup(overrides: { refreshToken?: unknown; user?: unknown; resetToken?: unknown; consumed?: number } = {}) {
  const created: unknown[] = [];
  const outbox: unknown[] = [];
  const updates: Array<{ where: unknown; data: unknown }> = [];
  const refreshToken = {
    findUnique: jest.fn(async () => overrides.refreshToken ?? null),
    create: jest.fn(async (args: { data: unknown }) => { created.push(args.data); return { id: `rt-${created.length}` }; }),
    update: jest.fn(async () => ({})),
    updateMany: jest.fn(async (args: { where: unknown; data: unknown }) => { updates.push(args); return { count: overrides.consumed ?? 1 }; }),
  };
  const passwordResetToken = {
    findUnique: jest.fn(async () => overrides.resetToken ?? null),
    updateMany: jest.fn(async () => ({ count: overrides.consumed ?? 1 })),
    create: jest.fn(async () => ({})),
  };
  const user = { findUnique: jest.fn(async () => overrides.user ?? null), update: jest.fn(async () => ({})) };
  const prisma = { refreshToken, passwordResetToken, user } as Record<string, unknown>;
  prisma.$transaction = jest.fn(async (run: (tx: unknown) => unknown) => run(prisma));
  const config = { get: (_key: string, fallback: unknown) => fallback, getOrThrow: () => 'http://localhost:3000/reset-password' } as unknown as ConfigService;
  const jwt = { signAsync: jest.fn(async () => 'access-token') } as unknown as JwtService;
  const passwords = { verify: jest.fn(async (hash: string | null, password: string) => hash === 'hash' && password === 'correct-password'), hash: jest.fn(async () => 'new-hash') } as unknown as PasswordService;
  const audit = { record: jest.fn(async () => undefined) } as unknown as AuditService;
  const outboxService = { enqueue: jest.fn(async (event: unknown) => { outbox.push(event); }) } as unknown as OutboxService;
  const service = new AuthService(prisma as unknown as PrismaService, jwt, config, passwords, audit, outboxService);
  return { service, refreshToken, passwordResetToken, user, created, updates, outbox, audit };
}

describe('AuthService.login', () => {
  it('issues an access token and a hashed refresh token', async () => {
    const { service, created } = setup({ user: { id: 'u1', passwordHash: 'hash', status: 'ACTIVE' } });
    const session = await service.login('a@b.test', 'correct-password', source);
    expect(session.accessToken).toBe('access-token');
    expect((created[0] as { tokenHash: string }).tokenHash).toBe(hashToken(session.refreshToken));
  });

  it('gives the same error for unknown email, wrong password, and suspended accounts', async () => {
    const unknown = setup();
    const wrong = setup({ user: { id: 'u1', passwordHash: 'hash', status: 'ACTIVE' } });
    const suspended = setup({ user: { id: 'u1', passwordHash: 'hash', status: 'SUSPENDED' } });
    const messages = await Promise.all([
      unknown.service.login('x@b.test', 'correct-password', source).catch((error: Error) => error.message),
      wrong.service.login('a@b.test', 'wrong-password', source).catch((error: Error) => error.message),
      suspended.service.login('a@b.test', 'correct-password', source).catch((error: Error) => error.message),
    ]);
    expect(new Set(messages).size).toBe(1);
  });
});

describe('AuthService.refresh', () => {
  const live = { id: 'rt-old', userId: 'u1', familyId: 'family-1', revokedAt: null, expiresAt: future(), user: { status: 'ACTIVE' } };

  it('rotates the token within the same family', async () => {
    const { service, created } = setup({ refreshToken: live });
    const session = await service.refresh('raw-token', source);
    expect((created[0] as { familyId: string }).familyId).toBe('family-1');
    expect(session.refreshToken).not.toBe('raw-token');
  });

  it('revokes the whole family when a rotated token is replayed', async () => {
    const { service, updates, audit } = setup({ refreshToken: { ...live, revokedAt: new Date() } });
    await expect(service.refresh('raw-token', source)).rejects.toMatchObject({ code: 'UNAUTHORIZED' });
    expect(updates[0]).toMatchObject({ where: { familyId: 'family-1', revokedAt: null } });
    expect(audit.record).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ event: 'AUTH_REFRESH_REUSE_DETECTED' }));
  });

  it('rejects the losing side of two concurrent refreshes', async () => {
    const { service, created } = setup({ refreshToken: live, consumed: 0 });
    await expect(service.refresh('raw-token', source)).rejects.toMatchObject({ code: 'UNAUTHORIZED' });
    expect(created).toHaveLength(0);
  });

  it('rejects expired sessions and missing cookies', async () => {
    await expect(setup({ refreshToken: { ...live, expiresAt: new Date(0) } }).service.refresh('raw', source)).rejects.toMatchObject({ code: 'UNAUTHORIZED' });
    await expect(setup().service.refresh(undefined, source)).rejects.toMatchObject({ code: 'UNAUTHORIZED' });
  });
});

describe('AuthService password reset (AC-SEC-01)', () => {
  it('queues a reset link only for an active account and stays silent otherwise', async () => {
    const known = setup({ user: { id: 'u1', email: 'a@b.test', name: 'A', status: 'ACTIVE' } });
    await known.service.forgotPassword('a@b.test', source);
    expect(known.outbox).toHaveLength(1);

    const unknown = setup();
    await expect(unknown.service.forgotPassword('nobody@b.test', source)).resolves.toBeUndefined();
    expect(unknown.outbox).toHaveLength(0);
  });

  it('accepts a token once and signs the user out everywhere', async () => {
    const { service, refreshToken, user } = setup({ resetToken: { id: 'prt', userId: 'u1', purpose: 'PASSWORD_RESET', usedAt: null, expiresAt: future() } });
    await service.resetPassword('a'.repeat(43), 'new-strong-password', source);
    expect(user.update).toHaveBeenCalledWith({ where: { id: 'u1' }, data: { passwordHash: 'new-hash' } });
    expect(refreshToken.updateMany).toHaveBeenCalledWith(expect.objectContaining({ where: { userId: 'u1', revokedAt: null } }));
  });

  it('rejects used, expired, unknown, and invitation tokens', async () => {
    const reset = { id: 'p', userId: 'u1', purpose: 'PASSWORD_RESET', usedAt: null, expiresAt: future() };
    for (const resetToken of [{ ...reset, usedAt: new Date() }, { ...reset, expiresAt: new Date(0) }, { ...reset, purpose: 'INVITATION' }, null]) {
      await expect(setup({ resetToken: resetToken ?? undefined }).service.resetPassword('a'.repeat(43), 'new-strong-password', source)).rejects.toMatchObject({ code: 'INVALID_RESET_TOKEN' });
    }
  });
});
