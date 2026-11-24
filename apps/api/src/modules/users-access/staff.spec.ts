import 'reflect-metadata';
import { Prisma } from '@prisma/client';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { ACCESS_KEY } from '../../common/access/access.decorators';
import type { FacilityScope } from '../../common/access/auth-context';
import { PaginationQueryDto } from '../../common/dto/pagination.dto';
import type { PrismaService } from '../../prisma/prisma.service';
import type { AuditService } from '../audit/audit.service';
import type { AccountTokensService } from '../auth/account-tokens.service';
import { StaffController } from './staff.controller';
import { InviteStaffDto, StaffAccessDto, StaffQueryDto, UpdateStaffRoleDto } from './staff.dto';
import { StaffService, staffSelect } from './staff.service';

const scope: FacilityScope = { facilityId: 'clinic-a', membershipId: 'actor-membership', roleCode: 'CLINIC_OWNER_ADMIN', permissions: new Set(['staff:read', 'staff:manage']) };
const source = { actorId: 'actor-user', scope: 'FACILITY' as const };
const record = (overrides: Record<string, unknown> = {}) => ({
  id: 'target-membership', facilityId: 'clinic-a', active: true, createdAt: new Date(),
  user: { id: 'target-user', name: 'Staff', email: 'staff@example.test', status: 'ACTIVE' },
  role: { code: 'CLINIC_STAFF', name: 'Staff', permissions: [{ permission: { code: 'order:read' } }] }, ...overrides,
});

function setup(options: { target?: ReturnType<typeof record> | null; actor?: string | null; duplicate?: boolean; others?: number; roleMissing?: boolean } = {}) {
  const target = options.target === undefined ? record() : options.target;
  const actorCode = options.actor === undefined ? 'CLINIC_OWNER_ADMIN' : options.actor;
  const prisma = {
    membership: {
      findFirst: jest.fn(async (args: { where: { id: string; facilityId: string } }) => {
        if (args.where.id === 'actor-membership') return actorCode ? { role: { code: actorCode } } : null;
        return target?.facilityId === args.where.facilityId ? target : null;
      }),
      findMany: jest.fn(async () => target ? [target] : []),
      count: jest.fn(async () => options.others ?? 1),
      create: jest.fn(async () => record({ user: { id: 'new-user', name: 'New Staff', email: 'new@example.test', status: 'INVITED' } })),
      update: jest.fn(async (args: { data: Record<string, unknown> }) => ({ ...target, ...args.data })),
    },
    user: { findUnique: jest.fn(async () => options.duplicate ? { id: 'existing' } : null), create: jest.fn(async () => ({ id: 'new-user', name: 'New Staff', email: 'new@example.test' })), update: jest.fn() },
    role: { findFirst: jest.fn(async () => options.roleMissing ? null : { id: 'role-id' }), findMany: jest.fn(async () => [record().role]) },
    facility: { findUniqueOrThrow: jest.fn(async () => ({ displayName: 'Klinik A' })) },
    refreshToken: { updateMany: jest.fn() },
    passwordResetToken: { updateMany: jest.fn(async () => ({ count: 1 })) },
    $transaction: jest.fn(),
  };
  prisma.$transaction.mockImplementation(async (run: (tx: unknown) => unknown) => run(prisma));
  const audit = { record: jest.fn(async () => undefined) };
  const tokens = { issueInvitation: jest.fn(async () => undefined) };
  const service = new StaffService(prisma as unknown as PrismaService, audit as unknown as AuditService, tokens as unknown as AccountTokensService);
  return { service, prisma, audit, tokens };
}

