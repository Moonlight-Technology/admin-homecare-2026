import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { type FacilityMediaKind, Prisma } from '@prisma/client';
import { AppError } from '../../common/errors/app-error';
import { PrismaService, type Db } from '../../prisma/prisma.service';
import { AuditService, type AuditSource } from '../audit/audit.service';
import { DocumentsService } from '../documents/documents.service';

/** Gallery size for the clinic profile. Working assumption (spec §4 only says "media"); one logo is separate. */
export const MAX_FACILITY_PHOTOS = 8;

const mediaFields = {
  id: true,
  kind: true,
  caption: true,
  sortOrder: true,
  createdAt: true,
  document: { select: { id: true, fileName: true, mimeType: true, sizeBytes: true } },
} satisfies Prisma.FacilityMediaSelect;

type MediaRow = Prisma.FacilityMediaGetPayload<{ select: typeof mediaFields }>;

/**
 * Clinic profile media (spec §4 `/clinic/profile`): one logo plus a small photo gallery. Bytes are private documents
 * (`FACILITY_MEDIA`, never listed with verification documents) and are only shown through short-lived signed links.
 * Media is not part of verification, so it can change while an application is under review. Public discovery does
 * not expose it yet (no customer-app contract for media exists).
 */
@Injectable()
export class FacilityMediaService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly documents: DocumentsService,
    private readonly audit: AuditService,
    private readonly config: ConfigService,
  ) {}

  async list(facilityId: string) {
    const rows = await this.prisma.facilityMedia.findMany({
      where: { facilityId },
      orderBy: [{ kind: 'asc' }, { sortOrder: 'asc' }, { createdAt: 'asc' }],
      select: mediaFields,
    });
    return { maxPhotos: MAX_FACILITY_PHOTOS, items: rows.map((row) => this.present(row)) };
  }

  async initUpload(facilityId: string, input: { kind: FacilityMediaKind; fileName: string; mimeType: string; sizeBytes: number }, userId: string) {
    if (input.kind === 'PHOTO') await this.assertPhotoRoom(this.prisma, facilityId);
    const { kind: _kind, ...file } = input;
    return this.documents.initMediaUpload(facilityId, file, userId);
  }

  /** Completes the upload and attaches it. A new logo replaces the previous one; photos are appended at the end. */
  async complete(facilityId: string, input: { documentId: string; kind: FacilityMediaKind; caption?: string | null }, source: AuditSource) {
    const owner = { ownerType: 'FACILITY_MEDIA' as const, ownerId: facilityId };
    const removedKeys: string[] = [];
    const row = await this.prisma.$transaction(async (tx) => {
      await this.lockFacility(tx, facilityId);
      await this.documents.completeUpload(owner, input.documentId, source, tx);
      let sortOrder = 0;
      if (input.kind === 'PHOTO') {
        await this.assertPhotoRoom(tx, facilityId);
        const last = await tx.facilityMedia.aggregate({ where: { facilityId, kind: 'PHOTO' }, _max: { sortOrder: true } });
        sortOrder = (last._max.sortOrder ?? -1) + 1;
      } else {
        const previous = await tx.facilityMedia.findFirst({ where: { facilityId, kind: 'LOGO' }, select: { id: true, documentId: true } });
        if (previous) {
          await tx.facilityMedia.delete({ where: { id: previous.id } });
          removedKeys.push(await this.documents.deleteOwned(owner, previous.documentId, tx));
        }
      }
      const created = await tx.facilityMedia.create({
        data: { facilityId, documentId: input.documentId, kind: input.kind, caption: input.caption ?? null, sortOrder, createdById: source.actorId ?? null },
        select: mediaFields,
      });
      await this.audit.record(source, { event: 'FACILITY_MEDIA_ADDED', entityType: 'FacilityMedia', entityId: created.id, facilityId, after: { kind: created.kind, documentId: input.documentId, caption: created.caption, replacedLogo: removedKeys.length > 0 } }, tx);
      return created;
    });
    await this.documents.removeObjects(removedKeys);
    return this.present(row);
  }

  async updateCaption(facilityId: string, id: string, caption: string | null, source: AuditSource) {
    const row = await this.prisma.$transaction(async (tx) => {
      const before = await this.owned(tx, facilityId, id);
      const updated = await tx.facilityMedia.update({ where: { id }, data: { caption }, select: mediaFields });
      await this.audit.record(source, { event: 'FACILITY_MEDIA_UPDATED', entityType: 'FacilityMedia', entityId: id, facilityId, before: { caption: before.caption }, after: { caption } }, tx);
      return updated;
    });
    return this.present(row);
  }

  /** Reorders the whole gallery at once; the list must name every current photo exactly once. */
  async reorder(facilityId: string, ids: string[], source: AuditSource) {
    await this.prisma.$transaction(async (tx) => {
      await this.lockFacility(tx, facilityId);
      const photos = await tx.facilityMedia.findMany({ where: { facilityId, kind: 'PHOTO' }, select: { id: true } });
      const current = new Set(photos.map((photo) => photo.id));
      if (ids.length !== current.size || ids.some((id) => !current.has(id))) {
        throw AppError.unprocessable('VALIDATION_FAILED', 'The order must list every current photo exactly once.', { fields: { ids: ['must contain every current photo id'] } });
      }
      await Promise.all(ids.map((id, index) => tx.facilityMedia.update({ where: { id }, data: { sortOrder: index } })));
      await this.audit.record(source, { event: 'FACILITY_MEDIA_REORDERED', entityType: 'Facility', entityId: facilityId, facilityId, after: { ids } }, tx);
    });
    return this.list(facilityId);
  }

  async remove(facilityId: string, id: string, source: AuditSource) {
    const key = await this.prisma.$transaction(async (tx) => {
      const media = await this.owned(tx, facilityId, id);
      await tx.facilityMedia.delete({ where: { id } });
      const objectKey = await this.documents.deleteOwned({ ownerType: 'FACILITY_MEDIA', ownerId: facilityId }, media.documentId, tx);
      await this.audit.record(source, { event: 'FACILITY_MEDIA_REMOVED', entityType: 'FacilityMedia', entityId: id, facilityId, before: { kind: media.kind, documentId: media.documentId, caption: media.caption } }, tx);
      return objectKey;
    });
    await this.documents.removeObjects([key]);
  }

  private present({ document, ...row }: MediaRow) {
    return { ...row, fileName: document.fileName, mimeType: document.mimeType, sizeBytes: document.sizeBytes, ...this.documents.downloadLink(document.id) };
  }

  /** Media of another facility answers 404 so its existence does not leak (spec §8). */
  private async owned(db: Db, facilityId: string, id: string) {
    const media = await db.facilityMedia.findFirst({ where: { id, facilityId }, select: { id: true, kind: true, caption: true, documentId: true } });
    if (!media) throw AppError.notFound();
    return media;
  }

  private async assertPhotoRoom(db: Db, facilityId: string) {
    const count = await db.facilityMedia.count({ where: { facilityId, kind: 'PHOTO' } });
    if (count >= MAX_FACILITY_PHOTOS) throw AppError.conflict('MEDIA_LIMIT_REACHED', `A clinic can have at most ${MAX_FACILITY_PHOTOS} photos.`, { maxPhotos: MAX_FACILITY_PHOTOS });
  }

  /** Serialises gallery changes per facility so concurrent uploads cannot exceed the limit or duplicate the logo. */
  private async lockFacility(db: Db, facilityId: string) {
    const rows = await db.$queryRaw<Array<{ id: string }>>`SELECT "id" FROM ${this.facilitiesTable()} WHERE "id" = ${facilityId}::uuid FOR UPDATE`;
    if (!rows.length) throw AppError.notFound();
  }

  /** Raw queries do not always inherit a transaction-pooler's schema search_path (see NotificationRepository). */
  private facilitiesTable() {
    const schema = new URL(this.config.getOrThrow<string>('DATABASE_URL')).searchParams.get('schema') || 'public';
    if (!/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(schema)) throw new Error('UNSUPPORTED_DATABASE_SCHEMA');
    return Prisma.raw(`"${schema}"."facilities"`);
  }
}
