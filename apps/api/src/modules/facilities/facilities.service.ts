import { Injectable } from '@nestjs/common';
import { Prisma, type VerificationStatus } from '@prisma/client';
import { AppError } from '../../common/errors/app-error';
import { paginate, skipTake } from '../../common/dto/pagination.dto';
import { PrismaService, type Db } from '../../prisma/prisma.service';
import { AuditService, type AuditSource } from '../audit/audit.service';
import { AccountTokensService } from '../auth/account-tokens.service';
import { PasswordService } from '../auth/password.service';
import type { AdminCreateFacilityDto, ClinicRegistrationDto, FacilityProfileDto, FacilityQueryDto, FacilityStatusDto, UpdateFacilityProfileDto } from './dto/facility.dto';

const OWNER_ROLE = 'CLINIC_OWNER_ADMIN';

/** The clinic cannot edit while reviewers are looking at a submitted version (spec §5.1). */
export const LOCKED_FOR_REVIEW: VerificationStatus[] = ['SUBMITTED', 'UNDER_REVIEW'];
/** Once verified, the legal identity can only change through the platform (it was what was verified). */
export const VERIFIED_IDENTITY_FIELDS = ['legalName', 'facilityTypeId', 'clinicClassId'] as const;

/**
 * Fields the clinic must fill before submitting for verification. Working assumption until operations confirms
 * the registration field list (spec §15).
 */
export const REQUIRED_FOR_SUBMISSION = ['displayName', 'legalName', 'facilityTypeId', 'phone', 'addressLine'] as const;

export const facilityDetailInclude = {
  facilityType: { select: { id: true, code: true, name: true } },
  clinicClass: { select: { id: true, code: true, name: true } },
  capabilities: { select: { capability: { select: { id: true, code: true, name: true } } } },
  provider: { select: { id: true, status: true } },
  memberships: {
    where: { active: true, role: { code: OWNER_ROLE } },
    select: { user: { select: { id: true, name: true, email: true, status: true } } },
    take: 1,
  },
} satisfies Prisma.FacilityInclude;

type FacilityWithDetail = Prisma.FacilityGetPayload<{ include: typeof facilityDetailInclude }>;

/** API shape: flattened capabilities and owner, numbers instead of Decimal coordinates. */
export function presentFacility(facility: FacilityWithDetail) {
  const { capabilities, memberships, latitude, longitude, ...rest } = facility;
  return {
    ...rest,
    latitude: latitude === null ? null : Number(latitude),
    longitude: longitude === null ? null : Number(longitude),
    capabilities: capabilities.map((entry) => entry.capability),
    owner: memberships[0]?.user ?? null,
  };
}

/** Field errors for a profile that is not complete enough to submit (AC-FAC-02). */
export function missingProfileFields(facility: { [key: string]: unknown; capabilities: unknown[] }): Record<string, string[]> {
  const errors: Record<string, string[]> = {};
  for (const field of REQUIRED_FOR_SUBMISSION) {
    if (facility[field] === null || facility[field] === undefined || facility[field] === '') errors[`profile.${field}`] = [`${field} is required before submitting`];
  }
  if (!facility.capabilities.length) errors['profile.capabilityIds'] = ['choose at least one capability'];
  return errors;
}

