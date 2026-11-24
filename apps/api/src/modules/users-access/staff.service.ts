import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import type { FacilityScope } from '../../common/access/auth-context';
import { paginate, skipTake } from '../../common/dto/pagination.dto';
import { AppError } from '../../common/errors/app-error';
import { PrismaService, type Db } from '../../prisma/prisma.service';
import { AuditService, type AuditSource } from '../audit/audit.service';
import { AccountTokensService } from '../auth/account-tokens.service';
import { CLINIC_ROLES, type InviteStaffDto, type StaffAccessDto, type StaffQueryDto, type UpdateStaffRoleDto } from './staff.dto';

const OWNER = 'CLINIC_OWNER_ADMIN';
const roleSelect = { code: true, name: true, permissions: { select: { permission: { select: { code: true } } } } } satisfies Prisma.RoleSelect;
export const staffSelect = {
  id: true, facilityId: true, active: true, createdAt: true,
  user: { select: { id: true, name: true, email: true, status: true } },
  role: { select: roleSelect },
} satisfies Prisma.MembershipSelect;
type StaffRecord = Prisma.MembershipGetPayload<{ select: typeof staffSelect }>;
const presentRole = (role: Prisma.RoleGetPayload<{ select: typeof roleSelect }>) => ({ ...role, permissions: role.permissions.map((entry) => entry.permission.code) });
const presentStaff = (record: StaffRecord) => ({ ...record, role: presentRole(record.role) });

@Injectable()
export class StaffService {
  constructor(private readonly prisma: PrismaService, private readonly audit: AuditService, private readonly tokens: AccountTokensService) {}

  async roles() {
    const roles = await this.prisma.role.findMany({ where: { scope: 'FACILITY', code: { in: [...CLINIC_ROLES] } }, select: roleSelect, orderBy: { code: 'asc' } });
    return roles.map(presentRole);
  }

  async list(scope: FacilityScope, query: StaffQueryDto) {
    const where: Prisma.MembershipWhereInput = {
      scopeType: 'FACILITY', facilityId: scope.facilityId,
      ...(query.access ? { active: query.access === 'ACTIVE' } : {}),
      ...(query.roleCode ? { role: { code: query.roleCode } } : {}),
      ...(query.search ? { user: { OR: [{ name: { contains: query.search, mode: 'insensitive' } }, { email: { contains: query.search, mode: 'insensitive' } }] } } : {}),
    };
    const [items, total] = await Promise.all([
      this.prisma.membership.findMany({ where, select: staffSelect, orderBy: [{ createdAt: query.sortOrder }, { id: query.sortOrder }], ...skipTake(query) }),
      this.prisma.membership.count({ where }),
    ]);
    return paginate(items.map(presentStaff), total, query);
  }

  async detail(scope: FacilityScope, id: string, db: Db = this.prisma) {
    const record = await db.membership.findFirst({ where: { id, facilityId: scope.facilityId, scopeType: 'FACILITY' }, select: staffSelect });
    if (!record) throw AppError.notFound();
    return presentStaff(record);
  }

  async invite(scope: FacilityScope, dto: InviteStaffDto, source: AuditSource) {
    return this.write(async (tx) => {
      const actor = await this.actor(tx, scope, source);
      this.protectOwner(actor, undefined, dto.roleCode);
      if (await tx.user.findUnique({ where: { email: dto.email }, select: { id: true } })) {
        throw AppError.conflict('DUPLICATE', 'Email sudah terdaftar. Gunakan email baru; akun existing tidak otomatis diberi akses klinik.', { fields: { email: ['Email sudah terdaftar.'] } });
      }
      const role = await this.role(tx, dto.roleCode);
      const user = await tx.user.create({ data: { name: dto.name, email: dto.email, status: 'INVITED' }, select: { id: true, name: true, email: true } });
      const created = await tx.membership.create({ data: { userId: user.id, scopeType: 'FACILITY', facilityId: scope.facilityId, roleId: role.id }, select: staffSelect });
      await this.issue(tx, scope.facilityId, user);
      const after = presentStaff(created);
      await this.audit.record(source, { event: 'CLINIC_STAFF_INVITED', entityType: 'Membership', entityId: created.id, facilityId: scope.facilityId, after }, tx);
      return after;
    });
  }

  async updateRole(scope: FacilityScope, id: string, dto: UpdateStaffRoleDto, source: AuditSource) {
    return this.write(async (tx) => {
      const actor = await this.actor(tx, scope, source);
      const before = await this.detail(scope, id, tx);
      this.protectOwner(actor, before.role.code, dto.roleCode);
      if (before.user.id === source.actorId) throw AppError.conflict('SELF_ACCESS_CHANGE', 'Role akun sendiri tidak dapat diubah.');
      if (before.role.code === dto.roleCode) throw AppError.conflict('ROLE_UNCHANGED', 'Role staf tidak berubah.');
      await this.keepOwner(tx, scope.facilityId, before, dto.roleCode === OWNER);
      const role = await this.role(tx, dto.roleCode);
      const after = presentStaff(await tx.membership.update({ where: { id }, data: { roleId: role.id }, select: staffSelect }));
      await this.audit.record(source, { event: 'CLINIC_STAFF_ROLE_CHANGED', entityType: 'Membership', entityId: id, facilityId: scope.facilityId, before, after }, tx);
      return after;
    });
  }

