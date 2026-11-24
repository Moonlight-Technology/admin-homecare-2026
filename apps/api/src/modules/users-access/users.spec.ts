import 'reflect-metadata';
import { Prisma } from '@prisma/client';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { ACCESS_KEY } from '../../common/access/access.decorators';
import { PaginationQueryDto } from '../../common/dto/pagination.dto';
import type { PrismaService } from '../../prisma/prisma.service';
import type { AuditService } from '../audit/audit.service';
import type { AccountTokensService } from '../auth/account-tokens.service';
import { UsersController } from './users.controller';
import { InvitePlatformUserDto, PlatformUserStatusDto, UpdatePlatformUserDto, UserQueryDto } from './users.dto';
import { platformUserSelect, UsersService } from './users.service';

const source = { actorId: 'actor', scope: 'PLATFORM' as const };
const role = (code = 'PLATFORM_OPERATOR') => ({ id: `r-${code}`, role: { code, name: code } });
const account = (overrides: Record<string, unknown> = {}) => ({ id: 'target', name: 'Operator', email: 'operator@example.test', status: 'ACTIVE', createdAt: new Date(), lastLoginAt: null, memberships: [role()], ...overrides });
type RecordView = ReturnType<typeof account>;

function setup(options: { target?: RecordView | null; actor?: RecordView | null; others?: number; password?: string | null; duplicate?: boolean } = {}) {
  const target = options.target === undefined ? account() : options.target;
  const actor = options.actor === undefined ? account({ id: 'actor', memberships: [role('PLATFORM_SUPER_ADMIN')] }) : options.actor;
  const prisma = {
    user: {
      findFirst: jest.fn(async (args: { where: { id?: string } }) => args.where.id === 'actor' ? actor : target),
      findUnique: jest.fn(async () => options.duplicate ? { id: 'existing' } : null),
      findUniqueOrThrow: jest.fn(async () => ({ passwordHash: options.password === undefined ? 'hash' : options.password })),
      findMany: jest.fn(async () => [target]), count: jest.fn(async () => options.others ?? 1),
      create: jest.fn(async (args: { data: { name: string; email: string } }) => account({ ...args.data, status: 'INVITED' })),
      update: jest.fn(async () => target),
    },
    role: { findFirst: jest.fn(async () => ({ id: 'role-id' })) },
    membership: { updateMany: jest.fn(async () => ({ count: 1 })), create: jest.fn(async () => ({})) },
    refreshToken: { updateMany: jest.fn(async () => ({ count: 2 })) },
    passwordResetToken: { updateMany: jest.fn(async () => ({ count: 1 })) },
    $transaction: jest.fn(),
  };
  prisma.$transaction.mockImplementation(async (run: (tx: unknown) => unknown) => run(prisma));
  const audit = { record: jest.fn(async () => undefined) };
  const tokens = { issueInvitation: jest.fn(async () => undefined) };
  const service = new UsersService(prisma as unknown as PrismaService, audit as unknown as AuditService, tokens as unknown as AccountTokensService);
  return { service, prisma, audit, tokens };
}

describe('platform user reads', () => {
  it('filters only active platform memberships, with pagination/search/status/role', async () => {
    const { service, prisma } = setup();
    await service.list({ ...new PaginationQueryDto(), search: 'ari', status: 'ACTIVE', roleCode: 'PLATFORM_OPERATOR', page: 2 });
    expect(prisma.user.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { memberships: { some: { scopeType: 'PLATFORM', active: true, role: { code: 'PLATFORM_OPERATOR' } } }, status: 'ACTIVE', OR: expect.any(Array) }, skip: 20, take: 20, select: platformUserSelect,
    }));
  });
  it('uses an explicit safe projection with no credential or token fields', () => {
    expect(Object.keys(platformUserSelect).sort()).toEqual(['createdAt', 'email', 'id', 'lastLoginAt', 'memberships', 'name', 'status']);
  });
  it('returns 404 for unknown or clinic-only accounts', async () => {
    const { service, prisma } = setup({ target: null });
    await expect(service.detail('clinic-user')).rejects.toMatchObject({ code: 'NOT_FOUND' });
    expect(prisma.user.findFirst).toHaveBeenCalledWith(expect.objectContaining({ where: { id: 'clinic-user', memberships: { some: { scopeType: 'PLATFORM', active: true } } } }));
  });
});

