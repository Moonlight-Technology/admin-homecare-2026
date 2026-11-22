import { Injectable } from '@nestjs/common';
import { Prisma, type ApplicationStatus, type VerificationStatus } from '@prisma/client';
import { AppError } from '../../common/errors/app-error';
import { paginate, skipTake } from '../../common/dto/pagination.dto';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditService, type AuditSource } from '../audit/audit.service';
import { DocumentsService } from '../documents/documents.service';
import { OutboxService } from '../notifications/outbox.service';
import type { ApplicationQueryDto, ReviewDecisionDto } from './dto/facility.dto';
import { FacilitiesService, missingProfileFields } from './facilities.service';

/** Statuses from which a clinic may (re)submit; rejected clinics resubmit with a new version (spec §5.1 step 6). */
export const SUBMITTABLE: VerificationStatus[] = ['DRAFT', 'REVISION_REQUIRED', 'REJECTED'];
const OPEN: ApplicationStatus[] = ['SUBMITTED', 'UNDER_REVIEW'];

const DECISIONS = {
  APPROVE: { application: 'APPROVED', facility: 'VERIFIED', event: 'FACILITY_APPLICATION_APPROVED' },
  REQUEST_REVISION: { application: 'REVISION_REQUIRED', facility: 'REVISION_REQUIRED', event: 'FACILITY_APPLICATION_REVISION_REQUESTED' },
  REJECT: { application: 'REJECTED', facility: 'REJECTED', event: 'FACILITY_APPLICATION_REJECTED' },
} as const;

type Requirement = { id: string; code: string; name: string; description: string | null; mandatory: boolean };
type Doc = { id: string; requirementId: string | null; status: string; uploadedAt: Date | null };

/** Latest completed document per requirement: the one that a submission includes. */
export function latestDocumentByRequirement<T extends Doc>(documents: T[]): Map<string, T> {
  const latest = new Map<string, T>();
  for (const document of documents) {
    if (!document.requirementId || document.status === 'PENDING_UPLOAD' || document.status === 'REJECTED') continue;
    const current = latest.get(document.requirementId);
    if (!current || (document.uploadedAt ?? 0) > (current.uploadedAt ?? 0)) latest.set(document.requirementId, document);
  }
  return latest;
}

/** Field errors for mandatory requirements without a usable document (AC-FAC-02). */
export function missingDocuments(requirements: Requirement[], latest: Map<string, Doc>): Record<string, string[]> {
  return Object.fromEntries(requirements.filter((requirement) => requirement.mandatory && !latest.has(requirement.id)).map((requirement) => [`documents.${requirement.code}`, [`${requirement.name} is required`]]));
}

/**
 * Facility verification workflow (spec §5.1, §6): DRAFT → SUBMITTED → UNDER_REVIEW → VERIFIED | REVISION_REQUIRED |
 * REJECTED. Every decision is an append-only review with reviewer and time; transitions are conditional updates,
 * so two reviewers acting at once cannot both succeed.
 */
