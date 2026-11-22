import { Body, Controller, Get, HttpCode, HttpStatus, Param, ParseUUIDPipe, Patch, Post, Query, Req } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import { CurrentFacility, Public, RequireFacility, RequirePlatform } from '../../common/access/access.decorators';
import type { AuthenticatedRequest, FacilityScope } from '../../common/access/auth-context';
import { AppError } from '../../common/errors/app-error';
import { auditSource } from '../audit/audit.service';
import { DocumentsService } from '../documents/documents.service';
import { FACILITY_PERMISSIONS as CLINIC, PLATFORM_PERMISSIONS as PLATFORM } from '../users-access/permissions.catalog';
import {
  AdminCreateFacilityDto,
  ApplicationQueryDto,
  ClinicRegistrationDto,
  DocumentCompleteDto,
  DocumentUploadInitDto,
  FacilityQueryDto,
  FacilityStatusDto,
  ReviewDecisionDto,
  UpdateFacilityProfileDto,
} from './dto/facility.dto';
import { FacilitiesService, LOCKED_FOR_REVIEW } from './facilities.service';
import { VerificationService } from './verification.service';

const platformSource = (request: AuthenticatedRequest) => ({ ...auditSource(request, 'PLATFORM'), actorId: request.auth!.userId });
const clinicSource = (request: AuthenticatedRequest) => ({ ...auditSource(request, 'FACILITY'), actorId: request.auth!.userId });

/** `POST /clinic-registration`: public self-onboarding (spec §5.1). */
@ApiTags('Clinic registration')
@Controller('clinic-registration')
export class ClinicRegistrationController {
  constructor(private readonly facilities: FacilitiesService) {}

  @Post()
  @Public()
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  register(@Body() body: ClinicRegistrationDto, @Req() request: AuthenticatedRequest) {
    return this.facilities.register(body, auditSource(request, 'PUBLIC'));
  }
}

@ApiTags('Admin: Facilities')
@ApiBearerAuth()
@Controller('admin/facilities')
export class AdminFacilitiesController {
  constructor(private readonly facilities: FacilitiesService) {}

  @Get()
  @RequirePlatform(PLATFORM.facilityRead)
  list(@Query() query: FacilityQueryDto) {
    return this.facilities.list(query);
  }

  @Post()
  @RequirePlatform(PLATFORM.facilityCreate)
  create(@Body() body: AdminCreateFacilityDto, @Req() request: AuthenticatedRequest) {
    return this.facilities.adminCreate(body, platformSource(request));
  }

  @Get(':id')
  @RequirePlatform(PLATFORM.facilityRead)
  detail(@Param('id', ParseUUIDPipe) id: string) {
    return this.facilities.detail(id);
  }

  @Patch(':id')
  @RequirePlatform(PLATFORM.facilityUpdate)
  update(@Param('id', ParseUUIDPipe) id: string, @Body() body: UpdateFacilityProfileDto, @Req() request: AuthenticatedRequest) {
    return this.facilities.updateProfile(id, body, platformSource(request), 'PLATFORM');
  }

  @Post(':id/status')
  @RequirePlatform(PLATFORM.facilityStatus)
  @HttpCode(HttpStatus.OK)
  status(@Param('id', ParseUUIDPipe) id: string, @Body() body: FacilityStatusDto, @Req() request: AuthenticatedRequest) {
    return this.facilities.changeStatus(id, body, platformSource(request));
  }

  @Post(':id/resend-invitation')
  @RequirePlatform(PLATFORM.facilityCreate)
  @HttpCode(HttpStatus.NO_CONTENT)
  async resendInvitation(@Param('id', ParseUUIDPipe) id: string, @Req() request: AuthenticatedRequest) {
    await this.facilities.resendInvitation(id, platformSource(request));
  }
}

@ApiTags('Admin: Facility applications')
@ApiBearerAuth()
@Controller('admin/facility-applications')
export class AdminFacilityApplicationsController {
  constructor(private readonly verification: VerificationService) {}

  @Get()
  @RequirePlatform(PLATFORM.facilityReview)
  list(@Query() query: ApplicationQueryDto) {
    return this.verification.list(query);
  }