describe('platform user invitations', () => {
  const dto = { name: 'New Operator', email: 'new@example.test', roleCode: 'PLATFORM_OPERATOR' as const };
  it('creates INVITED without password, a platform membership, outbox invitation and transactional audit', async () => {
    const { service, prisma, tokens, audit } = setup();
    await service.invite(dto, source);
    expect(prisma.user.create).toHaveBeenCalledWith(expect.objectContaining({ data: { name: dto.name, email: dto.email, status: 'INVITED', memberships: { create: { scopeType: 'PLATFORM', roleId: 'role-id' } } } }));
    expect(tokens.issueInvitation).toHaveBeenCalledWith(prisma, expect.objectContaining({ status: 'INVITED' }), { facilityName: 'Nakes Platform' });
    expect(audit.record).toHaveBeenCalledWith(source, expect.objectContaining({ event: 'PLATFORM_USER_INVITED' }), prisma);
    expect(prisma.$transaction).toHaveBeenCalledWith(expect.any(Function), { isolationLevel: 'Serializable' });
  });
  it('rejects an existing email rather than granting access to a clinic account', async () => {
    const { service, prisma } = setup({ duplicate: true });
    await expect(service.invite(dto, source)).rejects.toMatchObject({ code: 'DUPLICATE', details: { fields: { email: expect.any(Array) } } });
    expect(prisma.user.create).not.toHaveBeenCalled();
  });
  it('resends only pending invitations', async () => {
    await expect(setup().service.resendInvitation('target', source)).rejects.toMatchObject({ code: 'NOT_INVITED' });
    const { service, tokens } = setup({ target: account({ status: 'INVITED' }) });
    await service.resendInvitation('target', source);
    expect(tokens.issueInvitation).toHaveBeenCalledTimes(1);
  });
  it('requires the seeded platform role', async () => {
    const { service, prisma } = setup();
    prisma.role.findFirst.mockResolvedValue(null as never);
    await expect(service.invite(dto, source)).rejects.toMatchObject({ code: 'ROLE_NOT_CONFIGURED' });
  });
});