  async access(scope: FacilityScope, id: string, dto: StaffAccessDto, source: AuditSource) {
    return this.write(async (tx) => {
      const actor = await this.actor(tx, scope, source);
      const before = await this.detail(scope, id, tx);
      this.protectOwner(actor, before.role.code);
      if (before.user.id === source.actorId) throw AppError.conflict('SELF_ACCESS_CHANGE', 'Akses akun sendiri tidak dapat diubah.');
      const active = dto.action === 'ENABLE';
      if (before.active === active) throw AppError.conflict('STATUS_UNCHANGED', 'Akses staf tidak berubah.');
      if (active && !['ACTIVE', 'INVITED'].includes(before.user.status)) throw AppError.conflict('ACCOUNT_UNAVAILABLE', 'Akun dinonaktifkan secara global. Hubungi admin platform.');
      await this.keepOwner(tx, scope.facilityId, before, active);
      const after = presentStaff(await tx.membership.update({ where: { id }, data: { active }, select: staffSelect }));
      // Never change global user status or another clinic's membership/session.
      if (before.user.status === 'INVITED') {
        const otherAccess = await this.otherAccess(tx, before.user.id, id);
        if (!otherAccess) {
          if (active) await this.issue(tx, scope.facilityId, before.user);
          else await tx.passwordResetToken.updateMany({ where: { userId: before.user.id, purpose: 'INVITATION', usedAt: null }, data: { usedAt: new Date() } });
        }
      }
      await this.audit.record(source, { event: 'CLINIC_STAFF_ACCESS_CHANGED', entityType: 'Membership', entityId: id, facilityId: scope.facilityId, before: { active: before.active }, after: { active, reason: dto.reason } }, tx);
      return after;
    });
  }

  async resend(scope: FacilityScope, id: string, source: AuditSource) {
    await this.write(async (tx) => {
      const actor = await this.actor(tx, scope, source);
      const staff = await this.detail(scope, id, tx);
      this.protectOwner(actor, staff.role.code);
      if (!staff.active || staff.user.status !== 'INVITED') throw AppError.conflict('NOT_INVITED', 'Undangan hanya untuk staf dengan akses aktif yang belum mengaktifkan akun.');
      if (await this.otherAccess(tx, staff.user.id, id)) throw AppError.conflict('SHARED_INVITATION', 'Akun memiliki akses lain. Hubungi admin platform untuk undangan akun bersama.');
      await this.issue(tx, scope.facilityId, staff.user);
      await this.audit.record(source, { event: 'CLINIC_STAFF_REINVITED', entityType: 'Membership', entityId: id, facilityId: scope.facilityId }, tx);
    });
  }

  private async actor(tx: Db, scope: FacilityScope, source: AuditSource) {
    if (!source.actorId) throw AppError.forbidden();
    const actor = await tx.membership.findFirst({ where: {
      id: scope.membershipId, userId: source.actorId, scopeType: 'FACILITY', facilityId: scope.facilityId, active: true,
      user: { status: 'ACTIVE' }, role: { scope: 'FACILITY', permissions: { some: { permission: { code: 'staff:manage' } } } },
    }, select: { role: { select: { code: true } } } });
    if (!actor) throw AppError.forbidden();
    return actor.role.code;
  }

  private protectOwner(actorRole: string, currentRole?: string, nextRole?: string) {
    if ((currentRole === OWNER || nextRole === OWNER) && actorRole !== OWNER) throw AppError.forbidden('Hanya owner/admin klinik yang dapat mengelola role owner/admin.');
  }

  private async keepOwner(tx: Db, facilityId: string, before: Awaited<ReturnType<StaffService['detail']>>, retained: boolean) {
    if (retained || !before.active || before.user.status !== 'ACTIVE' || before.role.code !== OWNER) return;
    const others = await tx.membership.count({ where: { id: { not: before.id }, userId: { not: before.user.id }, facilityId, scopeType: 'FACILITY', active: true, role: { code: OWNER }, user: { status: 'ACTIVE' } } });
    if (!others) throw AppError.conflict('LAST_CLINIC_OWNER', 'Minimal satu owner/admin dengan akun aktif harus tetap tersedia di klinik ini.');
  }

  private async role(tx: Db, code: string) {
    if (!(CLINIC_ROLES as readonly string[]).includes(code)) throw AppError.forbidden();
    const role = await tx.role.findFirst({ where: { code, scope: 'FACILITY' }, select: { id: true } });
    if (!role) throw AppError.conflict('ROLE_NOT_CONFIGURED', 'Role klinik belum dikonfigurasi. Jalankan seed.');
    return role;
  }

  private otherAccess(tx: Db, userId: string, membershipId: string) {
    return tx.membership.count({ where: { userId, id: { not: membershipId }, active: true } });
  }

  private async issue(tx: Db, facilityId: string, user: { id: string; name: string; email: string }) {
    const facility = await tx.facility.findUniqueOrThrow({ where: { id: facilityId }, select: { displayName: true } });
    await this.tokens.issueInvitation(tx, user, { facilityName: facility.displayName });
  }

  private async write<T>(run: (tx: Db) => Promise<T>): Promise<T> {
    for (let attempt = 0; ; attempt++) {
      try { return await this.prisma.$transaction(run, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable }); }
      catch (error) {
        if (error instanceof Prisma.PrismaClientKnownRequestError) {
          if (error.code === 'P2034') {
            if (attempt < 2) continue;
            throw AppError.conflict('CONCURRENT_CHANGE', 'Data berubah bersamaan. Muat ulang dan coba lagi.');
          }
          if (error.code === 'P2002') throw AppError.conflict('DUPLICATE', 'Email atau akses staf sudah terdaftar.', { fields: { email: ['Email atau akses staf sudah terdaftar.'] } });
        }
        throw error;
      }
    }
  }
}
