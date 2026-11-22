import { Body, Controller, Get, HttpCode, HttpStatus, Param, ParseUUIDPipe, Patch, Post, Query, Req } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import { CurrentFacility, RequireFacility, RequirePlatform } from '../../common/access/access.decorators';
import type { AuthenticatedRequest, FacilityScope } from '../../common/access/auth-context';
import { auditSource } from '../audit/audit.service';
import { FACILITY_PERMISSIONS as CLINIC, PLATFORM_PERMISSIONS as PLATFORM } from '../users-access/permissions.catalog';
import { AffiliationsService } from './affiliations.service';
import {
  AffiliationQueryDto,
  AffiliationReviewDto,
  CreatePractitionerDto,
  CredentialInputDto,
  PractitionerLookupDto,
  PractitionerQueryDto,
  PractitionerReviewDto,
  PractitionerStatusDto,
  ProposeAffiliationDto,
  UpdateAffiliationDto,
  UpdatePractitionerDto,
} from './dto/practitioner.dto';
import { PractitionersService } from './practitioners.service';

const platformSource = (request: AuthenticatedRequest) => ({ ...auditSource(request, 'PLATFORM'), actorId: request.auth!.userId });
const clinicSource = (request: AuthenticatedRequest) => ({ ...auditSource(request, 'FACILITY'), actorId: request.auth!.userId });

@ApiTags('Admin: Practitioners')
@ApiBearerAuth()
@Controller('admin/practitioners')
export class AdminPractitionersController {
  constructor(private readonly practitioners: PractitionersService) {}

  @Get()
  @RequirePlatform(PLATFORM.practitionerRead)
  list(@Query() query: PractitionerQueryDto) {
    return this.practitioners.list(query);
  }

  @Post()
  @RequirePlatform(PLATFORM.practitionerReview)
  async create(@Body() body: CreatePractitionerDto, @Req() request: AuthenticatedRequest) {
    const id = await this.practitioners.register(body, { via: 'ADMIN' }, platformSource(request));
    return this.practitioners.detail(id);
  }

  @Get(':id')
  @RequirePlatform(PLATFORM.practitionerRead)
  detail(@Param('id', ParseUUIDPipe) id: string) {
    return this.practitioners.detail(id);
  }

  @Patch(':id')
  @RequirePlatform(PLATFORM.practitionerReview)
  update(@Param('id', ParseUUIDPipe) id: string, @Body() body: UpdatePractitionerDto, @Req() request: AuthenticatedRequest) {
    return this.practitioners.update(id, body, platformSource(request));
  }

  @Post(':id/credentials')
  @RequirePlatform(PLATFORM.practitionerReview)
  addCredential(@Param('id', ParseUUIDPipe) id: string, @Body() body: CredentialInputDto, @Req() request: AuthenticatedRequest) {
    return this.practitioners.addCredential(id, body, platformSource(request));
  }

  @Post(':id/credentials/:credentialId/reveal')
  @RequirePlatform(PLATFORM.practitionerReview)
  @HttpCode(HttpStatus.OK)
  reveal(@Param('id', ParseUUIDPipe) id: string, @Param('credentialId', ParseUUIDPipe) credentialId: string, @Req() request: AuthenticatedRequest) {
    return this.practitioners.revealCredential(id, credentialId, platformSource(request));
  }

  @Post(':id/submit')
  @RequirePlatform(PLATFORM.practitionerReview)
  @HttpCode(HttpStatus.OK)
  submit(@Param('id', ParseUUIDPipe) id: string, @Req() request: AuthenticatedRequest) {
    return this.practitioners.submit(id, platformSource(request));
  }

  @Post(':id/start-review')
  @RequirePlatform(PLATFORM.practitionerReview)
  @HttpCode(HttpStatus.OK)
  startReview(@Param('id', ParseUUIDPipe) id: string, @Req() request: AuthenticatedRequest) {
    return this.practitioners.startReview(id, platformSource(request));
  }

  @Post(':id/reviews')
  @RequirePlatform(PLATFORM.practitionerReview)
  @HttpCode(HttpStatus.OK)
  review(@Param('id', ParseUUIDPipe) id: string, @Body() body: PractitionerReviewDto, @Req() request: AuthenticatedRequest) {
    return this.practitioners.decide(id, body, platformSource(request));
  }

  @Post(':id/status')
  @RequirePlatform(PLATFORM.practitionerStatus)
  @HttpCode(HttpStatus.OK)
  status(@Param('id', ParseUUIDPipe) id: string, @Body() body: PractitionerStatusDto, @Req() request: AuthenticatedRequest) {
    return this.practitioners.changeStatus(id, body, platformSource(request));
  }
}

@ApiTags('Admin: Practitioner affiliations')
@ApiBearerAuth()
@Controller('admin/practitioner-affiliations')
export class AdminAffiliationsController {
  constructor(private readonly affiliations: AffiliationsService) {}

  @Get()
  @RequirePlatform(PLATFORM.practitionerRead)
  list(@Query() query: AffiliationQueryDto) {
    return this.affiliations.adminList(query);
  }

  @Post(':id/reviews')
  @RequirePlatform(PLATFORM.practitionerReview)
  @HttpCode(HttpStatus.OK)
  review(@Param('id', ParseUUIDPipe) id: string, @Body() body: AffiliationReviewDto, @Req() request: AuthenticatedRequest) {
    return this.affiliations.adminDecide(id, body, platformSource(request));
  }
}

/** Clinic routes act on the caller's own facility, resolved from their membership (spec §3). */
@ApiTags('Clinic: Practitioners')
@ApiBearerAuth()
@Controller('clinic')
export class ClinicPractitionersController {
  constructor(
    private readonly practitioners: PractitionersService,
    private readonly affiliations: AffiliationsService,
  ) {}

  /** POST so the STR number never lands in URLs or access logs; throttled against enumeration. */
  @Post('practitioners/lookup')
  @RequireFacility(CLINIC.affiliationManage)
  @Throttle({ default: { limit: 20, ttl: 60_000 } })
  @HttpCode(HttpStatus.OK)
  lookup(@Body() body: PractitionerLookupDto) {
    return this.practitioners.lookupByStr(body.strNumber);
  }

  @Get('practitioner-affiliations')
  @RequireFacility(CLINIC.affiliationRead)
  list(@CurrentFacility() scope: FacilityScope, @Query() query: AffiliationQueryDto) {
    return this.affiliations.listForFacility(scope.facilityId, query);
  }

  @Post('practitioner-affiliations')
  @RequireFacility(CLINIC.affiliationManage)
  propose(@CurrentFacility() scope: FacilityScope, @Body() body: ProposeAffiliationDto, @Req() request: AuthenticatedRequest) {
    return this.affiliations.propose(scope.facilityId, body, clinicSource(request));
  }

  @Patch('practitioner-affiliations/:id')
  @RequireFacility(CLINIC.affiliationManage)
  update(@CurrentFacility() scope: FacilityScope, @Param('id', ParseUUIDPipe) id: string, @Body() body: UpdateAffiliationDto, @Req() request: AuthenticatedRequest) {
    return this.affiliations.updateByClinic(scope.facilityId, id, body, clinicSource(request));
  }
}