@Injectable()
export class VerificationService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly facilities: FacilitiesService,
    private readonly documents: DocumentsService,
    private readonly audit: AuditService,
    private readonly outbox: OutboxService,
  ) {}

  /** What the clinic needs on its verification page: checklist, uploads, gaps, and history. */
  async clinicState(facilityId: string) {
    const [facility, requirements, documents, history] = await Promise.all([
      this.facilities.detail(facilityId),
      this.requirements(),
      this.documents.listForOwner({ ownerType: 'FACILITY', ownerId: facilityId }),
      this.history(facilityId),
    ]);
    const latest = latestDocumentByRequirement(documents);
    const missing = { ...missingProfileFields(facility), ...missingDocuments(requirements, latest) };
    return {
      facility: { id: facility.id, displayName: facility.displayName, verificationStatus: facility.verificationStatus, operatingStatus: facility.operatingStatus, statusReason: facility.statusReason, verifiedAt: facility.verifiedAt },
      requirements: requirements.map((requirement) => ({ ...requirement, document: latest.get(requirement.id) ?? null })),
      documents,
      missing,
      canSubmit: SUBMITTABLE.includes(facility.verificationStatus) && Object.keys(missing).length === 0,
      editable: SUBMITTABLE.includes(facility.verificationStatus) || facility.verificationStatus === 'VERIFIED',
      history,
    };
  }

  async submit(facilityId: string, source: AuditSource & { actorId: string }) {
    const facility = await this.facilities.detail(facilityId);
    if (!SUBMITTABLE.includes(facility.verificationStatus)) {
      throw AppError.conflict('APPLICATION_NOT_SUBMITTABLE', facility.verificationStatus === 'VERIFIED' ? 'The facility is already verified.' : 'A submission is already being reviewed.');
    }
    const [requirements, documents] = await Promise.all([this.requirements(), this.documents.listForOwner({ ownerType: 'FACILITY', ownerId: facilityId })]);
    const latest = latestDocumentByRequirement(documents);
    const missing = { ...missingProfileFields(facility), ...missingDocuments(requirements, latest) };
    if (Object.keys(missing).length) throw AppError.unprocessable('APPLICATION_INCOMPLETE', 'Complete the profile and required documents before submitting.', { fields: missing });

    const { owner: _owner, provider: _provider, ...profileSnapshot } = facility;
    const documentIds = [...latest.values()].map((document) => document.id);
    const application = await this.prisma.$transaction(async (tx) => {
      const moved = await tx.facility.updateMany({ where: { id: facilityId, verificationStatus: { in: SUBMITTABLE } }, data: { verificationStatus: 'SUBMITTED' } });
      if (moved.count === 0) throw AppError.conflict('APPLICATION_NOT_SUBMITTABLE', 'The facility status changed; reload and try again.');
      const previous = await tx.facilityApplication.aggregate({ where: { facilityId }, _max: { version: true } });
      const created = await tx.facilityApplication.create({
        data: { facilityId, version: (previous._max.version ?? 0) + 1, status: 'SUBMITTED', submittedById: source.actorId, profileSnapshot: profileSnapshot as unknown as Prisma.InputJsonValue, documentIds },
      });
      await this.audit.record(source, { event: 'FACILITY_APPLICATION_SUBMITTED', entityType: 'FacilityApplication', entityId: created.id, facilityId, after: { version: created.version, documentIds } }, tx);
      await this.outbox.enqueue({ eventType: 'FACILITY_APPLICATION_SUBMITTED', entityType: 'FacilityApplication', entityId: created.id, payload: { facilityId, facilityName: facility.displayName, version: created.version } }, tx);
      return created;
    });
    return { applicationId: application.id, version: application.version };
  }

  /** Versions and decisions of a facility, newest first; kept across resubmissions (AC-FAC-04). */
  async history(facilityId: string) {
    const applications = await this.prisma.facilityApplication.findMany({ where: { facilityId }, orderBy: { version: 'desc' }, select: { id: true, version: true, status: true, submittedAt: true, decidedAt: true } });
    const reviews = applications.length
      ? await this.prisma.verificationReview.findMany({ where: { targetType: 'FACILITY_APPLICATION', targetId: { in: applications.map((application) => application.id) } }, orderBy: { createdAt: 'desc' } })
      : [];
    const reviewerIds = [...new Set(reviews.map((review) => review.reviewerId))];
    const reviewers = reviewerIds.length ? await this.prisma.user.findMany({ where: { id: { in: reviewerIds } }, select: { id: true, name: true } }) : [];
    const names = new Map(reviewers.map((reviewer) => [reviewer.id, reviewer.name]));
    return applications.map((application) => ({
      ...application,
      reviews: reviews.filter((review) => review.targetId === application.id).map((review) => ({ id: review.id, decision: review.decision, reason: review.reason, reviewer: { id: review.reviewerId, name: names.get(review.reviewerId) ?? 'Reviewer' }, createdAt: review.createdAt })),
    }));
  }

  async list(query: ApplicationQueryDto) {
    const where: Prisma.FacilityApplicationWhereInput = {
      ...(query.status ? { status: query.status } : {}),
      ...(query.search ? { facility: { OR: [{ displayName: { contains: query.search, mode: 'insensitive' } }, { legalName: { contains: query.search, mode: 'insensitive' } }] } } : {}),
    };
    // Open queues read oldest first, so the longest wait is handled first.
    const orderBy = { submittedAt: query.status && OPEN.includes(query.status) ? 'asc' : query.sortOrder } as const;
    const [items, total, counts] = await Promise.all([
      this.prisma.facilityApplication.findMany({
        where,
        orderBy,
        ...skipTake(query),
        select: { id: true, version: true, status: true, submittedAt: true, decidedAt: true, facility: { select: { id: true, displayName: true, legalName: true, addressLine: true, verificationStatus: true, facilityType: { select: { name: true } }, clinicClass: { select: { name: true } } } } },
      }),
      this.prisma.facilityApplication.count({ where }),
      this.prisma.facilityApplication.groupBy({ by: ['status'], _count: { _all: true } }),
    ]);
    return { ...paginate(items, total, query), counts: Object.fromEntries(counts.map((row) => [row.status, row._count._all])) };
  }

  /** Reviewer view: the submitted snapshot, the current profile, documents with short-lived links, and full history. */
  async detail(applicationId: string) {
    const application = await this.prisma.facilityApplication.findUnique({ where: { id: applicationId } });
    if (!application) throw AppError.notFound();
    const [facility, documents, requirements, history] = await Promise.all([
      this.facilities.detail(application.facilityId),
      this.documents.listByIds(application.documentIds),
      this.requirements(),
      this.history(application.facilityId),
    ]);
    const submitter = await this.prisma.user.findUnique({ where: { id: application.submittedById }, select: { id: true, name: true, email: true } });
    return {
      application: { id: application.id, version: application.version, status: application.status, submittedAt: application.submittedAt, decidedAt: application.decidedAt, submittedBy: submitter, profileSnapshot: application.profileSnapshot },
      facility,
      checklist: requirements.map((requirement) => {
        const document = documents.find((item) => item.requirementId === requirement.id) ?? null;
        return { ...requirement, document: document ? { ...document, ...this.documents.downloadLink(document.id) } : null };
      }),
      history,
      isLatest: history[0]?.id === application.id,
    };
  }

  async startReview(applicationId: string, source: AuditSource) {
    const application = await this.prisma.facilityApplication.findUnique({ where: { id: applicationId }, select: { facilityId: true } });
    if (!application) throw AppError.notFound();
    await this.prisma.$transaction(async (tx) => {
      const moved = await tx.facilityApplication.updateMany({ where: { id: applicationId, status: 'SUBMITTED' }, data: { status: 'UNDER_REVIEW' } });
      if (moved.count === 0) throw AppError.conflict('APPLICATION_NOT_PENDING', 'This application is no longer waiting for review.');
      await tx.facility.updateMany({ where: { id: application.facilityId, verificationStatus: 'SUBMITTED' }, data: { verificationStatus: 'UNDER_REVIEW' } });
      await this.audit.record(source, { event: 'FACILITY_APPLICATION_REVIEW_STARTED', entityType: 'FacilityApplication', entityId: applicationId, facilityId: application.facilityId }, tx);
    });
    return this.detail(applicationId);
  }

  /**
   * Approve, request revision (comment required), or reject (reason required) — AC-FAC-03/04. Approval verifies the
   * facility and, while it is not suspended, activates it: verification is the only operational prerequisite
   * defined so far (spec §5.1 step 5).
   */
  async decide(applicationId: string, dto: ReviewDecisionDto, source: AuditSource & { actorId: string }) {
    if (dto.decision !== 'APPROVE' && (dto.reason ?? '').length < 5) {
      throw AppError.unprocessable('VALIDATION_FAILED', dto.decision === 'REJECT' ? 'A reason is required to reject.' : 'A comment is required to request a revision.', { fields: { reason: ['reason must be at least 5 characters'] } });
    }
    const application = await this.prisma.facilityApplication.findUnique({ where: { id: applicationId }, include: { facility: { select: { id: true, displayName: true, operatingStatus: true } } } });
    if (!application) throw AppError.notFound();
    const outcome = DECISIONS[dto.decision];
    const owner = await this.prisma.membership.findFirst({ where: { facilityId: application.facilityId, active: true, role: { code: 'CLINIC_OWNER_ADMIN' } }, select: { user: { select: { email: true } } } });

    await this.prisma.$transaction(async (tx) => {
      const decided = await tx.facilityApplication.updateMany({ where: { id: applicationId, status: { in: OPEN } }, data: { status: outcome.application, decidedAt: new Date() } });
      if (decided.count === 0) throw AppError.conflict('APPLICATION_ALREADY_DECIDED', 'Another reviewer has already decided this application. Reload to see the latest status.');
      await tx.verificationReview.create({ data: { targetType: 'FACILITY_APPLICATION', targetId: applicationId, decision: dto.decision, reason: dto.reason ?? null, reviewerId: source.actorId, documentIds: application.documentIds } });
      const activate = dto.decision === 'APPROVE' && application.facility.operatingStatus === 'INACTIVE';
      await tx.facility.update({
        where: { id: application.facilityId },
        data: { verificationStatus: outcome.facility, ...(dto.decision === 'APPROVE' ? { verifiedAt: new Date() } : {}), ...(activate ? { operatingStatus: 'ACTIVE', statusReason: null } : {}) },
      });
      if (activate) await tx.provider.updateMany({ where: { facilityId: application.facilityId }, data: { status: 'ACTIVE' } });
      if (dto.decision === 'APPROVE' && application.documentIds.length) await tx.document.updateMany({ where: { id: { in: application.documentIds } }, data: { status: 'ACCEPTED' } });
      await this.audit.record(source, { event: outcome.event, entityType: 'FacilityApplication', entityId: applicationId, facilityId: application.facilityId, after: { decision: dto.decision, reason: dto.reason ?? null, activated: activate } }, tx);
      await this.outbox.enqueue({ eventType: 'FACILITY_VERIFICATION_DECIDED', entityType: 'FacilityApplication', entityId: applicationId, recipient: owner?.user.email, payload: { facilityName: application.facility.displayName, decision: dto.decision, reason: dto.reason ?? null } }, tx);
    });
    return this.detail(applicationId);
  }

  private requirements() {
    return this.prisma.documentRequirement.findMany({
      where: { ownerType: 'FACILITY', active: true, deletedAt: null },
      orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }],
      select: { id: true, code: true, name: true, description: true, mandatory: true },
    });
  }
}