  @Get(':id')
  @RequirePlatform(PLATFORM.facilityReview)
  detail(@Param('id', ParseUUIDPipe) id: string) {
    return this.verification.detail(id);
  }

  @Post(':id/start-review')
  @RequirePlatform(PLATFORM.facilityReview)
  @HttpCode(HttpStatus.OK)
  startReview(@Param('id', ParseUUIDPipe) id: string, @Req() request: AuthenticatedRequest) {
    return this.verification.startReview(id, platformSource(request));
  }

  @Post(':id/reviews')
  @RequirePlatform(PLATFORM.facilityReview)
  @HttpCode(HttpStatus.OK)
  review(@Param('id', ParseUUIDPipe) id: string, @Body() body: ReviewDecisionDto, @Req() request: AuthenticatedRequest) {
    return this.verification.decide(id, body, platformSource(request));
  }
}

/** Clinic routes act on the caller's own facility, resolved from their membership (spec §3). */
@ApiTags('Clinic: Profile & verification')
@ApiBearerAuth()
@Controller('clinic')
export class ClinicFacilityController {
  constructor(
    private readonly facilities: FacilitiesService,
    private readonly verification: VerificationService,
    private readonly documents: DocumentsService,
  ) {}

  @Get('profile')
  @RequireFacility(CLINIC.profileRead)
  profile(@CurrentFacility() scope: FacilityScope) {
    return this.facilities.detail(scope.facilityId);
  }

  @Patch('profile')
  @RequireFacility(CLINIC.profileUpdate)
  updateProfile(@CurrentFacility() scope: FacilityScope, @Body() body: UpdateFacilityProfileDto, @Req() request: AuthenticatedRequest) {
    return this.facilities.updateProfile(scope.facilityId, body, clinicSource(request), 'CLINIC');
  }

  @Get('verification')
  @RequireFacility(CLINIC.profileRead)
  verificationState(@CurrentFacility() scope: FacilityScope) {
    return this.verification.clinicState(scope.facilityId);
  }

  @Get('verification/history')
  @RequireFacility(CLINIC.profileRead)
  verificationHistory(@CurrentFacility() scope: FacilityScope) {
    return this.verification.history(scope.facilityId);
  }

  @Post('verification/submit')
  @RequireFacility(CLINIC.verificationSubmit)
  @HttpCode(HttpStatus.OK)
  submit(@CurrentFacility() scope: FacilityScope, @Req() request: AuthenticatedRequest) {
    return this.verification.submit(scope.facilityId, clinicSource(request));
  }

  @Get('documents')
  @RequireFacility(CLINIC.documentManage)
  listDocuments(@CurrentFacility() scope: FacilityScope) {
    return this.documents.listForOwner({ ownerType: 'FACILITY', ownerId: scope.facilityId });
  }

  @Post('documents/upload-init')
  @RequireFacility(CLINIC.documentManage)
  async uploadInit(@CurrentFacility() scope: FacilityScope, @Body() body: DocumentUploadInitDto, @Req() request: AuthenticatedRequest) {
    const facility = await this.facilities.detail(scope.facilityId);
    if (LOCKED_FOR_REVIEW.includes(facility.verificationStatus)) throw AppError.conflict('FACILITY_LOCKED_FOR_REVIEW', 'Documents cannot be changed while the verification is being reviewed.');
    return this.documents.initUpload({ ownerType: 'FACILITY', ownerId: scope.facilityId }, body, request.auth!.userId);
  }

  @Post('documents/complete')
  @RequireFacility(CLINIC.documentManage)
  @HttpCode(HttpStatus.OK)
  complete(@CurrentFacility() scope: FacilityScope, @Body() body: DocumentCompleteDto, @Req() request: AuthenticatedRequest) {
    return this.documents.completeUpload({ ownerType: 'FACILITY', ownerId: scope.facilityId }, body.documentId, clinicSource(request));
  }

  @Get('documents/:id/url')
  @RequireFacility(CLINIC.documentManage)
  documentUrl(@CurrentFacility() scope: FacilityScope, @Param('id', ParseUUIDPipe) id: string) {
    return this.documents.ownedDownloadLink({ ownerType: 'FACILITY', ownerId: scope.facilityId }, id);
  }
}
