import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { AppError } from '../../common/errors/app-error';
import { PrismaService, type Db } from '../../prisma/prisma.service';
import { AuditService, type AuditSource } from '../audit/audit.service';
import { DocumentsService } from '../documents/documents.service';
import type { PractitionerDocumentUploadDto } from './dto/practitioner-document.dto';

export const DOCUMENT_EDITABLE = ['DRAFT', 'SUBMITTED', 'REVISION_REQUIRED', 'REJECTED'] as const;
const documentSelect = { id: true, fileName: true, mimeType: true, sizeBytes: true, status: true, uploadedAt: true } satisfies Prisma.DocumentSelect;
type Access = { kind: 'PLATFORM' } | { kind: 'CLINIC'; facilityId: string };

@Injectable()
export class PractitionerDocumentsService {
  constructor(private readonly prisma: PrismaService, private readonly documents: DocumentsService, private readonly audit: AuditService) {}

  /** Clinics see only credentials of practitioners they registered AND still have a live affiliation with. */
  async list(id: string, access: Access) {
    const practitioner = await this.authorize(this.prisma, id, access);
    const credentials = await this.prisma.practitionerCredential.findMany({ where: { practitionerId: id }, select: { id: true, credentialType: true, numberMasked: true, document: { select: documentSelect } }, orderBy: { createdAt: 'asc' } });
    return { practitionerId: id, verificationStatus: practitioner.verificationStatus, editable: (DOCUMENT_EDITABLE as readonly string[]).includes(practitioner.verificationStatus), credentials };
  }

  init(id: string, credentialId: string, input: PractitionerDocumentUploadDto, access: Access, source: AuditSource & { actorId: string }) {
    return this.write(async (tx) => {
      await this.lockEditable(tx, id, access);
      await this.credential(tx, id, credentialId);
      const result = await this.documents.initCredentialUpload(id, credentialId, input, source.actorId, tx);
      await this.audit.record(source, { event: 'PRACTITIONER_DOCUMENT_UPLOAD_INITIATED', entityType: 'Practitioner', entityId: id, facilityId: access.kind === 'CLINIC' ? access.facilityId : null, after: { credentialId, documentId: result.document.id } }, tx);
      return result;
    });
  }

  complete(id: string, credentialId: string, documentId: string, access: Access, source: AuditSource & { actorId: string }) {
    return this.write(async (tx) => {
      await this.lockEditable(tx, id, access);
      const credential = await this.credential(tx, id, credentialId);
      const document = await this.documents.completeUpload({ ownerType: 'PRACTITIONER', ownerId: id }, documentId, source, tx, credentialId);
      await tx.practitionerCredential.update({ where: { id: credentialId }, data: { documentId, reviewStatus: 'UPLOADED' } });
      await this.audit.record(source, { event: 'PRACTITIONER_DOCUMENT_ATTACHED', entityType: 'Practitioner', entityId: id, facilityId: access.kind === 'CLINIC' ? access.facilityId : null, before: { credentialId, documentId: credential.documentId }, after: { credentialId, documentId } }, tx);
      return document;
    });
  }

  async link(id: string, credentialId: string, documentId: string, access: Access, source: AuditSource) {
    await this.authorize(this.prisma, id, access);
    await this.credential(this.prisma, id, credentialId);
    const link = await this.documents.ownedDownloadLink({ ownerType: 'PRACTITIONER', ownerId: id }, documentId, credentialId);
    await this.audit.record(source, { event: 'PRACTITIONER_DOCUMENT_LINK_ISSUED', entityType: 'Practitioner', entityId: id, facilityId: access.kind === 'CLINIC' ? access.facilityId : null, after: { credentialId, documentId } });
    return link;
  }

  private async authorize(db: Db, id: string, access: Access) {
    const practitioner = await db.practitioner.findFirst({ where: { id, ...(access.kind === 'CLINIC' ? { createdByFacilityId: access.facilityId, affiliations: { some: { facilityId: access.facilityId, status: { in: ['PROPOSED', 'ACTIVE'] } } } } : {}) }, select: { id: true, verificationStatus: true } });
    if (!practitioner) throw AppError.notFound();
    return practitioner;
  }

  private async lockEditable(tx: Db, id: string, access: Access) {
    await this.authorize(tx, id, access);
    // Coordinate with the existing review transition's practitioner row lock: attachment and decision cannot cross.
    const locked = await tx.practitioner.updateMany({ where: { id, verificationStatus: { in: [...DOCUMENT_EDITABLE] } }, data: { updatedAt: new Date() } });
    if (!locked.count) throw AppError.conflict('PRACTITIONER_DOCUMENTS_LOCKED', 'Dokumen dikunci saat sedang direview atau sudah terverifikasi. Minta revisi sebelum mengganti berkas.');
  }

  private async credential(db: Db, id: string, credentialId: string) {
    const credential = await db.practitionerCredential.findFirst({ where: { id: credentialId, practitionerId: id, credentialType: { in: ['STR', 'SIP'] } }, select: { id: true, documentId: true } });
    if (!credential) throw AppError.notFound();
    return credential;
  }

  private async write<T>(run: (tx: Db) => Promise<T>): Promise<T> {
    for (let attempt = 0; ; attempt++) {
      try { return await this.prisma.$transaction(run, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable }); }
      catch (error) {
        if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2034') {
          if (attempt < 2) continue;
          throw AppError.conflict('CONCURRENT_CHANGE', 'Data berubah bersamaan. Muat ulang dan coba lagi.');
        }
        throw error;
      }
    }
  }
}
