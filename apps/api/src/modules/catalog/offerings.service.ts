import { Injectable } from '@nestjs/common';
import { Prisma, type OfferingStatus } from '@prisma/client';
import { AppError } from '../../common/errors/app-error';
import { paginate, skipTake } from '../../common/dto/pagination.dto';
import { PrismaService, type Db } from '../../prisma/prisma.service';
import { AuditService, type AuditSource } from '../audit/audit.service';
import { FULFILLMENT_MODES, type CreateOfferingDto, type OfferingModeDto, type OfferingQueryDto, type UpdateOfferingDto } from './dto/offering.dto';

/** Statuses from which an offering can be published. */
const PUBLISHABLE: OfferingStatus[] = ['DRAFT', 'UNPUBLISHED'];

export const offeringInclude = {
  masterService: { select: { id: true, code: true, name: true, active: true, deletedAt: true, category: { select: { id: true, slug: true, name: true } } } },
  modes: { orderBy: { mode: 'asc' }, select: { id: true, mode: true, enabled: true, priceOverride: true, visitFee: true } },
} satisfies Prisma.ServiceOfferingInclude;

type OfferingWithDetail = Prisma.ServiceOfferingGetPayload<{ include: typeof offeringInclude }>;
type FacilityState = { verificationStatus: string; operatingStatus: string; providerStatus: string | null };

/**
 * Why an offering cannot be public right now (spec §5.3 step 3, AC-FAC-05): the clinic must be verified and active,
 * the master service live, and at least one fulfillment mode enabled. Empty means publishable.
 */
export function publishBlockers(offering: Pick<OfferingWithDetail, 'name' | 'durationMinutes' | 'basePrice' | 'masterService' | 'modes'>, facility: FacilityState): string[] {
  const blockers: string[] = [];
  if (facility.verificationStatus !== 'VERIFIED') blockers.push('FACILITY_NOT_VERIFIED');
  if (facility.operatingStatus !== 'ACTIVE' || facility.providerStatus !== 'ACTIVE') blockers.push('FACILITY_NOT_ACTIVE');
  if (!offering.masterService.active || offering.masterService.deletedAt) blockers.push('MASTER_SERVICE_INACTIVE');
  if (!offering.modes.some((mode) => mode.enabled)) blockers.push('NO_ENABLED_MODE');
  if (!offering.name.trim() || offering.durationMinutes <= 0 || new Prisma.Decimal(offering.basePrice).isNegative()) blockers.push('INCOMPLETE');
  return blockers;
}

const BLOCKER_MESSAGES: Record<string, string> = {
  FACILITY_NOT_VERIFIED: 'Your clinic must be verified before publishing.',
  FACILITY_NOT_ACTIVE: 'Your clinic is not active (suspended or not yet activated).',
  MASTER_SERVICE_INACTIVE: 'The selected master service is no longer available.',
  NO_ENABLED_MODE: 'Enable at least one fulfillment mode.',
  INCOMPLETE: 'Complete the name, price, and duration.',
};

/** API shape: the master service without internal flags. Decimals serialise as exact strings. */
function presentOffering(offering: OfferingWithDetail, facility: FacilityState) {
  const { masterService, ...rest } = offering;
  const { deletedAt, ...service } = masterService;
  return {
    ...rest,
    masterService: { ...service, active: service.active && !deletedAt },
    publishBlockers: publishBlockers(offering, facility),
  };
}

/**
 * Clinic catalog (spec §5.3): offerings belong to the clinic's provider, resolved from the caller's membership, so
 * another clinic's offering is never reachable — it answers 404 (AC-SVC-02). Order items snapshot names and prices,
 * so editing, unpublishing or archiving never changes past orders (spec §5.3 step 4, AC-SVC-03).
 */
