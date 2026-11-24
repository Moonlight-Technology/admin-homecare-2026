import type { ConfigService } from '@nestjs/config';
import type { PrismaService } from '../../prisma/prisma.service';
import type { AuditService } from '../audit/audit.service';
import type { OutboxService } from '../notifications/outbox.service';
import type { PasswordService } from './password.service';
import { AccountTokensService } from './account-tokens.service';

function setup(options: { status?: string; consumed?: number; activated?: number; expired?: boolean; used?: boolean } = {}) {
  const token = { id: 't1', userId: 'u1', purpose: 'INVITATION', user: { status: options.status ?? 'INVITED' }, usedAt: options.used ? new Date() : null, expiresAt: new Date(Date.now() + (options.expired ? -60_000 : 60_000)) };
  const prisma = {
    passwordResetToken: { findUnique: jest.fn(async () => token), updateMany: jest.fn(async () => ({ count: options.consumed ?? 1 })) },
    user: { updateMany: jest.fn(async () => ({ count: options.activated ?? 1 })) },
    $transaction: jest.fn(),
  };
  prisma.$transaction.mockImplementation(async (run: (tx: unknown) => unknown) => run(prisma));
  const audit = { record: jest.fn() };
  const service = new AccountTokensService(prisma as unknown as PrismaService, {} as ConfigService, { hash: jest.fn(async () => 'hash') } as unknown as PasswordService, {} as OutboxService, audit as unknown as AuditService);
  return { service, prisma, audit };
}

describe('account invitation acceptance', () => {
  const source = { actorId: null, scope: 'PUBLIC' as const };
  it('activates only an INVITED user and records the audit transactionally', async () => {
    const { service, prisma, audit } = setup();
    await service.acceptInvitation('test-token', 'test-password', source);
    expect(prisma.user.updateMany).toHaveBeenCalledWith({ where: { id: 'u1', status: 'INVITED' }, data: { passwordHash: 'hash', status: 'ACTIVE' } });
    expect(audit.record).toHaveBeenCalledWith({ ...source, actorId: 'u1' }, expect.objectContaining({ event: 'AUTH_INVITATION_ACCEPTED' }), prisma);
  });
  it.each([{ status: 'DISABLED' }, { status: 'SUSPENDED' }, { expired: true }, { used: true }, { consumed: 0 }, { activated: 0 }])('rejects invalid or concurrently revoked invitation: %j', async (options) => {
    const { service, audit } = setup(options);
    await expect(service.acceptInvitation('test-token', 'test-password', source)).rejects.toMatchObject({ code: 'INVALID_INVITATION' });
    expect(audit.record).not.toHaveBeenCalled();
  });
});
