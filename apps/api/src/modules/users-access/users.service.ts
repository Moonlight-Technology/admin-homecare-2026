import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { paginate, skipTake } from '../../common/dto/pagination.dto';
import { AppError } from '../../common/errors/app-error';
import { PrismaService, type Db } from '../../prisma/prisma.service';
import { AuditService, type AuditSource } from '../audit/audit.service';
import { AccountTokensService } from '../auth/account-tokens.service';
import { PLATFORM_ROLES, type InvitePlatformUserDto, type PlatformUserStatusDto, type UpdatePlatformUserDto, type UserQueryDto } from './users.dto';

const SUPER = 'PLATFORM_SUPER_ADMIN';
const membership = { scopeType: 'PLATFORM' as const, active: true };
/** Explicit projection: password hashes and account/session tokens never leave this service. */
export const platformUserSelect = {
  id: true, name: true, email: true, status: true, createdAt: true, lastLoginAt: true,
  memberships: { where: membership, select: { id: true, role: { select: { code: true, name: true } } } },
} satisfies Prisma.UserSelect;
type UserView = Prisma.UserGetPayload<{ select: typeof platformUserSelect }>;

@Injectable()
export class UsersService {
  constructor(private readonly prisma: PrismaService, private readonly audit: AuditService, private readonly tokens: AccountTokensService) {}

  async list(query: UserQueryDto) {
    const where: Prisma.UserWhereInput = {
      memberships: { some: { ...membership, ...(query.roleCode ? { role: { code: query.roleCode } } : {}) } },
      ...(query.status ? { status: query.status } : {}),
      ...(query.search ? { OR: [{ name: { contains: query.search, mode: 'insensitive' } }, { email: { contains: query.search, mode: 'insensitive' } }] } : {}),
    };
    const [items, total] = await Promise.all([
      this.prisma.user.findMany({ where, select: platformUserSelect, orderBy: [{ createdAt: query.sortOrder }, { id: query.sortOrder }], ...skipTake(query) }),
      this.prisma.user.count({ where }),
    ]);
    return paginate(items, total, query);
  }

  async detail(id: string, db: Db = this.prisma): Promise<UserView> {
    const user = await db.user.findFirst({ where: { id, memberships: { some: membership } }, select: platformUserSelect });
    if (!user) throw AppError.notFound();
    return user;
  }

  async invite(dto: InvitePlatformUserDto, source: AuditSource) {
    return this.write(async (tx) => {
      const actor = await this.actor(tx, source);
      this.protectSuper(actor, null, dto.roleCode);
      if (await tx.user.findUnique({ where: { email: dto.email }, select: { id: true } })) {
        throw AppError.conflict('DUPLICATE', 'Email sudah terdaftar. Gunakan email lain.', { fields: { email: ['Email sudah terdaftar.'] } });
      }
      const role = await this.role(tx, dto.roleCode);
      const user = await tx.user.create({ data: { name: dto.name, email: dto.email, status: 'INVITED', memberships: { create: { scopeType: 'PLATFORM', roleId: role.id } } }, select: platformUserSelect });
      await this.tokens.issueInvitation(tx, user, { facilityName: 'Nakes Platform' });
      await this.audit.record(source, { event: 'PLATFORM_USER_INVITED', entityType: 'User', entityId: user.id, after: user }, tx);
      return user;
    });
  }

  async update(id: string, dto: UpdatePlatformUserDto, source: AuditSource) {
    return this.write(async (tx) => {
      const actor = await this.actor(tx, source);
      const before = await this.detail(id, tx);
      this.protectSuper(actor, before, dto.roleCode);
      const roleChanged = dto.roleCode !== undefined && (before.memberships.length !== 1 || before.memberships[0]?.role.code !== dto.roleCode);
      if (roleChanged) {
        if (id === source.actorId) throw AppError.conflict('SELF_ACCESS_CHANGE', 'Role akun sendiri tidak dapat diubah.');
        await this.keepSuper(tx, before, dto.roleCode === SUPER);
        const role = await this.role(tx, dto.roleCode!);
        // Retain membership history; only platform memberships change, never clinic memberships.
        await tx.membership.updateMany({ where: { userId: id, ...membership }, data: { active: false } });
        await tx.membership.create({ data: { userId: id, scopeType: 'PLATFORM', roleId: role.id } });
        await this.revoke(tx, id);
      }
      await tx.user.update({ where: { id }, data: { name: dto.name } });
      const after = await this.detail(id, tx);
      await this.audit.record(source, { event: 'PLATFORM_USER_UPDATED', entityType: 'User', entityId: id, before, after }, tx);
      return after;
    });
  }