describe('platform user access protection', () => {
  it('rechecks the actor inside the transaction', async () => {
    const { service, prisma } = setup({ actor: null });
    await expect(service.update('target', { name: 'Renamed' }, source)).rejects.toMatchObject({ code: 'FORBIDDEN' });
    expect(prisma.user.update).not.toHaveBeenCalled();
  });
  it('rejects unauthenticated mutation sources', async () => {
    await expect(setup().service.update('target', { name: 'Renamed' }, { ...source, actorId: null })).rejects.toMatchObject({ code: 'FORBIDDEN' });
  });
  it('does not allow a non-super manager to promote or edit super admins', async () => {
    const actor = account({ id: 'actor' });
    await expect(setup({ actor }).service.update('target', { name: 'Name', roleCode: 'PLATFORM_SUPER_ADMIN' }, source)).rejects.toMatchObject({ code: 'FORBIDDEN' });
    await expect(setup({ actor, target: account({ memberships: [role('PLATFORM_SUPER_ADMIN')] }) }).service.update('target', { name: 'Name' }, source)).rejects.toMatchObject({ code: 'FORBIDDEN' });
  });
  it('blocks self demotion and status changes while allowing a name-only edit', async () => {
    const { service } = setup();
    await expect(service.update('actor', { name: 'Admin', roleCode: 'PLATFORM_OPERATOR' }, source)).rejects.toMatchObject({ code: 'SELF_ACCESS_CHANGE' });
    await expect(service.status('actor', { action: 'DISABLE', reason: 'Testing reason' }, source)).rejects.toMatchObject({ code: 'SELF_ACCESS_CHANGE' });
    await expect(service.update('actor', { name: 'Admin Baru' }, source)).resolves.toBeDefined();
  });
  it('protects the last ACTIVE super admin from demotion or disabling', async () => {
    const { service } = setup({ target: account({ memberships: [role('PLATFORM_SUPER_ADMIN')] }), others: 0 });
    await expect(service.update('target', { name: 'Admin', roleCode: 'PLATFORM_OPERATOR' }, source)).rejects.toMatchObject({ code: 'LAST_SUPER_ADMIN' });
    await expect(service.status('target', { action: 'DISABLE', reason: 'Testing reason' }, source)).rejects.toMatchObject({ code: 'LAST_SUPER_ADMIN' });
  });
  it('changes only platform memberships and revokes refresh sessions on role change', async () => {
    const { service, prisma } = setup();
    await service.update('target', { name: 'New Admin', roleCode: 'PLATFORM_SUPER_ADMIN' }, source);
    expect(prisma.membership.updateMany).toHaveBeenCalledWith({ where: { userId: 'target', scopeType: 'PLATFORM', active: true }, data: { active: false } });
    expect(prisma.membership.create).toHaveBeenCalledWith({ data: { userId: 'target', scopeType: 'PLATFORM', roleId: 'role-id' } });
    expect(prisma.refreshToken.updateMany).toHaveBeenCalledWith({ where: { userId: 'target', revokedAt: null }, data: { revokedAt: expect.any(Date) } });
  });
  it('does not revoke sessions for a name-only change', async () => {
    const { service, prisma } = setup();
    await service.update('target', { name: 'Renamed' }, source);
    expect(prisma.refreshToken.updateMany).not.toHaveBeenCalled();
  });
  it('suspends with audit reason and invalidates refresh/reset/invitation tokens', async () => {
    const { service, prisma, audit } = setup();
    await service.status('target', { action: 'SUSPEND', reason: 'Akses sedang ditinjau' }, source);
    expect(prisma.user.update).toHaveBeenCalledWith({ where: { id: 'target' }, data: { status: 'SUSPENDED' } });
    expect(prisma.passwordResetToken.updateMany).toHaveBeenCalledWith({ where: { userId: 'target', usedAt: null }, data: { usedAt: expect.any(Date) } });
    expect(audit.record).toHaveBeenCalledWith(source, expect.objectContaining({ after: { status: 'SUSPENDED', reason: 'Akses sedang ditinjau' } }), prisma);
  });
  it('restores a passwordless account to INVITED, never ACTIVE', async () => {
    const { service, prisma, tokens } = setup({ target: account({ status: 'DISABLED' }), password: null });
    await service.status('target', { action: 'ENABLE', reason: 'Akses dipulihkan' }, source);
    expect(prisma.user.update).toHaveBeenCalledWith({ where: { id: 'target' }, data: { status: 'INVITED' } });
    expect(tokens.issueInvitation).toHaveBeenCalledTimes(1);
  });
  it('restores an account with password to ACTIVE without an invitation', async () => {
    const { service, prisma, tokens } = setup({ target: account({ status: 'SUSPENDED' }) });
    await service.status('target', { action: 'ENABLE', reason: 'Akses dipulihkan' }, source);
    expect(prisma.user.update).toHaveBeenCalledWith({ where: { id: 'target' }, data: { status: 'ACTIVE' } });
    expect(tokens.issueInvitation).not.toHaveBeenCalled();
  });
  it('rejects unchanged status', async () => {
    await expect(setup().service.status('target', { action: 'ENABLE', reason: 'Akses dipulihkan' }, source)).rejects.toMatchObject({ code: 'STATUS_UNCHANGED' });
  });
  it('retries serialization conflicts and bounds retries with HTTP 409', async () => {
    const { service, prisma } = setup();
    const conflict = new Prisma.PrismaClientKnownRequestError('serialization failure', { code: 'P2034', clientVersion: 'test' });
    prisma.$transaction.mockRejectedValueOnce(conflict);
    await expect(service.update('target', { name: 'Renamed' }, source)).resolves.toBeDefined();
    expect(prisma.$transaction).toHaveBeenCalledTimes(2);
    prisma.$transaction.mockReset().mockRejectedValue(conflict);
    await expect(service.update('target', { name: 'Renamed' }, source)).rejects.toMatchObject({ code: 'CONCURRENT_CHANGE', status: 409 });
    expect(prisma.$transaction).toHaveBeenCalledTimes(3);
  });
});

describe('user endpoint and input contracts', () => {
  it.each(['list', 'detail'] as const)('%s requires platform read', (method) => {
    expect(Reflect.getMetadata(ACCESS_KEY, UsersController.prototype[method])).toEqual({ kind: 'platform', permissions: ['platform-user:read'] });
  });
  it.each(['invite', 'update', 'status', 'resend'] as const)('%s requires platform manage', (method) => {
    expect(Reflect.getMetadata(ACCESS_KEY, UsersController.prototype[method])).toEqual({ kind: 'platform', permissions: ['platform-user:manage'] });
  });
  it('normalizes email/name and rejects clinic role assignment', async () => {
    const value = plainToInstance(InvitePlatformUserDto, { name: ' Operator ', email: ' OPERATOR@EXAMPLE.TEST ', roleCode: 'CLINIC_OWNER_ADMIN' });
    expect(value.email).toBe('operator@example.test'); expect(value.name).toBe('Operator');
    expect((await validate(value)).map((error) => error.property)).toContain('roleCode');
  });
  it('requires valid names/reasons and does not allow status INVITED via the status action', async () => {
    expect((await validate(plainToInstance(UpdatePlatformUserDto, { name: null }))).length).toBeGreaterThan(0);
    expect((await validate(plainToInstance(PlatformUserStatusDto, { action: 'INVITED', reason: ' ' }))).length).toBe(2);
    expect((await validate(plainToInstance(UserQueryDto, { roleCode: 'CLINIC_STAFF' }))).length).toBeGreaterThan(0);
  });
});
