import { Body, Controller, Delete, Get, Headers, HttpCode, HttpStatus, Param, ParseUUIDPipe, Patch, Post, Query, Req, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiHeader, ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import { CurrentFacility, Public, RequireFacility, RequirePlatform } from '../../common/access/access.decorators';
import type { AuthenticatedRequest, FacilityScope } from '../../common/access/auth-context';
import { AppError } from '../../common/errors/app-error';
import { auditSource } from '../audit/audit.service';
import { FACILITY_PERMISSIONS as CLINIC, PLATFORM_PERMISSIONS as PLATFORM } from '../users-access/permissions.catalog';
import { BookingKeyGuard } from './booking-key.guard';
import { BookingsService } from './bookings.service';
import { AdminOrderQueryDto, AssignPractitionerDto, CreateBookingDto, ItemStatusDto, OrderQueryDto, RejectOrderDto } from './dto/order.dto';
import { OrdersService } from './orders.service';

const clinicSource = (request: AuthenticatedRequest) => ({ ...auditSource(request, 'FACILITY'), actorId: request.auth!.userId });

/** Customer bookings, called by the customer app's backend with its machine key (spec §8). */
@ApiTags('Bookings')
@ApiBearerAuth()
@Controller('bookings')
export class BookingsController {
  constructor(private readonly bookings: BookingsService) {}

  @Post()
  @Public()
  @UseGuards(BookingKeyGuard)
  @Throttle({ default: { limit: 60, ttl: 60_000 } })
  @ApiHeader({ name: 'Idempotency-Key', required: true, description: 'Unique per booking attempt; retries reuse it (AC-ORD-10).' })
  create(@Body() body: CreateBookingDto, @Headers('idempotency-key') idempotencyKey: string | undefined) {
    if (!idempotencyKey || !/^[A-Za-z0-9._:-]{8,100}$/.test(idempotencyKey)) {
      throw AppError.unprocessable('VALIDATION_FAILED', 'An Idempotency-Key header of 8–100 characters is required.', { fields: { 'Idempotency-Key': ['header is required'] } });
    }
    return this.bookings.create(body, idempotencyKey);
  }
}

/** Clinic order inbox and fulfilment; always the caller's own facility (spec §3, AC-ORD-07). */
@ApiTags('Clinic: Orders')
@ApiBearerAuth()
@Controller('clinic/orders')
export class ClinicOrdersController {
  constructor(private readonly orders: OrdersService) {}

  @Get()
  @RequireFacility(CLINIC.orderRead)
  list(@CurrentFacility() scope: FacilityScope, @Query() query: OrderQueryDto) {
    return this.orders.list(scope.facilityId, query);
  }

  @Get(':id')
  @RequireFacility(CLINIC.orderRead)
  detail(@CurrentFacility() scope: FacilityScope, @Param('id', ParseUUIDPipe) id: string) {
    return this.orders.detail(scope.facilityId, id);
  }

  @Post(':id/approve')
  @RequireFacility(CLINIC.orderApprove)
  @HttpCode(HttpStatus.OK)
  approve(@CurrentFacility() scope: FacilityScope, @Param('id', ParseUUIDPipe) id: string, @Req() request: AuthenticatedRequest) {
    return this.orders.approve(scope.facilityId, id, clinicSource(request));
  }

  @Post(':id/reject')
  @RequireFacility(CLINIC.orderApprove)
  @HttpCode(HttpStatus.OK)
  reject(@CurrentFacility() scope: FacilityScope, @Param('id', ParseUUIDPipe) id: string, @Body() body: RejectOrderDto, @Req() request: AuthenticatedRequest) {
    return this.orders.reject(scope.facilityId, id, body, clinicSource(request));
  }

  @Get(':id/assignable-practitioners')
  @RequireFacility(CLINIC.orderAssign)
  assignable(@CurrentFacility() scope: FacilityScope, @Param('id', ParseUUIDPipe) id: string) {
    return this.orders.assignablePractitioners(scope.facilityId, id);
  }

  @Post(':id/assignments')
  @RequireFacility(CLINIC.orderAssign)
  assign(@CurrentFacility() scope: FacilityScope, @Param('id', ParseUUIDPipe) id: string, @Body() body: AssignPractitionerDto, @Req() request: AuthenticatedRequest) {
    return this.orders.assign(scope.facilityId, id, body, clinicSource(request));
  }

  @Delete(':id/assignments/:assignmentId')
  @RequireFacility(CLINIC.orderAssign)
  unassign(@CurrentFacility() scope: FacilityScope, @Param('id', ParseUUIDPipe) id: string, @Param('assignmentId', ParseUUIDPipe) assignmentId: string, @Req() request: AuthenticatedRequest) {
    return this.orders.unassign(scope.facilityId, id, assignmentId, clinicSource(request));
  }

  @Post(':id/start')
  @RequireFacility(CLINIC.orderProgress)
  @HttpCode(HttpStatus.OK)
  start(@CurrentFacility() scope: FacilityScope, @Param('id', ParseUUIDPipe) id: string, @Req() request: AuthenticatedRequest) {
    return this.orders.start(scope.facilityId, id, clinicSource(request));
  }

  @Patch(':id/items/:itemId/status')
  @RequireFacility(CLINIC.orderProgress)
  itemStatus(@CurrentFacility() scope: FacilityScope, @Param('id', ParseUUIDPipe) id: string, @Param('itemId', ParseUUIDPipe) itemId: string, @Body() body: ItemStatusDto, @Req() request: AuthenticatedRequest) {
    return this.orders.itemStatus(scope.facilityId, id, itemId, body, clinicSource(request));
  }

  @Post(':id/complete')
  @RequireFacility(CLINIC.orderProgress)
  @HttpCode(HttpStatus.OK)
  complete(@CurrentFacility() scope: FacilityScope, @Param('id', ParseUUIDPipe) id: string, @Req() request: AuthenticatedRequest) {
    return this.orders.complete(scope.facilityId, id, clinicSource(request));
  }
}

/** Platform read views with masked patient data (spec §8); no override actions while those policies are open. */
@ApiTags('Admin: Orders')
@ApiBearerAuth()
@Controller('admin/orders')
export class AdminOrdersController {
  constructor(private readonly orders: OrdersService) {}

  @Get()
  @RequirePlatform(PLATFORM.orderReadAll)
  list(@Query() query: AdminOrderQueryDto) {
    return this.orders.list(null, query, true);
  }

  @Get(':id')
  @RequirePlatform(PLATFORM.orderReadAll)
  detail(@Param('id', ParseUUIDPipe) id: string) {
    return this.orders.adminDetail(id);
  }
}
