import { Body, Controller, Delete, Get, HttpCode, HttpStatus, Param, ParseUUIDPipe, Patch, Post, Query, Req } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { CurrentFacility, Public, RequireFacility } from '../../common/access/access.decorators';
import type { AuthenticatedRequest, FacilityScope } from '../../common/access/auth-context';
import { auditSource } from '../audit/audit.service';
import { FACILITY_PERMISSIONS as CLINIC } from '../users-access/permissions.catalog';
import { AvailabilityService } from './availability.service';
import { BlockQueryDto, ClinicSlotQueryDto, CreateBlockDto, CreateScheduleDto, PublicSlotQueryDto, ScheduleQueryDto, UpdateScheduleDto } from './dto/availability.dto';

const clinicSource = (request: AuthenticatedRequest) => ({ ...auditSource(request, 'FACILITY'), actorId: request.auth!.userId });

/** Clinic routes act on the caller's own facility, resolved from their membership (spec §3). */
@ApiTags('Clinic: Availability')
@ApiBearerAuth()
@Controller('clinic')
export class ClinicAvailabilityController {
  constructor(private readonly availability: AvailabilityService) {}

  @Get('schedules')
  @RequireFacility(CLINIC.scheduleRead)
  schedules(@CurrentFacility() scope: FacilityScope, @Query() query: ScheduleQueryDto) {
    return this.availability.listSchedules(scope.facilityId, query);
  }

  @Post('schedules')
  @RequireFacility(CLINIC.scheduleManage)
  createSchedule(@CurrentFacility() scope: FacilityScope, @Body() body: CreateScheduleDto, @Req() request: AuthenticatedRequest) {
    return this.availability.createSchedule(scope.facilityId, body, clinicSource(request));
  }

  @Patch('schedules/:id')
  @RequireFacility(CLINIC.scheduleManage)
  updateSchedule(@CurrentFacility() scope: FacilityScope, @Param('id', ParseUUIDPipe) id: string, @Body() body: UpdateScheduleDto, @Req() request: AuthenticatedRequest) {
    return this.availability.updateSchedule(scope.facilityId, id, body, clinicSource(request));
  }

  @Get('schedule-blocks')
  @RequireFacility(CLINIC.scheduleRead)
  blocks(@CurrentFacility() scope: FacilityScope, @Query() query: BlockQueryDto) {
    return this.availability.listBlocks(scope.facilityId, query);
  }

  @Post('schedule-blocks')
  @RequireFacility(CLINIC.scheduleManage)
  createBlock(@CurrentFacility() scope: FacilityScope, @Body() body: CreateBlockDto, @Req() request: AuthenticatedRequest) {
    return this.availability.createBlock(scope.facilityId, body, clinicSource(request));
  }

  @Delete('schedule-blocks/:id')
  @RequireFacility(CLINIC.scheduleManage)
  @HttpCode(HttpStatus.NO_CONTENT)
  async deleteBlock(@CurrentFacility() scope: FacilityScope, @Param('id', ParseUUIDPipe) id: string, @Req() request: AuthenticatedRequest) {
    await this.availability.deleteBlock(scope.facilityId, id, clinicSource(request));
  }

  @Get('slots')
  @RequireFacility(CLINIC.scheduleRead)
  slots(@CurrentFacility() scope: FacilityScope, @Query() query: ClinicSlotQueryDto) {
    return this.availability.clinicSlots(scope.facilityId, query);
  }
}

/** Customer-facing availability (spec §8). */
@ApiTags('Public: Catalog')
@Controller('public/facilities')
export class PublicSlotsController {
  constructor(private readonly availability: AvailabilityService) {}

  @Get(':id/slots')
  @Public()
  slots(@Param('id', ParseUUIDPipe) id: string, @Query() query: PublicSlotQueryDto) {
    return this.availability.publicSlots(id, query);
  }
}