@Injectable()
export class FacilitiesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly passwords: PasswordService,
    private readonly accountTokens: AccountTokensService,
  ) {}

  /** `POST /clinic-registration`: owner account, facility (DRAFT, INACTIVE), its provider, and an owner membership (AC-FAC-01). */
  async register(dto: ClinicRegistrationDto, source: AuditSource) {
    await this.assertReferences(dto.facility, 'facility.');
    await this.assertEmailFree(dto.owner.email, 'owner.email');
    const passwordHash = await this.passwords.hash(dto.owner.password);
    return this.prisma.$transaction(async (tx) => {
      const user = await tx.user.create({ data: { email: dto.owner.email, name: dto.owner.name, passwordHash, status: 'ACTIVE' } });
      const facility = await this.createFacility(tx, dto.facility, { registeredVia: 'SELF', createdById: user.id });
      await this.addOwner(tx, facility.id, user.id);
      await this.audit.record({ ...source, actorId: user.id }, { event: 'FACILITY_REGISTERED', entityType: 'Facility', entityId: facility.id, facilityId: facility.id, after: { displayName: facility.displayName, ownerId: user.id } }, tx);
      return { facilityId: facility.id };
    });
  }

  /** `POST /admin/facilities`: draft facility plus an invited owner. Creation is not verification (spec §5.2). */
  async adminCreate(dto: AdminCreateFacilityDto, source: AuditSource) {
    await this.assertReferences(dto.facility, 'facility.');
    await this.assertEmailFree(dto.owner.email, 'owner.email');
    const created = await this.prisma.$transaction(async (tx) => {
      const user = await tx.user.create({ data: { email: dto.owner.email, name: dto.owner.name, status: 'INVITED' } });
      const facility = await this.createFacility(tx, dto.facility, { registeredVia: 'ADMIN', createdById: source.actorId });
      await this.addOwner(tx, facility.id, user.id);
      await this.accountTokens.issueInvitation(tx, user, { facilityName: facility.displayName });
      await this.audit.record(source, { event: 'FACILITY_CREATED_BY_ADMIN', entityType: 'Facility', entityId: facility.id, facilityId: facility.id, after: { displayName: facility.displayName, ownerEmail: user.email } }, tx);
      return facility.id;
    });
    return this.detail(created);
  }

  /** Sends a fresh invitation while the owner has not set a password yet. */
  async resendInvitation(facilityId: string, source: AuditSource) {
    const facility = await this.detail(facilityId);
    if (!facility.owner || facility.owner.status !== 'INVITED') throw AppError.conflict('OWNER_ALREADY_ACTIVE', 'The owner has already activated their account.');
    await this.prisma.$transaction(async (tx) => {
      await this.accountTokens.issueInvitation(tx, facility.owner!, { facilityName: facility.displayName });
      await this.audit.record(source, { event: 'FACILITY_OWNER_REINVITED', entityType: 'Facility', entityId: facilityId, facilityId }, tx);
    });
  }

  async list(query: FacilityQueryDto) {
    const where: Prisma.FacilityWhereInput = {
      ...(query.facilityTypeId ? { facilityTypeId: query.facilityTypeId } : {}),
      ...(query.clinicClassId ? { clinicClassId: query.clinicClassId } : {}),
      ...(query.verificationStatus ? { verificationStatus: query.verificationStatus } : {}),
      ...(query.operatingStatus ? { operatingStatus: query.operatingStatus } : {}),
      ...(query.search
        ? { OR: [{ displayName: { contains: query.search, mode: 'insensitive' } }, { legalName: { contains: query.search, mode: 'insensitive' } }, { addressLine: { contains: query.search, mode: 'insensitive' } }] }
        : {}),
    };
    const [items, total] = await Promise.all([
      this.prisma.facility.findMany({ where, include: facilityDetailInclude, orderBy: { createdAt: query.sortOrder }, ...skipTake(query) }),
      this.prisma.facility.count({ where }),
    ]);
    return paginate(items.map(presentFacility), total, query);
  }

  async detail(id: string) {
    const facility = await this.prisma.facility.findUnique({ where: { id }, include: facilityDetailInclude });
    if (!facility) throw AppError.notFound();
    return presentFacility(facility);
  }

  /**
   * Profile edits. A clinic cannot edit while its submission is under review, nor change the verified legal
   * identity; the platform can always edit, and every change is audited.
   */
  async updateProfile(id: string, dto: UpdateFacilityProfileDto, source: AuditSource, actor: 'CLINIC' | 'PLATFORM') {
    const before = await this.detail(id);
    if (actor === 'CLINIC') {
      if (LOCKED_FOR_REVIEW.includes(before.verificationStatus)) throw AppError.conflict('FACILITY_LOCKED_FOR_REVIEW', 'The profile cannot be changed while the verification is being reviewed.');
      if (before.verificationStatus === 'VERIFIED') {
        const changed = VERIFIED_IDENTITY_FIELDS.filter((field) => dto[field] !== undefined && dto[field] !== before[field === 'legalName' ? 'legalName' : field]);
        if (changed.length) throw AppError.unprocessable('VERIFIED_FIELDS_LOCKED', 'Verified legal identity can only be changed by the platform.', { fields: Object.fromEntries(changed.map((field) => [field, ['locked after verification']])) });
      }
    }
    await this.assertReferences(dto);
    const { capabilityIds, ...fields } = dto;
    await this.prisma.$transaction(async (tx) => {
      await tx.facility.update({ where: { id }, data: fields });
      if (capabilityIds) {
        await tx.facilityCapability.deleteMany({ where: { facilityId: id } });
        await tx.facilityCapability.createMany({ data: capabilityIds.map((capabilityId) => ({ facilityId: id, capabilityId })) });
      }
    });
    const after = await this.detail(id);
    await this.audit.record(source, { event: 'FACILITY_PROFILE_UPDATED', entityType: 'Facility', entityId: id, facilityId: id, before, after });
    return after;
  }

  /** Activation needs a verified facility; suspension needs a reason (spec §5.1 step 7). The provider mirrors the status. */
  async changeStatus(id: string, dto: FacilityStatusDto, source: AuditSource) {
    const facility = await this.detail(id);
    if (dto.action === 'ACTIVATE' && facility.verificationStatus !== 'VERIFIED') {
      throw AppError.unprocessable('FACILITY_NOT_VERIFIED', 'Only a verified facility can be activated.');
    }
    if (dto.action === 'SUSPEND' && (dto.reason ?? '').length < 5) {
      throw AppError.unprocessable('VALIDATION_FAILED', 'A reason is required to suspend a facility.', { fields: { reason: ['reason must be at least 5 characters'] } });
    }
    const operatingStatus = dto.action === 'ACTIVATE' ? 'ACTIVE' : 'SUSPENDED';
    if (facility.operatingStatus === operatingStatus) throw AppError.conflict('STATUS_UNCHANGED', `The facility is already ${operatingStatus.toLowerCase()}.`);
    await this.prisma.$transaction(async (tx) => {
      await tx.facility.update({ where: { id }, data: { operatingStatus, statusReason: dto.reason ?? null } });
      await tx.provider.updateMany({ where: { facilityId: id }, data: { status: operatingStatus } });
      await this.audit.record(source, { event: dto.action === 'ACTIVATE' ? 'FACILITY_ACTIVATED' : 'FACILITY_SUSPENDED', entityType: 'Facility', entityId: id, facilityId: id, before: { operatingStatus: facility.operatingStatus }, after: { operatingStatus, reason: dto.reason ?? null } }, tx);
    });
    return this.detail(id);
  }

  private async createFacility(tx: Db, profile: FacilityProfileDto, meta: { registeredVia: 'SELF' | 'ADMIN'; createdById: string | null }) {
    const { capabilityIds, ...fields } = profile;
    const facility = await tx.facility.create({ data: { ...fields, registeredVia: meta.registeredVia, createdById: meta.createdById, verificationStatus: 'DRAFT', operatingStatus: 'INACTIVE' } });
    if (capabilityIds.length) await tx.facilityCapability.createMany({ data: capabilityIds.map((capabilityId) => ({ facilityId: facility.id, capabilityId })) });
    await tx.provider.create({ data: { type: 'FACILITY', facilityId: facility.id, status: 'INACTIVE' } });
    return facility;
  }

  private async addOwner(tx: Db, facilityId: string, userId: string) {
    const role = await tx.role.findUnique({ where: { code: OWNER_ROLE }, select: { id: true } });
    if (!role) throw new Error(`Role ${OWNER_ROLE} is missing; run the seed.`);
    await tx.membership.create({ data: { userId, facilityId, scopeType: 'FACILITY', roleId: role.id } });
  }

  private async assertEmailFree(email: string, field: string) {
    const existing = await this.prisma.user.findUnique({ where: { email }, select: { id: true } });
    if (existing) throw AppError.conflict('DUPLICATE', 'This email is already registered. Sign in or use another email.', { fields: { [field]: ['email is already registered'] } });
  }

  /** Every chosen master value must exist and be active; field errors name the offending input. */
  private async assertReferences(profile: Partial<Pick<FacilityProfileDto, 'facilityTypeId' | 'clinicClassId' | 'capabilityIds' | 'regionCode'>>, prefix = '') {
    const errors: Record<string, string[]> = {};
    const live = { active: true, deletedAt: null };
    const [type, clinicClass, capabilities, region] = await Promise.all([
      profile.facilityTypeId ? this.prisma.facilityType.findFirst({ where: { id: profile.facilityTypeId, ...live }, select: { id: true } }) : null,
      profile.clinicClassId ? this.prisma.clinicClass.findFirst({ where: { id: profile.clinicClassId, ...live }, select: { id: true } }) : null,
      profile.capabilityIds?.length ? this.prisma.capability.findMany({ where: { id: { in: profile.capabilityIds }, ...live }, select: { id: true } }) : [],
      profile.regionCode ? this.prisma.region.findUnique({ where: { code: profile.regionCode }, select: { code: true } }) : null,
    ]);
    if (profile.facilityTypeId && !type) errors.facilityTypeId = ['facility type not found or inactive'];
    if (profile.clinicClassId && !clinicClass) errors.clinicClassId = ['clinic class not found or inactive'];
    if (profile.capabilityIds?.length && capabilities.length !== profile.capabilityIds.length) errors.capabilityIds = ['one or more capabilities are not found or inactive'];
    if (profile.regionCode && !region) errors.regionCode = ['region not found'];
    if (Object.keys(errors).length) throw AppError.unprocessable('INVALID_REFERENCE', 'Some selected values are not available.', { fields: Object.fromEntries(Object.entries(errors).map(([field, messages]) => [prefix + field, messages])) });
  }
}
