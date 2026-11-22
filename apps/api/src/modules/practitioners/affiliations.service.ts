import { Injectable } from '@nestjs/common';
import { Prisma, type AffiliationStatus } from '@prisma/client';
import { AppError } from '../../common/errors/app-error';
import { paginate, skipTake } from '../../common/dto/pagination.dto';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditService, type AuditSource } from '../audit/audit.service';
import { OutboxService } from '../notifications/outbox.service';
import type { AffiliationQueryDto, AffiliationReviewDto, ProposeAffiliationDto, UpdateAffiliationDto } from './dto/practitioner.dto';
import { jakartaToday, PractitionersService } from './practitioners.service';

const LIVE: AffiliationStatus[] = ['PROPOSED', 'ACTIVE'];
const toDate = (value?: string | null) => (value ? new Date(`${value.slice(0, 10)}T00:00:00.000Z`) : null);

const affiliationSelect = {
  id: true,
  status: true,
  startDate: true,
  endDate: true,
  note: true,
  reason: true,
  reviewedAt: true,
  createdAt: true,
  updatedAt: true,
  facility: { select: { id: true, displayName: true, verificationStatus: true, operatingStatus: true } },
  practitioner: {
    select: {
      id: true,
      fullName: true,
      verificationStatus: true,
      operatingStatus: true,
      practitionerType: { select: { id: true, name: true } },
      credentials: { select: { credentialType: true, numberMasked: true, validUntil: true }, orderBy: { createdAt: 'asc' } },
    },
  },
} satisfies Prisma.PractitionerAffiliationSelect;

/**
 * Clinic ↔ practitioner affiliation (spec §5.4). MVP process: the clinic proposes, a platform admin approves or
 * rejects; practitioner confirmation waits for a practitioner portal. A practitioner may be affiliated with several
 * clinics, but each pair has at most one proposed or active affiliation (partial unique index).
 */
