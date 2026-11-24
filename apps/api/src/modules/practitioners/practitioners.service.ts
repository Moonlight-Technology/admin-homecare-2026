import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Prisma, type VerificationStatus } from '@prisma/client';
import { CredentialCipher, maskCredentialNumber, normalizeCredentialNumber } from '../../common/crypto/credential-cipher';
import { AppError } from '../../common/errors/app-error';
import { paginate, skipTake } from '../../common/dto/pagination.dto';
import { PrismaService, type Db } from '../../prisma/prisma.service';
import { AuditService, type AuditSource } from '../audit/audit.service';
import { OutboxService } from '../notifications/outbox.service';
import type { CreatePractitionerDto, CredentialInputDto, PractitionerQueryDto, PractitionerReviewDto, PractitionerStatusDto, UpdatePractitionerDto } from './dto/practitioner.dto';

/** Statuses from which a practitioner can be (re)submitted for review. */
export const PRACTITIONER_SUBMITTABLE: VerificationStatus[] = ['DRAFT', 'REVISION_REQUIRED', 'REJECTED'];
const IN_REVIEW: VerificationStatus[] = ['SUBMITTED', 'UNDER_REVIEW'];

const DECISIONS = {
  APPROVE: { status: 'VERIFIED', event: 'PRACTITIONER_VERIFIED' },
  REQUEST_REVISION: { status: 'REVISION_REQUIRED', event: 'PRACTITIONER_REVISION_REQUESTED' },
  REJECT: { status: 'REJECTED', event: 'PRACTITIONER_REJECTED' },
} as const;

/** Who registers a practitioner: the platform, or a clinic proposing an affiliation (spec §5.4). */
export type RegistrationOrigin = { via: 'ADMIN' } | { via: 'CLINIC'; facilityId: string };

/** Credential numbers are never selected in plain form; `numberEncrypted` stays in the database. */
const credentialSelect = {
  id: true,
  credentialType: true,
  numberMasked: true,
  issuingAuthority: true,
  validFrom: true,
  validUntil: true,
  documentId: true,
  reviewStatus: true,
  createdAt: true,
} satisfies Prisma.PractitionerCredentialSelect;

export const practitionerDetailInclude = {
  practitionerType: { select: { id: true, code: true, name: true } },
  credentials: { select: credentialSelect, orderBy: { createdAt: 'asc' } },
  affiliations: {
    orderBy: { createdAt: 'desc' },
    select: { id: true, status: true, startDate: true, endDate: true, note: true, reason: true, reviewedAt: true, createdAt: true, facility: { select: { id: true, displayName: true } } },
  },
} satisfies Prisma.PractitionerInclude;

/** Today's calendar date in Jakarta (MVP facilities are all UTC+7), as stored in `@db.Date` columns. */
export function jakartaToday(now = new Date()) {
  return new Date(`${new Date(now.getTime() + 7 * 3_600_000).toISOString().slice(0, 10)}T00:00:00.000Z`);
}

const toDate = (value?: string | null) => (value ? new Date(`${value.slice(0, 10)}T00:00:00.000Z`) : null);

/** A credential counts while it has no expiry or has not expired yet. */
export const isCredentialValid = (credential: { validUntil: Date | null }, today = jakartaToday()) => !credential.validUntil || credential.validUntil >= today;

/** Field errors for a practitioner that cannot be submitted yet: a valid STR is the working minimum (spec §5.4). */
export function missingForSubmission(credentials: Array<{ credentialType: string; validUntil: Date | null }>, today = jakartaToday()): Record<string, string[]> {
  return credentials.some((credential) => credential.credentialType === 'STR' && isCredentialValid(credential, today))
    ? {}
    : { credentials: ['a valid STR is required'] };
}

