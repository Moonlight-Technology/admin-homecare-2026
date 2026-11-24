import { Body, Controller, Get, HttpCode, HttpStatus, Param, ParseUUIDPipe, Post, Req } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { CurrentFacility, RequireFacility, RequirePlatform } from '../../common/access/access.decorators';
import type { AuthenticatedRequest, FacilityScope } from '../../common/access/auth-context';
import { auditSource } from '../audit/audit.service';
import { FACILITY_PERMISSIONS as C, PLATFORM_PERMISSIONS as P } from '../users-access/permissions.catalog';
import { PractitionerDocumentCompleteDto, PractitionerDocumentUploadDto } from './dto/practitioner-document.dto';
import { PractitionerDocumentsService } from './practitioner-documents.service';

@ApiTags('Admin: Practitioner documents')
@Controller('admin/practitioners/:id')
export class AdminPractitionerDocumentsController {
  constructor(private readonly documents: PractitionerDocumentsService) {}

  @Get('documents') @RequirePlatform(P.practitionerReview)
  list(@Param('id', ParseUUIDPipe) id: string) { return this.documents.list(id, { kind: 'PLATFORM' }); }

  @Post('credentials/:credentialId/documents/upload-init') @RequirePlatform(P.practitionerReview)
  init(@Param('id', ParseUUIDPipe) id: string, @Param('credentialId', ParseUUIDPipe) credentialId: string, @Body() body: PractitionerDocumentUploadDto, @Req() req: AuthenticatedRequest) { return this.documents.init(id, credentialId, body, { kind: 'PLATFORM' }, { ...auditSource(req, 'PLATFORM'), actorId: req.auth!.userId }); }

  @Post('credentials/:credentialId/documents/complete') @HttpCode(HttpStatus.OK) @RequirePlatform(P.practitionerReview)
  complete(@Param('id', ParseUUIDPipe) id: string, @Param('credentialId', ParseUUIDPipe) credentialId: string, @Body() body: PractitionerDocumentCompleteDto, @Req() req: AuthenticatedRequest) { return this.documents.complete(id, credentialId, body.documentId, { kind: 'PLATFORM' }, { ...auditSource(req, 'PLATFORM'), actorId: req.auth!.userId }); }

  @Get('credentials/:credentialId/documents/:documentId/url') @RequirePlatform(P.practitionerReview)
  link(@Param('id', ParseUUIDPipe) id: string, @Param('credentialId', ParseUUIDPipe) credentialId: string, @Param('documentId', ParseUUIDPipe) documentId: string, @Req() req: AuthenticatedRequest) { return this.documents.link(id, credentialId, documentId, { kind: 'PLATFORM' }, auditSource(req, 'PLATFORM')); }
}

@ApiTags('Clinic: Practitioner documents')
@Controller('clinic/practitioners/:id')
export class ClinicPractitionerDocumentsController {
  constructor(private readonly documents: PractitionerDocumentsService) {}

  @Get('documents') @RequireFacility(C.affiliationManage)
  list(@Param('id', ParseUUIDPipe) id: string, @CurrentFacility() scope: FacilityScope) { return this.documents.list(id, { kind: 'CLINIC', facilityId: scope.facilityId }); }

  @Post('credentials/:credentialId/documents/upload-init') @RequireFacility(C.affiliationManage)
  init(@Param('id', ParseUUIDPipe) id: string, @Param('credentialId', ParseUUIDPipe) credentialId: string, @CurrentFacility() scope: FacilityScope, @Body() body: PractitionerDocumentUploadDto, @Req() req: AuthenticatedRequest) { return this.documents.init(id, credentialId, body, { kind: 'CLINIC', facilityId: scope.facilityId }, { ...auditSource(req, 'FACILITY'), actorId: req.auth!.userId }); }

  @Post('credentials/:credentialId/documents/complete') @HttpCode(HttpStatus.OK) @RequireFacility(C.affiliationManage)
  complete(@Param('id', ParseUUIDPipe) id: string, @Param('credentialId', ParseUUIDPipe) credentialId: string, @CurrentFacility() scope: FacilityScope, @Body() body: PractitionerDocumentCompleteDto, @Req() req: AuthenticatedRequest) { return this.documents.complete(id, credentialId, body.documentId, { kind: 'CLINIC', facilityId: scope.facilityId }, { ...auditSource(req, 'FACILITY'), actorId: req.auth!.userId }); }

  @Get('credentials/:credentialId/documents/:documentId/url') @RequireFacility(C.affiliationManage)
  link(@Param('id', ParseUUIDPipe) id: string, @Param('credentialId', ParseUUIDPipe) credentialId: string, @Param('documentId', ParseUUIDPipe) documentId: string, @CurrentFacility() scope: FacilityScope, @Req() req: AuthenticatedRequest) { return this.documents.link(id, credentialId, documentId, { kind: 'CLINIC', facilityId: scope.facilityId }, auditSource(req, 'FACILITY')); }
}