describe('clinic staff reads and tenancy', () => {
  it('always scopes list/search/role/access/pagination to the caller facility', async () => {
    const { service, prisma } = setup();
    const result = await service.list(scope, { ...new PaginationQueryDto(), access: 'INACTIVE', roleCode: 'CLINIC_STAFF', search: 'ari', page: 2 });
    expect(prisma.membership.findMany).toHaveBeenCalledWith(expect.objectContaining({ where: { scopeType: 'FACILITY', facilityId: 'clinic-a', active: false, role: { code: 'CLINIC_STAFF' }, user: { OR: expect.any(Array) } }, skip: 20, take: 20, select: staffSelect }));
    expect(result.items[0]?.role.permissions).toEqual(['order:read']);
  });
  it('uses only safe staff account fields', () => {
    expect(Object.keys(staffSelect.user.select).sort()).toEqual(['email', 'id', 'name', 'status']);
  });
  it('does not leak memberships from another clinic', async () => {
    const { service } = setup({ target: record({ facilityId: 'clinic-b' }) });
    await expect(service.detail(scope, 'target-membership')).rejects.toMatchObject({ code: 'NOT_FOUND' });
    await expect(service.updateRole(scope, 'target-membership', { roleCode: 'CLINIC_OWNER_ADMIN' }, source)).rejects.toMatchObject({ code: 'NOT_FOUND' });
    await expect(service.access(scope, 'target-membership', { action: 'DISABLE', reason: 'Reason test' }, source)).rejects.toMatchObject({ code: 'NOT_FOUND' });
    await expect(service.resend(scope, 'target-membership', source)).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });
  it('returns only seeded facility roles and their existing permissions', async () => {
    const { service, prisma } = setup();
    expect(await service.roles()).toEqual([{ code: 'CLINIC_STAFF', name: 'Staff', permissions: ['order:read'] }]);
    expect(prisma.role.findMany).toHaveBeenCalledWith(expect.objectContaining({ where: { scope: 'FACILITY', code: { in: ['CLINIC_OWNER_ADMIN', 'CLINIC_STAFF'] } } }));
  });
});

describe('clinic staff invitations', () => {
  const dto = { name: 'New Staff', email: 'new@example.test', roleCode: 'CLINIC_STAFF' as const };
  it('creates a passwordless invited account with only the caller clinic membership', async () => {
    const { service, prisma, tokens, audit } = setup();
    await service.invite(scope, dto, source);
    expect(prisma.user.create).toHaveBeenCalledWith({ data: { name: 'New Staff', email: 'new@example.test', status: 'INVITED' }, select: { id: true, name: true, email: true } });
    expect(prisma.membership.create).toHaveBeenCalledWith({ data: { userId: 'new-user', scopeType: 'FACILITY', facilityId: 'clinic-a', roleId: 'role-id' }, select: staffSelect });
    expect(tokens.issueInvitation).toHaveBeenCalledWith(prisma, { id: 'new-user', name: 'New Staff', email: 'new@example.test' }, { facilityName: 'Klinik A' });
    expect(audit.record).toHaveBeenCalledWith(source, expect.objectContaining({ event: 'CLINIC_STAFF_INVITED', facilityId: 'clinic-a' }), prisma);
  });
  it('never silently attaches an existing account from another clinic or platform', async () => {
    const { service, prisma } = setup({ duplicate: true });
    await expect(service.invite(scope, dto, source)).rejects.toMatchObject({ code: 'DUPLICATE', details: { fields: { email: expect.any(Array) } } });
    expect(prisma.membership.create).not.toHaveBeenCalled();
  });
  it('requires configured facility roles', async () => {
    await expect(setup({ roleMissing: true }).service.invite(scope, dto, source)).rejects.toMatchObject({ code: 'ROLE_NOT_CONFIGURED' });
  });
  it('replaces pending invitations only for an active, exclusively scoped member', async () => {
    const { service, tokens } = setup({ target: record({ user: { id: 'target-user', name: 'Staff', email: 'staff@example.test', status: 'INVITED' } }), others: 0 });
    await service.resend(scope, 'target-membership', source);
    expect(tokens.issueInvitation).toHaveBeenCalledTimes(1);
  });
  it.each([{ active: false }, { user: { id: 'target-user', name: 'Staff', email: 'staff@example.test', status: 'ACTIVE' } }])('blocks invitation for non-pending/inactive member: %j', async (overrides) => {
    await expect(setup({ target: record(overrides) }).service.resend(scope, 'target-membership', source)).rejects.toMatchObject({ code: 'NOT_INVITED' });
  });
  it('does not invalidate another scope invitation when the pending account is shared', async () => {
    const { service, tokens } = setup({ target: record({ user: { id: 'target-user', name: 'Staff', email: 'staff@example.test', status: 'INVITED' } }), others: 1 });
    await expect(service.resend(scope, 'target-membership', source)).rejects.toMatchObject({ code: 'SHARED_INVITATION' });
    expect(tokens.issueInvitation).not.toHaveBeenCalled();
  });
});

