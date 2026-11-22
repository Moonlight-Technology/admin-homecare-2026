import { randomUUID } from 'node:crypto';
import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { DocumentOwnerType, Prisma } from '@prisma/client';
import type { Readable } from 'node:stream';
import { AppError } from '../../common/errors/app-error';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditService, type AuditSource } from '../audit/audit.service';
import { isAllowedDocumentType, matchesSignature, MAX_DOCUMENT_BYTES, safeFileName } from './document-policy';
import { signLink, verifyLink } from './signed-link';
import { createStorageDriver } from './storage/create-storage-driver';
import { ObjectTooLargeError, type StorageDriver } from './storage/storage-driver';

export type DocumentOwner = { ownerType: DocumentOwnerType; ownerId: string };

const publicFields = {
  id: true,
  ownerType: true,
  ownerId: true,
  requirementId: true,
  fileName: true,
  mimeType: true,
  sizeBytes: true,
  status: true,
  uploadedAt: true,
  createdAt: true,
  requirement: { select: { id: true, code: true, name: true, mandatory: true } },
} satisfies Prisma.DocumentSelect;

/**
 * Private documents (spec §7, §10): metadata in the database, bytes in storage (`STORAGE_DRIVER`: local disk,
 * S3/R2/MinIO, or Cloudinary) under a server-generated key that is never returned to clients. Access is always
 * through the API's short-lived signed links, whichever driver holds the bytes.
 */
