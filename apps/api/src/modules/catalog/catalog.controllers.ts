import { Body, Controller, Get, HttpCode, HttpStatus, Param, ParseUUIDPipe, Patch, Post, Query, Req } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { CurrentFacility, Public, RequireFacility } from '../../common/access/access.decorators';
import type { AuthenticatedRequest, FacilityScope } from '../../common/access/auth-context';
import { auditSource } from '../audit/audit.service';
import { FACILITY_PERMISSIONS as CLINIC } from '../users-access/permissions.catalog';
import { CreateOfferingDto, OfferingQueryDto, PublicFacilityQueryDto, PublicOfferingQueryDto, UpdateOfferingDto } from './dto/offering.dto';
import { OfferingsService } from './offerings.service';
import { PublicCatalogService } from './public-catalog.service';

const clinicSource = (request: AuthenticatedRequest) => ({ ...auditSource(request, 'FACILITY'), actorId: request.auth!.userId });

/** Clinic routes act on the caller's own facility, resolved from their membership (spec §3). */
@ApiTags('Clinic: Offerings')
@ApiBearerAuth()
@Controller('clinic/offerings')
export class ClinicOfferingsController {
  constructor(private readonly offerings: OfferingsService) {}

  @Get('options')
  @RequireFacility(CLINIC.offeringRead)
  options() {
    return this.offerings.options();
  }

  @Get()
  @RequireFacility(CLINIC.offeringRead)
  list(@CurrentFacility() scope: FacilityScope, @Query() query: OfferingQueryDto) {
    return this.offerings.list(scope.facilityId, query);
  }

  @Post()
  @RequireFacility(CLINIC.offeringCreate)
  create(@CurrentFacility() scope: FacilityScope, @Body() body: CreateOfferingDto, @Req() request: AuthenticatedRequest) {
    return this.offerings.create(scope.facilityId, body, clinicSource(request));
  }

  @Get(':id')
  @RequireFacility(CLINIC.offeringRead)
  detail(@CurrentFacility() scope: FacilityScope, @Param('id', ParseUUIDPipe) id: string) {
    return this.offerings.detail(scope.facilityId, id);
  }

  @Patch(':id')
  @RequireFacility(CLINIC.offeringUpdate)
  update(@CurrentFacility() scope: FacilityScope, @Param('id', ParseUUIDPipe) id: string, @Body() body: UpdateOfferingDto, @Req() request: AuthenticatedRequest) {
    return this.offerings.update(scope.facilityId, id, body, clinicSource(request));
  }

  @Post(':id/publish')
  @RequireFacility(CLINIC.offeringPublish)
  @HttpCode(HttpStatus.OK)
  publish(@CurrentFacility() scope: FacilityScope, @Param('id', ParseUUIDPipe) id: string, @Req() request: AuthenticatedRequest) {
    return this.offerings.publish(scope.facilityId, id, clinicSource(request));
  }

  @Post(':id/unpublish')
  @RequireFacility(CLINIC.offeringPublish)
  @HttpCode(HttpStatus.OK)
  unpublish(@CurrentFacility() scope: FacilityScope, @Param('id', ParseUUIDPipe) id: string, @Req() request: AuthenticatedRequest) {
    return this.offerings.unpublish(scope.facilityId, id, clinicSource(request));
  }

  @Post(':id/archive')
  @RequireFacility(CLINIC.offeringUpdate)
  @HttpCode(HttpStatus.OK)
  archive(@CurrentFacility() scope: FacilityScope, @Param('id', ParseUUIDPipe) id: string, @Req() request: AuthenticatedRequest) {
    return this.offerings.archive(scope.facilityId, id, clinicSource(request));
  }
}

/** Customer-facing discovery (spec §8); read-only and limited to verified, active clinics. */
@ApiTags('Public: Catalog')
@Controller('public/facilities')
export class PublicCatalogController {
  constructor(private readonly catalog: PublicCatalogService) {}

  @Get()
  @Public()
  facilities(@Query() query: PublicFacilityQueryDto) {
    return this.catalog.facilities(query);
  }

  @Get(':id')
  @Public()
  facility(@Param('id', ParseUUIDPipe) id: string) {
    return this.catalog.facility(id);
  }

  @Get(':id/offerings')
  @Public()
  offerings(@Param('id', ParseUUIDPipe) id: string, @Query() query: PublicOfferingQueryDto) {
    return this.catalog.offerings(id, query);
  }
}