describe('clinic staff access protection', () => {
  it('rechecks the actor membership, active account and permission inside the transaction', async () => {
    const { service, prisma } = setup({ actor: null });
    await expect(service.updateRole(scope, 'target-membership', { roleCode: 'CLINIC_OWNER_ADMIN' }, source)).rejects.toMatchObject({ code: 'FORBIDDEN' });
    expect(prisma.membership.findFirst).toHaveBeenCalledWith({ where: expect.objectContaining({ id: scope.membershipId, userId: 'actor-user', facilityId: scope.facilityId, active: true, user: { status: 'ACTIVE' } }), select: { role: { select: { code: true } } } });
    expect(prisma.membership.update).not.toHaveBeenCalled();
  });
  it('rejects a missing actor', async () => {
    await expect(setup().service.updateRole(scope, 'target-membership', { roleCode: 'CLINIC_STAFF' }, { ...source, actorId: null })).rejects.toMatchObject({ code: 'FORBIDDEN' });
  });
  it('prevents a non-owner manager from granting or editing owner access', async () => {
    await expect(setup({ actor: 'CLINIC_STAFF' }).service.updateRole(scope, 'target-membership', { roleCode: 'CLINIC_OWNER_ADMIN' }, source)).rejects.toMatchObject({ code: 'FORBIDDEN' });
    const target = record({ role: { code: 'CLINIC_OWNER_ADMIN', name: 'Owner', permissions: [] } });
    await expect(setup({ actor: 'CLINIC_STAFF', target }).service.access(scope, 'target-membership', { action: 'DISABLE', reason: 'Reason test' }, source)).rejects.toMatchObject({ code: 'FORBIDDEN' });
  });
  it('blocks changing any of the caller own roles or accesses', async () => {
    const { service } = setup({ target: record({ user: { id: 'actor-user', name: 'Actor', email: 'actor@example.test', status: 'ACTIVE' } }) });
    await expect(service.updateRole(scope, 'target-membership', { roleCode: 'CLINIC_OWNER_ADMIN' }, source)).rejects.toMatchObject({ code: 'SELF_ACCESS_CHANGE' });
    await expect(service.access(scope, 'target-membership', { action: 'DISABLE', reason: 'Reason test' }, source)).rejects.toMatchObject({ code: 'SELF_ACCESS_CHANGE' });
  });
  it('protects the last owner with an ACTIVE global account in this clinic', async () => {
    const { service, prisma } = setup({ target: record({ role: { code: 'CLINIC_OWNER_ADMIN', name: 'Owner', permissions: [] } }), others: 0 });
    await expect(service.updateRole(scope, 'target-membership', { roleCode: 'CLINIC_STAFF' }, source)).rejects.toMatchObject({ code: 'LAST_CLINIC_OWNER' });
    await expect(service.access(scope, 'target-membership', { action: 'DISABLE', reason: 'Reason test' }, source)).rejects.toMatchObject({ code: 'LAST_CLINIC_OWNER' });
    expect(prisma.membership.count).toHaveBeenCalledWith({ where: expect.objectContaining({ facilityId: 'clinic-a', user: { status: 'ACTIVE' }, role: { code: 'CLINIC_OWNER_ADMIN' }, active: true }) });
  });
  it('changes only the membership role, with transactional audit', async () => {
    const { service, prisma, audit } = setup();
    await service.updateRole(scope, 'target-membership', { roleCode: 'CLINIC_OWNER_ADMIN' }, source);
    expect(prisma.membership.update).toHaveBeenCalledWith({ where: { id: 'target-membership' }, data: { roleId: 'role-id' }, select: staffSelect });
    expect(prisma.user.update).not.toHaveBeenCalled();
    expect(prisma.refreshToken.updateMany).not.toHaveBeenCalled();
    expect(audit.record).toHaveBeenCalledWith(source, expect.objectContaining({ event: 'CLINIC_STAFF_ROLE_CHANGED', facilityId: 'clinic-a' }), prisma);
  });
  it('disables only clinic access without changing global status or other sessions', async () => {
    const { service, prisma, audit } = setup();
    await service.access(scope, 'target-membership', { action: 'DISABLE', reason: 'Kontrak berakhir' }, source);
    expect(prisma.membership.update).toHaveBeenCalledWith({ where: { id: 'target-membership' }, data: { active: false }, select: staffSelect });
    expect(prisma.user.update).not.toHaveBeenCalled();
    expect(prisma.refreshToken.updateMany).not.toHaveBeenCalled();
    expect(audit.record).toHaveBeenCalledWith(source, expect.objectContaining({ after: { active: false, reason: 'Kontrak berakhir' } }), prisma);
  });
  it.each(['DISABLED', 'SUSPENDED'])('does not reactivate globally %s accounts', async (status) => {
    const { service } = setup({ target: record({ active: false, user: { id: 'target-user', name: 'Staff', email: 'staff@example.test', status } }) });
    await expect(service.access(scope, 'target-membership', { action: 'ENABLE', reason: 'Reason test' }, source)).rejects.toMatchObject({ code: 'ACCOUNT_UNAVAILABLE' });
  });
  it('re-enables pending membership with a fresh queued invitation, not an ACTIVE global account', async () => {
    const { service, tokens, prisma } = setup({ target: record({ active: false, user: { id: 'target-user', name: 'Staff', email: 'staff@example.test', status: 'INVITED' } }), others: 0 });
    await service.access(scope, 'target-membership', { action: 'ENABLE', reason: 'Reason test' }, source);
    expect(tokens.issueInvitation).toHaveBeenCalledTimes(1);
    expect(prisma.user.update).not.toHaveBeenCalled();
  });
  it('revokes pending invitations on disable only when no other active access exists', async () => {
    const target = record({ user: { id: 'target-user', name: 'Staff', email: 'staff@example.test', status: 'INVITED' } });
    const exclusive = setup({ target, others: 0 });
    await exclusive.service.access(scope, 'target-membership', { action: 'DISABLE', reason: 'Reason test' }, source);
    expect(exclusive.prisma.passwordResetToken.updateMany).toHaveBeenCalledWith({ where: { userId: 'target-user', purpose: 'INVITATION', usedAt: null }, data: { usedAt: expect.any(Date) } });
    const shared = setup({ target, others: 1 });
    await shared.service.access(scope, 'target-membership', { action: 'DISABLE', reason: 'Reason test' }, source);
    expect(shared.prisma.passwordResetToken.updateMany).not.toHaveBeenCalled();
  });
  it('rejects unchanged role and access', async () => {
    const { service } = setup();
    await expect(service.updateRole(scope, 'target-membership', { roleCode: 'CLINIC_STAFF' }, source)).rejects.toMatchObject({ code: 'ROLE_UNCHANGED' });
    await expect(service.access(scope, 'target-membership', { action: 'ENABLE', reason: 'Reason test' }, source)).rejects.toMatchObject({ code: 'STATUS_UNCHANGED' });
  });
  it('uses serializable transactions with bounded conflict retries', async () => {
    const { service, prisma } = setup();
    const conflict = new Prisma.PrismaClientKnownRequestError('conflict', { code: 'P2034', clientVersion: 'test' });
    prisma.$transaction.mockRejectedValueOnce(conflict);
    await service.updateRole(scope, 'target-membership', { roleCode: 'CLINIC_OWNER_ADMIN' }, source);
    expect(prisma.$transaction).toHaveBeenCalledTimes(2);
    expect(prisma.$transaction).toHaveBeenCalledWith(expect.any(Function), { isolationLevel: 'Serializable' });
    prisma.$transaction.mockReset().mockRejectedValue(conflict);
    await expect(service.updateRole(scope, 'target-membership', { roleCode: 'CLINIC_OWNER_ADMIN' }, source)).rejects.toMatchObject({ code: 'CONCURRENT_CHANGE', status: 409 });
    expect(prisma.$transaction).toHaveBeenCalledTimes(3);
  });
});