@Injectable()
export class DocumentsService {
  private readonly storage: StorageDriver;

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
    private readonly audit: AuditService,
  ) {
    this.storage = createStorageDriver(this.config);
  }

  /** Step 1: validate the declared file and create a pending record with a signed upload link. */
  async initUpload(owner: DocumentOwner, input: { requirementId: string; fileName: string; mimeType: string; sizeBytes: number }, uploadedById: string) {
    if (!isAllowedDocumentType(input.mimeType)) {
      throw AppError.unprocessable('VALIDATION_FAILED', 'Only PDF, JPG, or PNG files are accepted.', { fields: { mimeType: ['file must be PDF, JPG, or PNG'] } });
    }
    if (input.sizeBytes < 1 || input.sizeBytes > MAX_DOCUMENT_BYTES) {
      throw AppError.unprocessable('VALIDATION_FAILED', 'The file must be at most 10 MB.', { fields: { sizeBytes: ['file must be between 1 byte and 10 MB'] } });
    }
    const requirement = await this.prisma.documentRequirement.findFirst({ where: { id: input.requirementId, ownerType: owner.ownerType, active: true, deletedAt: null }, select: { id: true } });
    if (!requirement) throw AppError.unprocessable('INVALID_REFERENCE', 'This document requirement does not exist.', { fields: { requirementId: ['requirement not found'] } });

    const id = randomUUID();
    const document = await this.prisma.document.create({
      data: {
        id,
        ownerType: owner.ownerType,
        ownerId: owner.ownerId,
        requirementId: requirement.id,
        objectKey: `${owner.ownerType.toLowerCase()}/${owner.ownerId}/${id}`,
        fileName: safeFileName(input.fileName),
        mimeType: input.mimeType,
        sizeBytes: input.sizeBytes,
        status: 'PENDING_UPLOAD',
        uploadedById,
      },
      select: publicFields,
    });
    const { token, expiresAt } = signLink(this.secret(), id, 'upload', this.ttl());
    return { document, upload: { method: 'PUT', url: `${this.baseUrl()}/documents/${id}/upload?token=${encodeURIComponent(token)}`, headers: { 'Content-Type': input.mimeType }, expiresAt } };
  }

  /** Step 2 (signed link, no session): stream the bytes, capped at the declared size, and check the real file type. */
  async receiveUpload(documentId: string, token: string | undefined, contentType: string | undefined, body: Readable) {
    if (!verifyLink(this.secret(), token, documentId, 'upload')) throw AppError.forbidden('The upload link is invalid or has expired.');
    const document = await this.prisma.document.findUnique({ where: { id: documentId } });
    if (!document || document.status !== 'PENDING_UPLOAD') throw AppError.conflict('UPLOAD_NOT_PENDING', 'This document is not waiting for an upload.');
    if (contentType?.split(';')[0]?.trim() !== document.mimeType) throw AppError.unprocessable('VALIDATION_FAILED', 'Content-Type does not match the declared file type.');

    let stored;
    try {
      stored = await this.storage.write(document.objectKey, body, document.sizeBytes);
    } catch (error) {
      if (error instanceof ObjectTooLargeError) throw AppError.unprocessable('VALIDATION_FAILED', 'The file is larger than declared.');
      throw error;
    }
    if (stored.sizeBytes !== document.sizeBytes || !matchesSignature(document.mimeType, stored.head)) {
      await this.storage.remove(document.objectKey);
      throw AppError.unprocessable('VALIDATION_FAILED', 'The file content does not match its declared type or size.');
    }
    await this.prisma.document.update({ where: { id: documentId }, data: { checksum: stored.sha256 } });
  }

  /** Step 3: confirm the stored bytes and make the document usable. Earlier files for the same requirement stay as history. */
  async completeUpload(owner: DocumentOwner, documentId: string, source: AuditSource) {
    const document = await this.ownedDocument(owner, documentId);
    if (document.status !== 'PENDING_UPLOAD') throw AppError.conflict('UPLOAD_NOT_PENDING', 'This document is already completed.');
    if (!document.checksum || !(await this.storage.exists(document.objectKey))) throw AppError.unprocessable('UPLOAD_MISSING', 'The file has not been uploaded yet.');
    const updated = await this.prisma.document.update({ where: { id: documentId }, data: { status: 'UPLOADED', uploadedAt: new Date() }, select: publicFields });
    await this.audit.record(source, {
      event: 'DOCUMENT_UPLOADED',
      entityType: 'Document',
      entityId: documentId,
      facilityId: owner.ownerType === 'FACILITY' ? owner.ownerId : null,
      after: { requirementId: document.requirementId, fileName: document.fileName, mimeType: document.mimeType, sizeBytes: document.sizeBytes, checksum: document.checksum },
    });
    return updated;
  }

  /** Completed documents of an owner, newest first. */
  listForOwner(owner: DocumentOwner) {
    return this.prisma.document.findMany({ where: { ...owner, status: { not: 'PENDING_UPLOAD' } }, orderBy: { uploadedAt: 'desc' }, select: publicFields });
  }

  listByIds(ids: string[]) {
    return ids.length ? this.prisma.document.findMany({ where: { id: { in: ids } }, orderBy: { uploadedAt: 'desc' }, select: publicFields }) : Promise.resolve([]);
  }

  /** Short-lived download link for a document the caller is already authorised to see. */
  downloadLink(documentId: string) {
    const { token, expiresAt } = signLink(this.secret(), documentId, 'download', this.ttl());
    return { url: `${this.baseUrl()}/documents/${documentId}/content?token=${encodeURIComponent(token)}`, expiresAt };
  }

  async ownedDownloadLink(owner: DocumentOwner, documentId: string) {
    const document = await this.ownedDocument(owner, documentId);
    if (document.status === 'PENDING_UPLOAD') throw AppError.notFound();
    return this.downloadLink(documentId);
  }

  /** Signed-link download: the token is the only authorisation, so it is checked before anything else. */
  async openContent(documentId: string, token: string | undefined) {
    if (!verifyLink(this.secret(), token, documentId, 'download')) throw AppError.forbidden('The document link is invalid or has expired.');
    const document = await this.prisma.document.findUnique({ where: { id: documentId } });
    if (!document || document.status === 'PENDING_UPLOAD') throw AppError.notFound();
    return { stream: await this.storage.read(document.objectKey), mimeType: document.mimeType, fileName: document.fileName, sizeBytes: document.sizeBytes };
  }

  /** Documents of another owner answer 404, never 403, so their existence does not leak (spec §8). */
  private async ownedDocument(owner: DocumentOwner, documentId: string) {
    const document = await this.prisma.document.findFirst({ where: { id: documentId, ownerType: owner.ownerType, ownerId: owner.ownerId } });
    if (!document) throw AppError.notFound();
    return document;
  }

  private secret() {
    return this.config.getOrThrow<string>('STORAGE_SIGNING_SECRET');
  }

  private ttl() {
    return this.config.get<number>('DOCUMENT_URL_TTL_SECONDS', 300);
  }

  private baseUrl() {
    return this.config.getOrThrow<string>('API_PUBLIC_URL').replace(/\/$/, '');
  }
}