@Injectable()
export class AffiliationsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly practitioners: PractitionersService,
    private readonly audit: AuditService,
    private readonly outbox: OutboxService,
  ) {}

  /** Propose an existing practitioner, or register a new one and propose them in the same transaction. */
  async propose(facilityId: string, dto: ProposeAffiliationDto, source: AuditSource & { actorId: string }) {
    if (Boolean(dto.practitionerId) === Boolean(dto.practitioner)) {
      throw AppError.unprocessable('VALIDATION_FAILED', 'Choose an existing practitioner or register a new one.', { fields: { practitionerId: ['provide practitionerId or practitioner, not both'] } });
    }
    const facility = await this.prisma.facility.findUnique({ where: { id: facilityId }, select: { id: true, displayName: true, verificationStatus: true } });
    if (!facility) throw AppError.notFound();
    if (facility.verificationStatus !== 'VERIFIED') throw AppError.unprocessable('FACILITY_NOT_VERIFIED', 'Your clinic must be verified before proposing practitioners.');

    if (dto.practitionerId) {
      const practitioner = await this.prisma.practitioner.findUnique({ where: { id: dto.practitionerId }, select: { id: true } });
      if (!practitioner) throw AppError.notFound('This practitioner was not found.');
      await this.assertNoLive(facilityId, dto.practitionerId);
    }

    try {
      const affiliationId = await this.prisma.$transaction(async (tx) => {
        const practitionerId = dto.practitionerId ?? (await this.practitioners.register(dto.practitioner!, { via: 'CLINIC', facilityId }, source, tx));
        const affiliation = await tx.practitionerAffiliation.create({
          data: { facilityId, practitionerId, status: 'PROPOSED', startDate: toDate(dto.startDate), note: dto.note ?? null, proposedById: source.actorId },
        });
        await this.audit.record(source, { event: 'AFFILIATION_PROPOSED', entityType: 'PractitionerAffiliation', entityId: affiliation.id, facilityId, after: { practitionerId, startDate: dto.startDate ?? null, newPractitioner: !dto.practitionerId } }, tx);
        await this.outbox.enqueue({ eventType: 'AFFILIATION_PROPOSED', entityType: 'PractitionerAffiliation', entityId: affiliation.id, payload: { facilityName: facility.displayName, practitionerId } }, tx);
        return affiliation.id;
      });
      return this.get(affiliationId);
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002' && JSON.stringify(error.meta?.target ?? '').includes('practitionerId')) {
        throw AppError.conflict('AFFILIATION_EXISTS', 'This practitioner already has a proposed or active affiliation with your clinic.');
      }
      throw error;
    }
  }

  /** The clinic's own affiliations; never another clinic's. */
  async listForFacility(facilityId: string, query: AffiliationQueryDto) {
    const where: Prisma.PractitionerAffiliationWhereInput = {
      facilityId,
      ...(query.status ? { status: query.status } : {}),
      ...(query.search ? { practitioner: { fullName: { contains: query.search, mode: 'insensitive' } } } : {}),
    };
    const [items, total, counts] = await Promise.all([
      this.prisma.practitionerAffiliation.findMany({ where, orderBy: { createdAt: query.sortOrder }, ...skipTake(query), select: affiliationSelect }),
      this.prisma.practitionerAffiliation.count({ where }),
      this.prisma.practitionerAffiliation.groupBy({ by: ['status'], where: { facilityId }, _count: { _all: true } }),
    ]);
    return { ...paginate(items, total, query), counts: Object.fromEntries(counts.map((row) => [row.status, row._count._all])) };
  }

  /** WITHDRAW a proposal that is still waiting, or END an active affiliation (reason required). */
  async updateByClinic(facilityId: string, id: string, dto: UpdateAffiliationDto, source: AuditSource & { actorId: string }) {
    const affiliation = await this.prisma.practitionerAffiliation.findFirst({ where: { id, facilityId }, select: { id: true, status: true, startDate: true } });
    if (!affiliation) throw AppError.notFound();
    if (dto.action === 'END' && (dto.reason ?? '').length < 5) {
      throw AppError.unprocessable('VALIDATION_FAILED', 'A reason is required to end an affiliation.', { fields: { reason: ['reason must be at least 5 characters'] } });
    }
    const from: AffiliationStatus = dto.action === 'WITHDRAW' ? 'PROPOSED' : 'ACTIVE';
    const endDate = dto.action === 'END' ? toDate(dto.endDate) ?? jakartaToday() : null;
    if (endDate && affiliation.startDate && endDate < affiliation.startDate) {
      throw AppError.unprocessable('VALIDATION_FAILED', 'The end date cannot be before the start date.', { fields: { endDate: ['endDate must not be before startDate'] } });
    }
    await this.prisma.$transaction(async (tx) => {
      const moved = await tx.practitionerAffiliation.updateMany({ where: { id, facilityId, status: from }, data: { status: 'ENDED', reason: dto.reason ?? null, endDate, endedById: source.actorId } });
      if (moved.count === 0) {
        throw AppError.conflict('AFFILIATION_STATE_CHANGED', dto.action === 'WITHDRAW' ? 'Only a proposal that is still waiting can be withdrawn.' : 'Only an active affiliation can be ended.');
      }
      await this.audit.record(source, { event: dto.action === 'WITHDRAW' ? 'AFFILIATION_WITHDRAWN' : 'AFFILIATION_ENDED', entityType: 'PractitionerAffiliation', entityId: id, facilityId, before: { status: affiliation.status }, after: { status: 'ENDED', reason: dto.reason ?? null, endDate } }, tx);
    });
    return this.get(id);
  }

  /** Platform queue across clinics; proposals read oldest first. */
  async adminList(query: AffiliationQueryDto) {
    const where: Prisma.PractitionerAffiliationWhereInput = {
      ...(query.status ? { status: query.status } : {}),
      ...(query.search
        ? { OR: [{ practitioner: { fullName: { contains: query.search, mode: 'insensitive' } } }, { facility: { displayName: { contains: query.search, mode: 'insensitive' } } }] }
        : {}),
    };
    const orderBy = { createdAt: query.status === 'PROPOSED' ? 'asc' : query.sortOrder } as const;
    const [items, total, counts] = await Promise.all([
      this.prisma.practitionerAffiliation.findMany({ where, orderBy, ...skipTake(query), select: affiliationSelect }),
      this.prisma.practitionerAffiliation.count({ where }),
      this.prisma.practitionerAffiliation.groupBy({ by: ['status'], _count: { _all: true } }),
    ]);
    return { ...paginate(items, total, query), counts: Object.fromEntries(counts.map((row) => [row.status, row._count._all])) };
  }

  /**
   * Approve (practitioner and clinic must both be verified, practitioner not suspended) or reject (reason required).
   * A conditional update lets only one reviewer decide.
   */
  async adminDecide(id: string, dto: AffiliationReviewDto, source: AuditSource & { actorId: string }) {
    if (dto.decision === 'REJECT' && (dto.reason ?? '').length < 5) {
      throw AppError.unprocessable('VALIDATION_FAILED', 'A reason is required to reject.', { fields: { reason: ['reason must be at least 5 characters'] } });
    }
    const affiliation = await this.prisma.practitionerAffiliation.findUnique({ where: { id }, select: affiliationSelect });
    if (!affiliation) throw AppError.notFound();
    if (dto.decision === 'APPROVE') {
      if (affiliation.practitioner.verificationStatus !== 'VERIFIED') throw AppError.unprocessable('PRACTITIONER_NOT_VERIFIED', 'Verify the practitioner before approving the affiliation.');
      if (affiliation.practitioner.operatingStatus === 'SUSPENDED') throw AppError.unprocessable('PRACTITIONER_SUSPENDED', 'A suspended practitioner cannot be affiliated.');
      if (affiliation.facility.verificationStatus !== 'VERIFIED') throw AppError.unprocessable('FACILITY_NOT_VERIFIED', 'The clinic is no longer verified.');
    }
    const owner = await this.prisma.membership.findFirst({ where: { facilityId: affiliation.facility.id, active: true, role: { code: 'CLINIC_OWNER_ADMIN' } }, select: { user: { select: { email: true } } } });
    const status: AffiliationStatus = dto.decision === 'APPROVE' ? 'ACTIVE' : 'REJECTED';
    await this.prisma.$transaction(async (tx) => {
      const decided = await tx.practitionerAffiliation.updateMany({
        where: { id, status: 'PROPOSED' },
        data: {
          status,
          reviewedById: source.actorId,
          reviewedAt: new Date(),
          reason: dto.decision === 'REJECT' ? dto.reason! : null,
          ...(dto.decision === 'APPROVE' && !affiliation.startDate ? { startDate: jakartaToday() } : {}),
        },
      });
      if (decided.count === 0) throw AppError.conflict('AFFILIATION_ALREADY_DECIDED', 'This affiliation is no longer waiting for a decision. Reload to see the latest status.');
      await this.audit.record(source, { event: dto.decision === 'APPROVE' ? 'AFFILIATION_APPROVED' : 'AFFILIATION_REJECTED', entityType: 'PractitionerAffiliation', entityId: id, facilityId: affiliation.facility.id, before: { status: affiliation.status }, after: { status, reason: dto.reason ?? null } }, tx);
      await this.outbox.enqueue({ eventType: 'AFFILIATION_DECIDED', entityType: 'PractitionerAffiliation', entityId: id, recipient: owner?.user.email, payload: { facilityName: affiliation.facility.displayName, practitionerName: affiliation.practitioner.fullName, decision: dto.decision, reason: dto.reason ?? null } }, tx);
    });
    return this.get(id);
  }

  private async assertNoLive(facilityId: string, practitionerId: string) {
    const live = await this.prisma.practitionerAffiliation.findFirst({ where: { facilityId, practitionerId, status: { in: LIVE } }, select: { status: true } });
    if (live) throw AppError.conflict('AFFILIATION_EXISTS', live.status === 'ACTIVE' ? 'This practitioner is already affiliated with your clinic.' : 'A proposal for this practitioner is already waiting for review.');
  }

  private async get(id: string) {
    const affiliation = await this.prisma.practitionerAffiliation.findUnique({ where: { id }, select: affiliationSelect });
    if (!affiliation) throw AppError.notFound();
    return affiliation;
  }
}