describe('staff route and input contracts', () => {
  it.each(['list', 'detail', 'roles'] as const)('%s requires staff read in FACILITY scope', (method) => {
    expect(Reflect.getMetadata(ACCESS_KEY, StaffController.prototype[method])).toEqual({ kind: 'facility', permissions: ['staff:read'] });
  });
  it.each(['invite', 'update', 'access', 'resend'] as const)('%s requires staff manage in FACILITY scope', (method) => {
    expect(Reflect.getMetadata(ACCESS_KEY, StaffController.prototype[method])).toEqual({ kind: 'facility', permissions: ['staff:manage'] });
  });
  it('normalizes new account identity and rejects platform role assignment', async () => {
    const dto = plainToInstance(InviteStaffDto, { name: ' Staff ', email: ' STAFF@EXAMPLE.TEST ', roleCode: 'PLATFORM_SUPER_ADMIN' });
    expect(dto.name).toBe('Staff'); expect(dto.email).toBe('staff@example.test');
    expect((await validate(dto)).map((error) => error.property)).toEqual(['roleCode']);
  });
  it('forbids injected facility/user/account fields and invalid access actions', async () => {
    const dto = plainToInstance(UpdateStaffRoleDto, { roleCode: 'CLINIC_STAFF', facilityId: 'clinic-b', userId: 'other-user', status: 'ACTIVE' });
    expect((await validate(dto, { whitelist: true, forbidNonWhitelisted: true })).map((error) => error.property).sort()).toEqual(['facilityId', 'status', 'userId']);
    expect((await validate(plainToInstance(StaffAccessDto, { action: 'SUSPEND', reason: ' ' }))).length).toBe(2);
    expect((await validate(plainToInstance(StaffQueryDto, { access: 'INVITED' }))).length).toBe(1);
  });
});