  async status(id: string, dto: PlatformUserStatusDto, source: AuditSource) {
    return this.write(async (tx) => {
      const actor = await this.actor(tx, source);
      const before = await this.detail(id, tx);
      this.protectSuper(actor, before);
      if (id === source.actorId) throw AppError.conflict('SELF_ACCESS_CHANGE', 'Status akun sendiri tidak dapat diubah.');
      const credentials = await tx.user.findUniqueOrThrow({ where: { id }, select: { passwordHash: true } });
      const status = dto.action === 'ENABLE' ? (credentials.passwordHash ? 'ACTIVE' : 'INVITED') : dto.action === 'SUSPEND' ? 'SUSPENDED' : 'DISABLED';
      if (before.status === status) throw AppError.conflict('STATUS_UNCHANGED', 'Status pengguna tidak berubah.');
      await this.keepSuper(tx, before, status === 'ACTIVE');
      await tx.user.update({ where: { id }, data: { status } });
      await this.revoke(tx, id);
      await tx.passwordResetToken.updateMany({ where: { userId: id, usedAt: null }, data: { usedAt: new Date() } });
      if (status === 'INVITED') await this.tokens.issueInvitation(tx, before, { facilityName: 'Nakes Platform' });
      const after = await this.detail(id, tx);
      await this.audit.record(source, { event: 'PLATFORM_USER_STATUS_CHANGED', entityType: 'User', entityId: id, before: { status: before.status }, after: { status, reason: dto.reason } }, tx);
      return after;
    });
  }

  async resendInvitation(id: string, source: AuditSource) {
    await this.write(async (tx) => {
      const actor = await this.actor(tx, source);
      const user = await this.detail(id, tx);
      this.protectSuper(actor, user);
      if (user.status !== 'INVITED') throw AppError.conflict('NOT_INVITED', 'Undangan hanya dapat dikirim ulang untuk akun yang belum diaktivasi.');
      await this.tokens.issueInvitation(tx, user, { facilityName: 'Nakes Platform' });
      await this.audit.record(source, { event: 'PLATFORM_USER_REINVITED', entityType: 'User', entityId: id }, tx);
    });
  }

  private async actor(tx: Db, source: AuditSource) {
    if (!source.actorId) throw AppError.forbidden();
    const actor = await tx.user.findFirst({ where: { id: source.actorId, status: 'ACTIVE', memberships: { some: { ...membership, role: { permissions: { some: { permission: { code: 'platform-user:manage' } } } } } } }, select: platformUserSelect });
    if (!actor) throw AppError.forbidden();
    return actor;
  }

  private protectSuper(actor: UserView, target: UserView | null, nextRole?: string) {
    if ((nextRole === SUPER || target?.memberships.some((entry) => entry.role.code === SUPER)) && !actor.memberships.some((entry) => entry.role.code === SUPER)) {
      throw AppError.forbidden('Hanya super admin yang dapat mengelola akun super admin.');
    }
  }

  private async keepSuper(tx: Db, user: UserView, retainsAccess: boolean) {
    if (retainsAccess || user.status !== 'ACTIVE' || !user.memberships.some((entry) => entry.role.code === SUPER)) return;
    const others = await tx.user.count({ where: { id: { not: user.id }, status: 'ACTIVE', memberships: { some: { ...membership, role: { code: SUPER } } } } });
    if (!others) throw AppError.conflict('LAST_SUPER_ADMIN', 'Minimal satu super admin aktif harus tetap tersedia.');
  }

  private async role(tx: Db, code: string) {
    if (!(PLATFORM_ROLES as readonly string[]).includes(code)) throw AppError.forbidden();
    const role = await tx.role.findFirst({ where: { code, scope: 'PLATFORM' }, select: { id: true } });
    if (!role) throw AppError.conflict('ROLE_NOT_CONFIGURED', 'Role platform belum dikonfigurasi. Jalankan seed.');
    return role;
  }

  private revoke(tx: Db, userId: string) {
    return tx.refreshToken.updateMany({ where: { userId, revokedAt: null }, data: { revokedAt: new Date() } });
  }

  /** Serializable retries protect last-admin checks against concurrent status/role changes. */
  private async write<T>(run: (tx: Db) => Promise<T>): Promise<T> {
    for (let attempt = 0; ; attempt++) {
      try {
        return await this.prisma.$transaction(run, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
      } catch (error) {
        if (error instanceof Prisma.PrismaClientKnownRequestError) {
          if (error.code === 'P2034') {
            if (attempt < 2) continue;
            throw AppError.conflict('CONCURRENT_CHANGE', 'Data berubah bersamaan. Muat ulang dan coba lagi.');
          }
          if (error.code === 'P2002') throw AppError.conflict('DUPLICATE', 'Email sudah terdaftar.', { fields: { email: ['Email sudah terdaftar.'] } });
        }
        throw error;
      }
    }
  }
}