@Injectable()
export class OfferingsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  /** Active master services grouped by category, for the offering editor. */
  async options() {
    const categories = await this.prisma.serviceCategory.findMany({
      where: { active: true, deletedAt: null, masterServices: { some: { active: true, deletedAt: null } } },
      orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }],
      select: { id: true, slug: true, name: true, masterServices: { where: { active: true, deletedAt: null }, orderBy: { name: 'asc' }, select: { id: true, code: true, name: true, description: true } } },
    });
    return { categories };
  }

  async list(facilityId: string, query: OfferingQueryDto) {
    const { providerId, state } = await this.facility(facilityId);
    const where: Prisma.ServiceOfferingWhereInput = {
      providerId,
      ...(query.status ? { status: query.status } : { status: { not: 'ARCHIVED' } }),
      ...(query.mode ? { modes: { some: { mode: query.mode, enabled: true } } } : {}),
      ...(query.search ? { OR: [{ name: { contains: query.search, mode: 'insensitive' } }, { masterService: { name: { contains: query.search, mode: 'insensitive' } } }] } : {}),
    };
    const [items, total, counts] = await Promise.all([
      this.prisma.serviceOffering.findMany({ where, include: offeringInclude, orderBy: { updatedAt: query.sortOrder }, ...skipTake(query) }),
      this.prisma.serviceOffering.count({ where }),
      this.prisma.serviceOffering.groupBy({ by: ['status'], where: { providerId }, _count: { _all: true } }),
    ]);
    return {
      ...paginate(items.map((item) => presentOffering(item, state)), total, query),
      counts: Object.fromEntries(counts.map((row) => [row.status, row._count._all])),
      facility: state,
    };
  }

  async detail(facilityId: string, id: string) {
    const { providerId, state } = await this.facility(facilityId);
    return presentOffering(await this.owned(providerId, id), state);
  }

  /** New offerings start as drafts; publishing is a separate, checked step. */
  async create(facilityId: string, dto: CreateOfferingDto, source: AuditSource) {
    const { providerId } = await this.facility(facilityId);
    await this.assertMasterService(dto.masterServiceId);
    const modes = this.prepareModes(dto.modes);
    const id = await this.prisma.$transaction(async (tx) => {
      const offering = await tx.serviceOffering.create({
        data: {
          providerId,
          masterServiceId: dto.masterServiceId,
          name: dto.name,
          description: dto.description ?? null,
          preparationNote: dto.preparationNote ?? null,
          terms: dto.terms ?? null,
          basePrice: dto.basePrice,
          durationMinutes: dto.durationMinutes,
          status: 'DRAFT',
          modes: { create: modes },
        },
      });
      await this.audit.record(source, { event: 'OFFERING_CREATED', entityType: 'ServiceOffering', entityId: offering.id, facilityId, after: { name: offering.name, masterServiceId: offering.masterServiceId, basePrice: dto.basePrice, durationMinutes: dto.durationMinutes, modes } }, tx);
      return offering.id;
    });
    return this.detail(facilityId, id);
  }

  /**
   * Edits keep a published offering publishable (a change that would break it must unpublish first); the master
   * service can only change while the offering is a draft; archived offerings are read-only.
   */
  async update(facilityId: string, id: string, dto: UpdateOfferingDto, source: AuditSource) {
    const { providerId, state } = await this.facility(facilityId);
    const before = await this.owned(providerId, id);
    if (before.status === 'ARCHIVED') throw AppError.conflict('OFFERING_ARCHIVED', 'An archived offering cannot be changed.');
    if (dto.masterServiceId && dto.masterServiceId !== before.masterServiceId) {
      if (before.status !== 'DRAFT') throw AppError.unprocessable('MASTER_SERVICE_LOCKED', 'The master service can only be changed while the offering is a draft.', { fields: { masterServiceId: ['locked after the first publication'] } });
      await this.assertMasterService(dto.masterServiceId);
    }
    const { modes: modeInput, ...fields } = dto;
    const modes = modeInput ? this.prepareModes(modeInput) : null;

    if (before.status === 'PUBLISHED' && modes && !modes.some((mode) => mode.enabled)) {
      throw AppError.unprocessable('OFFERING_WOULD_BREAK', 'A published offering needs at least one enabled mode. Unpublish it first.', { fields: { modes: ['enable at least one mode'] } });
    }

    await this.prisma.$transaction(async (tx) => {
      await tx.serviceOffering.update({ where: { id }, data: fields });
      if (modes) await this.replaceModes(tx, id, modes);
    });
    const after = await this.owned(providerId, id);
    await this.audit.record(source, { event: 'OFFERING_UPDATED', entityType: 'ServiceOffering', entityId: id, facilityId, before: this.auditView(before), after: this.auditView(after) });
    return presentOffering(after, state);
  }

  async publish(facilityId: string, id: string, source: AuditSource) {
    const { providerId, state } = await this.facility(facilityId);
    const offering = await this.owned(providerId, id);
    if (offering.status === 'PUBLISHED') throw AppError.conflict('OFFERING_ALREADY_PUBLISHED', 'This offering is already published.');
    if (offering.status === 'ARCHIVED') throw AppError.conflict('OFFERING_ARCHIVED', 'An archived offering cannot be published.');
    const blockers = publishBlockers(offering, state);
    if (blockers.length) {
      throw AppError.unprocessable('OFFERING_NOT_PUBLISHABLE', BLOCKER_MESSAGES[blockers[0]!] ?? 'This offering cannot be published yet.', { blockers, messages: blockers.map((code) => BLOCKER_MESSAGES[code]) });
    }
    await this.transition(facilityId, id, PUBLISHABLE, { status: 'PUBLISHED', publishedAt: new Date() }, 'OFFERING_PUBLISHED', offering.status, source);
    return this.detail(facilityId, id);
  }

  async unpublish(facilityId: string, id: string, source: AuditSource) {
    const { providerId } = await this.facility(facilityId);
    const offering = await this.owned(providerId, id);
    await this.transition(facilityId, id, ['PUBLISHED'], { status: 'UNPUBLISHED' }, 'OFFERING_UNPUBLISHED', offering.status, source);
    return this.detail(facilityId, id);
  }

  /** Archiving hides an unpublished or draft offering for good; it stays referenced by past order items. */
  async archive(facilityId: string, id: string, source: AuditSource) {
    const { providerId } = await this.facility(facilityId);
    const offering = await this.owned(providerId, id);
    if (offering.status === 'PUBLISHED') throw AppError.conflict('OFFERING_PUBLISHED', 'Unpublish the offering before archiving it.');
    await this.transition(facilityId, id, PUBLISHABLE, { status: 'ARCHIVED' }, 'OFFERING_ARCHIVED', offering.status, source);
    return this.detail(facilityId, id);
  }

  /** Conditional status change so concurrent requests cannot both apply. */
  private async transition(facilityId: string, id: string, from: OfferingStatus[], data: Prisma.ServiceOfferingUpdateManyMutationInput, event: string, before: OfferingStatus, source: AuditSource) {
    await this.prisma.$transaction(async (tx) => {
      const moved = await tx.serviceOffering.updateMany({ where: { id, status: { in: from } }, data });
      if (moved.count === 0) throw AppError.conflict('OFFERING_STATE_CHANGED', 'The offering status changed; reload and try again.');
      await this.audit.record(source, { event, entityType: 'ServiceOffering', entityId: id, facilityId, before: { status: before }, after: { status: data.status } }, tx);
    });
  }

  /** The caller's facility state and provider; a facility always has one (created at registration). */
  private async facility(facilityId: string) {
    const facility = await this.prisma.facility.findUnique({ where: { id: facilityId }, select: { verificationStatus: true, operatingStatus: true, provider: { select: { id: true, status: true } } } });
    if (!facility?.provider) throw AppError.notFound();
    return { providerId: facility.provider.id, state: { verificationStatus: facility.verificationStatus, operatingStatus: facility.operatingStatus, providerStatus: facility.provider.status } };
  }

  /** Offerings of another provider answer 404, never 403, so their existence does not leak (AC-SVC-02). */
  private async owned(providerId: string, id: string) {
    const offering = await this.prisma.serviceOffering.findFirst({ where: { id, providerId }, include: offeringInclude });
    if (!offering) throw AppError.notFound();
    return offering;
  }

  private async assertMasterService(masterServiceId: string) {
    const service = await this.prisma.masterService.findFirst({ where: { id: masterServiceId, active: true, deletedAt: null, category: { active: true, deletedAt: null } }, select: { id: true } });
    if (!service) throw AppError.unprocessable('INVALID_REFERENCE', 'Some selected values are not available.', { fields: { masterServiceId: ['master service not found or inactive'] } });
  }

  /** One entry per mode; a visit fee only makes sense for homecare. */
  private prepareModes(input: OfferingModeDto[]) {
    const errors: Record<string, string[]> = {};
    const seen = new Set<string>();
    const modes = input.map((mode, index) => {
      if (seen.has(mode.mode)) errors[`modes.${index}.mode`] = ['each mode can be listed once'];
      seen.add(mode.mode);
      if (mode.mode !== 'HOMECARE' && mode.visitFee) errors[`modes.${index}.visitFee`] = ['a visit fee only applies to homecare'];
      return { mode: mode.mode, enabled: mode.enabled ?? true, priceOverride: mode.priceOverride ?? null, visitFee: mode.mode === 'HOMECARE' ? mode.visitFee ?? null : null };
    });
    if (Object.keys(errors).length) throw AppError.unprocessable('VALIDATION_FAILED', 'Some modes are not valid.', { fields: errors });
    return modes;
  }

  /** Upserts the listed modes and disables the others, keeping one row per mode. */
  private async replaceModes(tx: Db, offeringId: string, modes: ReturnType<OfferingsService['prepareModes']>) {
    for (const mode of FULFILLMENT_MODES) {
      const input = modes.find((entry) => entry.mode === mode);
      if (input) await tx.offeringMode.upsert({ where: { offeringId_mode: { offeringId, mode } }, create: { offeringId, ...input }, update: input });
      else await tx.offeringMode.updateMany({ where: { offeringId, mode }, data: { enabled: false } });
    }
  }

  private auditView(offering: OfferingWithDetail) {
    const { name, masterServiceId, basePrice, durationMinutes, status, description, preparationNote, terms, modes } = offering;
    return { name, masterServiceId, basePrice, durationMinutes, status, description, preparationNote, terms, modes: modes.map(({ mode, enabled, priceOverride, visitFee }) => ({ mode, enabled, priceOverride, visitFee })) };
  }
}