@Injectable()
export class PractitionersService {
  private readonly cipher: CredentialCipher;

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly outbox: OutboxService,
    config: ConfigService,
  ) {
    this.cipher = new CredentialCipher(config.getOrThrow<string>('CREDENTIAL_ENCRYPTION_KEY'));
  }

  /**
   * Registers a practitioner with their credentials and puts them in the review queue (SUBMITTED, INACTIVE).
   * Registration is not verification. Pass `tx` to register inside a caller's transaction (clinic proposal).
   */
  async register(dto: CreatePractitionerDto, origin: RegistrationOrigin, source: AuditSource, tx?: Db): Promise<string> {
    await this.assertType(dto.practitionerTypeId, 'practitionerTypeId');
    const credentials = this.prepareCredentials(dto.credentials, 'credentials');
    const missing = missingForSubmission(credentials.map((credential) => ({ credentialType: credential.credentialType, validUntil: credential.validUntil })));
    if (Object.keys(missing).length) throw AppError.unprocessable('VALIDATION_FAILED', 'Register at least one valid STR.', { fields: missing });
    await this.assertCredentialsFree(credentials, 'credentials');

    const run = async (db: Db) => {
      const practitioner = await db.practitioner.create({
        data: {
          fullName: dto.fullName,
          practitionerTypeId: dto.practitionerTypeId,
          phone: dto.phone ?? null,
          email: dto.email ?? null,
          verificationStatus: 'SUBMITTED',
          operatingStatus: 'INACTIVE',
          registeredVia: origin.via,
          createdById: source.actorId,
          createdByFacilityId: origin.via === 'CLINIC' ? origin.facilityId : null,
        },
      });
      await db.practitionerCredential.createMany({ data: credentials.map(({ plain: _plain, ...credential }) => ({ ...credential, practitionerId: practitioner.id })) });
      await this.audit.record(source, {
        event: origin.via === 'CLINIC' ? 'PRACTITIONER_REGISTERED_BY_CLINIC' : 'PRACTITIONER_CREATED_BY_ADMIN',
        entityType: 'Practitioner',
        entityId: practitioner.id,
        facilityId: origin.via === 'CLINIC' ? origin.facilityId : null,
        after: { fullName: practitioner.fullName, practitionerTypeId: practitioner.practitionerTypeId, credentials: credentials.map((credential) => ({ credentialType: credential.credentialType, numberMasked: credential.numberMasked })) },
      }, db);
      await this.outbox.enqueue({ eventType: 'PRACTITIONER_SUBMITTED', entityType: 'Practitioner', entityId: practitioner.id, payload: { fullName: practitioner.fullName, registeredVia: origin.via } }, db);
      return practitioner.id;
    };
    try {
      return tx ? await run(tx) : await this.prisma.$transaction(run);
    } catch (error) {
      throw this.duplicateCredential(error) ?? error;
    }
  }

  async list(query: PractitionerQueryDto) {
    const where: Prisma.PractitionerWhereInput = {
      ...(query.practitionerTypeId ? { practitionerTypeId: query.practitionerTypeId } : {}),
      ...(query.verificationStatus ? { verificationStatus: query.verificationStatus } : {}),
      ...(query.operatingStatus ? { operatingStatus: query.operatingStatus } : {}),
      ...(query.search ? { OR: [{ fullName: { contains: query.search, mode: 'insensitive' } }, { email: { contains: query.search, mode: 'insensitive' } }, ...this.credentialSearch(query.search)] } : {}),
    };
    // Review queues read oldest first, so the longest wait is handled first.
    const orderBy = query.verificationStatus && IN_REVIEW.includes(query.verificationStatus) ? { updatedAt: 'asc' as const } : { createdAt: query.sortOrder };
    const [items, total, counts] = await Promise.all([
      this.prisma.practitioner.findMany({
        where,
        orderBy,
        ...skipTake(query),
        select: {
          id: true,
          fullName: true,
          verificationStatus: true,
          operatingStatus: true,
          registeredVia: true,
          createdAt: true,
          updatedAt: true,
          practitionerType: { select: { id: true, name: true } },
          credentials: { select: { credentialType: true, numberMasked: true, validUntil: true }, orderBy: { createdAt: 'asc' } },
          _count: { select: { affiliations: { where: { status: 'ACTIVE' } } } },
        },
      }),
      this.prisma.practitioner.count({ where }),
      this.prisma.practitioner.groupBy({ by: ['verificationStatus'], _count: { _all: true } }),
    ]);
    return {
      ...paginate(items.map(({ _count, ...item }) => ({ ...item, activeAffiliations: _count.affiliations })), total, query),
      counts: Object.fromEntries(counts.map((row) => [row.verificationStatus, row._count._all])),
    };
  }

  /** Reviewer view: profile, masked credentials, affiliations, readiness, and the full review history. */
  async detail(id: string) {
    const practitioner = await this.prisma.practitioner.findUnique({ where: { id }, include: practitionerDetailInclude });
    if (!practitioner) throw AppError.notFound();
    const [history, registeredBy] = await Promise.all([
      this.history(id),
      practitioner.createdByFacilityId ? this.prisma.facility.findUnique({ where: { id: practitioner.createdByFacilityId }, select: { id: true, displayName: true } }) : null,
    ]);
    const missing = missingForSubmission(practitioner.credentials);
    return {
      ...practitioner,
      registeredByFacility: registeredBy,
      missing,
      canSubmit: PRACTITIONER_SUBMITTABLE.includes(practitioner.verificationStatus) && Object.keys(missing).length === 0,
      history,
    };
  }

  /** Profile edits by the platform; every change is audited. */
  async update(id: string, dto: UpdatePractitionerDto, source: AuditSource) {
    const before = await this.detail(id);
    if (dto.practitionerTypeId) await this.assertType(dto.practitionerTypeId, 'practitionerTypeId');
    await this.prisma.practitioner.update({ where: { id }, data: dto });
    const after = await this.detail(id);
    await this.audit.record(source, { event: 'PRACTITIONER_UPDATED', entityType: 'Practitioner', entityId: id, before: this.auditView(before), after: this.auditView(after) });
    return after;
  }

  async addCredential(id: string, dto: CredentialInputDto, source: AuditSource) {
    await this.detail(id);
    const credential = this.prepareCredentials([dto], '')[0]!;
    await this.assertCredentialsFree([credential], '');
    try {
      await this.prisma.$transaction(async (tx) => {
        const { plain: _plain, ...data } = credential;
        const created = await tx.practitionerCredential.create({ data: { ...data, practitionerId: id } });
        await this.audit.record(source, { event: 'PRACTITIONER_CREDENTIAL_ADDED', entityType: 'Practitioner', entityId: id, after: { credentialId: created.id, credentialType: created.credentialType, numberMasked: created.numberMasked } }, tx);
      });
    } catch (error) {
      throw this.duplicateCredential(error) ?? error;
    }
    return this.detail(id);
  }

  /** Full number for a reviewer checking it against the official registry; each reveal is audited. */
  async revealCredential(id: string, credentialId: string, source: AuditSource) {
    const credential = await this.prisma.practitionerCredential.findFirst({ where: { id: credentialId, practitionerId: id }, select: { id: true, credentialType: true, numberEncrypted: true } });
    if (!credential) throw AppError.notFound();
    await this.audit.record(source, { event: 'PRACTITIONER_CREDENTIAL_REVEALED', entityType: 'Practitioner', entityId: id, after: { credentialId, credentialType: credential.credentialType } });
    return { id: credential.id, credentialType: credential.credentialType, number: this.cipher.decrypt(credential.numberEncrypted) };
  }

  /** Puts a draft, revision-required or rejected practitioner back in the review queue. */
  async submit(id: string, source: AuditSource) {
    const practitioner = await this.detail(id);
    if (!PRACTITIONER_SUBMITTABLE.includes(practitioner.verificationStatus)) {
      throw AppError.conflict('PRACTITIONER_NOT_SUBMITTABLE', practitioner.verificationStatus === 'VERIFIED' ? 'The practitioner is already verified.' : 'The practitioner is already waiting for review.');
    }
    if (Object.keys(practitioner.missing).length) throw AppError.unprocessable('PRACTITIONER_INCOMPLETE', 'Add a valid STR before submitting.', { fields: practitioner.missing });
    await this.prisma.$transaction(async (tx) => {
      const moved = await tx.practitioner.updateMany({ where: { id, verificationStatus: { in: PRACTITIONER_SUBMITTABLE } }, data: { verificationStatus: 'SUBMITTED' } });
      if (moved.count === 0) throw AppError.conflict('PRACTITIONER_NOT_SUBMITTABLE', 'The practitioner status changed; reload and try again.');
      await this.audit.record(source, { event: 'PRACTITIONER_SUBMITTED', entityType: 'Practitioner', entityId: id, before: { verificationStatus: practitioner.verificationStatus } }, tx);
      await this.outbox.enqueue({ eventType: 'PRACTITIONER_SUBMITTED', entityType: 'Practitioner', entityId: id, payload: { fullName: practitioner.fullName, registeredVia: practitioner.registeredVia } }, tx);
    });
    return this.detail(id);
  }

  async startReview(id: string, source: AuditSource) {
    await this.prisma.$transaction(async (tx) => {
      const moved = await tx.practitioner.updateMany({ where: { id, verificationStatus: 'SUBMITTED' }, data: { verificationStatus: 'UNDER_REVIEW' } });
      if (moved.count === 0) {
        const exists = await tx.practitioner.findUnique({ where: { id }, select: { id: true } });
        if (!exists) throw AppError.notFound();
        throw AppError.conflict('PRACTITIONER_NOT_PENDING', 'This practitioner is no longer waiting for review.');
      }
      await this.audit.record(source, { event: 'PRACTITIONER_REVIEW_STARTED', entityType: 'Practitioner', entityId: id }, tx);
    });
    return this.detail(id);
  }

  /**
   * Approve, request revision (comment required), or reject (reason required). Approval verifies the practitioner,
   * accepts their credentials and, unless suspended, activates them. Conditional updates make sure two reviewers
   * acting at once cannot both decide.
   */
  async decide(id: string, dto: PractitionerReviewDto, source: AuditSource & { actorId: string }) {
    if (dto.decision !== 'APPROVE' && (dto.reason ?? '').length < 5) {
      throw AppError.unprocessable('VALIDATION_FAILED', dto.decision === 'REJECT' ? 'A reason is required to reject.' : 'A comment is required to request a revision.', { fields: { reason: ['reason must be at least 5 characters'] } });
    }
    const practitioner = await this.detail(id);
    if (dto.decision === 'APPROVE' && Object.keys(practitioner.missing).length) {
      throw AppError.unprocessable('PRACTITIONER_INCOMPLETE', 'A practitioner without a valid STR cannot be verified.', { fields: practitioner.missing });
    }
    const outcome = DECISIONS[dto.decision];
    const activate = dto.decision === 'APPROVE' && practitioner.operatingStatus === 'INACTIVE';
    await this.prisma.$transaction(async (tx) => {
      const decided = await tx.practitioner.updateMany({
        where: { id, verificationStatus: { in: IN_REVIEW } },
        data: {
          verificationStatus: outcome.status,
          statusReason: dto.decision === 'APPROVE' ? null : dto.reason!,
          ...(dto.decision === 'APPROVE' ? { verifiedAt: new Date() } : {}),
          ...(activate ? { operatingStatus: 'ACTIVE' } : {}),
        },
      });
      if (decided.count === 0) throw AppError.conflict('PRACTITIONER_ALREADY_DECIDED', 'This practitioner is not waiting for a decision. Reload to see the latest status.');
      const credentials = await tx.practitionerCredential.findMany({ where: { practitionerId: id }, select: { documentId: true } });
      const documentIds = [...new Set(credentials.flatMap((credential) => credential.documentId ? [credential.documentId] : []))];
      await tx.verificationReview.create({ data: { targetType: 'PRACTITIONER', targetId: id, decision: dto.decision, reason: dto.reason ?? null, reviewerId: source.actorId, documentIds } });
      if (dto.decision === 'APPROVE' && documentIds.length) await tx.document.updateMany({ where: { id: { in: documentIds }, ownerType: 'PRACTITIONER', ownerId: id, status: 'UPLOADED' }, data: { status: 'ACCEPTED' } });
      if (dto.decision === 'APPROVE') await tx.practitionerCredential.updateMany({ where: { practitionerId: id }, data: { reviewStatus: 'ACCEPTED' } });
      await this.audit.record(source, { event: outcome.event, entityType: 'Practitioner', entityId: id, before: { verificationStatus: practitioner.verificationStatus }, after: { verificationStatus: outcome.status, reason: dto.reason ?? null, activated: activate } }, tx);
      await this.outbox.enqueue({ eventType: 'PRACTITIONER_VERIFICATION_DECIDED', entityType: 'Practitioner', entityId: id, recipient: practitioner.email ?? undefined, payload: { fullName: practitioner.fullName, decision: dto.decision, reason: dto.reason ?? null } }, tx);
    });
    return this.detail(id);
  }

  /** Activation needs a verified practitioner; suspension needs a reason. Only active practitioners can be assigned. */
  async changeStatus(id: string, dto: PractitionerStatusDto, source: AuditSource) {
    const practitioner = await this.detail(id);
    if (dto.action === 'ACTIVATE' && practitioner.verificationStatus !== 'VERIFIED') throw AppError.unprocessable('PRACTITIONER_NOT_VERIFIED', 'Only a verified practitioner can be activated.');
    if (dto.action === 'SUSPEND' && (dto.reason ?? '').length < 5) {
      throw AppError.unprocessable('VALIDATION_FAILED', 'A reason is required to suspend a practitioner.', { fields: { reason: ['reason must be at least 5 characters'] } });
    }
    const operatingStatus = dto.action === 'ACTIVATE' ? 'ACTIVE' : 'SUSPENDED';
    if (practitioner.operatingStatus === operatingStatus) throw AppError.conflict('STATUS_UNCHANGED', `The practitioner is already ${operatingStatus.toLowerCase()}.`);
    await this.prisma.$transaction(async (tx) => {
      await tx.practitioner.update({ where: { id }, data: { operatingStatus, statusReason: dto.reason ?? null } });
      await this.audit.record(source, { event: dto.action === 'ACTIVATE' ? 'PRACTITIONER_ACTIVATED' : 'PRACTITIONER_SUSPENDED', entityType: 'Practitioner', entityId: id, before: { operatingStatus: practitioner.operatingStatus }, after: { operatingStatus, reason: dto.reason ?? null } }, tx);
    });
    return this.detail(id);
  }

  /** Exact STR match for clinics; returns only what they need to propose an affiliation. */
  async lookupByStr(strNumber: string) {
    const credential = await this.prisma.practitionerCredential.findUnique({
      where: { credentialType_numberHash: { credentialType: 'STR', numberHash: this.cipher.hash(strNumber) } },
      select: { practitioner: { select: { id: true, fullName: true, verificationStatus: true, operatingStatus: true, practitionerType: { select: { id: true, name: true } } } } },
    });
    if (!credential) throw AppError.notFound('No practitioner is registered with this STR number.');
    return credential.practitioner;
  }

  /** Review decisions, newest first. */
  async history(id: string) {
    const reviews = await this.prisma.verificationReview.findMany({ where: { targetType: 'PRACTITIONER', targetId: id }, orderBy: { createdAt: 'desc' } });
    const reviewerIds = [...new Set(reviews.map((review) => review.reviewerId))];
    const reviewers = reviewerIds.length ? await this.prisma.user.findMany({ where: { id: { in: reviewerIds } }, select: { id: true, name: true } }) : [];
    const names = new Map(reviewers.map((reviewer) => [reviewer.id, reviewer.name]));
    return reviews.map((review) => ({ id: review.id, decision: review.decision, reason: review.reason, reviewer: { id: review.reviewerId, name: names.get(review.reviewerId) ?? 'Reviewer' }, createdAt: review.createdAt }));
  }

  /** Validated, encrypted rows ready to insert; field errors name the offending input. */
  private prepareCredentials(input: CredentialInputDto[], prefix: string) {
    const errors: Record<string, string[]> = {};
    const seen = new Set<string>();
    const field = (index: number, name: string) => [prefix ? `${prefix}.${index}` : '', name].filter(Boolean).join('.');
    const rows = input.map((credential, index) => {
      const plain = normalizeCredentialNumber(credential.number);
      const validFrom = toDate(credential.validFrom);
      const validUntil = toDate(credential.validUntil);
      if (validFrom && validUntil && validUntil < validFrom) errors[field(index, 'validUntil')] = ['validUntil must not be before validFrom'];
      const key = `${credential.credentialType}:${plain}`;
      if (seen.has(key)) errors[field(index, 'number')] = ['this credential is listed twice'];
      seen.add(key);
      return {
        plain,
        credentialType: credential.credentialType,
        numberEncrypted: this.cipher.encrypt(plain),
        numberMasked: maskCredentialNumber(plain),
        numberHash: this.cipher.hash(plain),
        issuingAuthority: credential.issuingAuthority ?? null,
        validFrom,
        validUntil,
        reviewStatus: 'UPLOADED' as const,
      };
    });
    if (Object.keys(errors).length) throw AppError.unprocessable('VALIDATION_FAILED', 'Some credentials are not valid.', { fields: errors });
    return rows;
  }

  /** One identity per practitioner: a credential number already on file names its practitioner (spec §5.4). */
  private async assertCredentialsFree(credentials: Array<{ credentialType: string; numberHash: string }>, prefix: string) {
    const existing = await this.prisma.practitionerCredential.findMany({
      where: { OR: credentials.map(({ credentialType, numberHash }) => ({ credentialType, numberHash })) },
      select: { credentialType: true, numberHash: true, practitionerId: true },
    });
    if (!existing.length) return;
    const fields = Object.fromEntries(credentials.flatMap((credential, index) => existing.some((row) => row.credentialType === credential.credentialType && row.numberHash === credential.numberHash)
      ? [[[prefix ? `${prefix}.${index}` : '', 'number'].filter(Boolean).join('.'), [`this ${credential.credentialType} is already registered`]]]
      : []));
    throw AppError.conflict('PRACTITIONER_EXISTS', 'A practitioner with this credential is already registered.', { fields, practitionerId: existing[0]!.practitionerId });
  }

  /** A concurrent registration of the same number loses on the unique index; answer it like the pre-check. */
  private duplicateCredential(error: unknown) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002' && JSON.stringify(error.meta?.target ?? '').includes('numberHash')) {
      return AppError.conflict('PRACTITIONER_EXISTS', 'A practitioner with this credential is already registered.');
    }
    return null;
  }

  private async assertType(practitionerTypeId: string, field: string) {
    const type = await this.prisma.practitionerType.findFirst({ where: { id: practitionerTypeId, active: true, deletedAt: null }, select: { id: true } });
    if (!type) throw AppError.unprocessable('INVALID_REFERENCE', 'Some selected values are not available.', { fields: { [field]: ['practitioner type not found or inactive'] } });
  }

  /** Search by a credential number matches its hash exactly; partial numbers are not searchable by design. */
  private credentialSearch(search: string): Prisma.PractitionerWhereInput[] {
    const normalized = normalizeCredentialNumber(search);
    return /^[A-Z0-9./-]{5,60}$/.test(normalized) ? [{ credentials: { some: { numberHash: this.cipher.hash(normalized) } } }] : [];
  }

  private auditView(practitioner: Awaited<ReturnType<PractitionersService['detail']>>) {
    const { fullName, practitionerType, phone, email, verificationStatus, operatingStatus } = practitioner;
    return { fullName, practitionerTypeId: practitionerType.id, phone, email, verificationStatus, operatingStatus };
  }
}
