import { Body, Controller, Delete, Get, Headers, HttpCode, HttpStatus, Param, ParseUUIDPipe, Patch, Post, Query, Req, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiHeader, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import { CurrentFacility, Public, RequireFacility, RequirePlatform } from '../../common/access/access.decorators';
import type { AuthenticatedRequest, FacilityScope } from '../../common/access/auth-context';
import { AppError } from '../../common/errors/app-error';
import { auditSource } from '../audit/audit.service';
import { FACILITY_PERMISSIONS as CLINIC, PLATFORM_PERMISSIONS as PLATFORM } from '../users-access/permissions.catalog';
import { BookingKeyGuard } from './booking-key.guard';
import { BookingsService } from './bookings.service';
import { AdminOrderQueryDto, AssignPractitionerDto, CancelOrderDto, CreateBookingDto, ItemStatusDto, NoShowOrderDto, OrderQueryDto, RejectOrderDto, RescheduleOrderDto, RescheduleSlotsQueryDto } from './dto/order.dto';
import { OrdersService } from './orders.service';

const clinicSource = (request: AuthenticatedRequest) => ({ ...auditSource(request, 'FACILITY'), actorId: request.auth!.userId });

/** Customer bookings, called by the customer app's backend with its machine key (spec §8). */
@ApiTags('Bookings')
@ApiBearerAuth('bookingKey')
@Controller('bookings')
export class BookingsController {
  constructor(private readonly bookings: BookingsService) {}

  @Post()
  @ApiOperation({ summary: 'Create a customer booking', description: 'Server-to-server: use BOOKINGS_API_KEY as the Bearer token, not an admin JWT. Reusing an Idempotency-Key with the same payload returns the same booking; changing the payload returns a conflict. Pending bookings do not reserve capacity. Returns 503 when bookings are disabled.' })
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
  @ApiOperation({ summary: 'Approve the whole order and reserve capacity', description: 'When opt-in approval expiry is enabled, late pending orders are committed as EXPIRED and return 409 ORDER_APPROVAL_EXPIRED without reserving capacity. A concurrent expiry may return another state conflict; reload the order. Confirmed orders are never expired.' })
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

  @Post(':id/cancel')
  @ApiOperation({ summary: 'Cancel a pending or confirmed clinic order', description: 'Requires order:approve. Reason required (5–1000 characters). Atomically cancels before visit start, releases confirmed capacity, retires assignments and records history/audit/outbox. Does not change payment or issue a refund. Concurrent/repeated changes return 409.' })
  @RequireFacility(CLINIC.orderApprove)
  @HttpCode(HttpStatus.OK)
  cancel(@CurrentFacility() scope: FacilityScope, @Param('id', ParseUUIDPipe) id: string, @Body() body: CancelOrderDto, @Req() request: AuthenticatedRequest) {
    return this.orders.cancel(scope.facilityId, id, body, clinicSource(request));
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

  @Get(':id/reschedule-slots')
  @ApiOperation({ summary: 'Find replacement slots using the order snapshot duration', description: 'Requires order:approve. Local clinic date, future slots within 60 days. Practitioner conflicts are checked when committing the move.' })
  @RequireFacility(CLINIC.orderApprove)
  rescheduleSlots(@CurrentFacility() scope: FacilityScope, @Param('id', ParseUUIDPipe) id: string, @Query() query: RescheduleSlotsQueryDto) {
    return this.orders.rescheduleSlots(scope.facilityId, id, query.date);
  }

  @Post(':id/reschedule')
  @ApiOperation({ summary: 'Reschedule a future confirmed visit atomically', description: 'Requires order:approve, current version and reason (5–1000 chars). Only unstarted, future CONFIRMED orders. Keeps clinic, mode, items, prices, payment and assignments; rechecks assigned practitioners/affiliations/conflicts. New reservation, old release, time/version, history, audit and outbox commit together. Full/blocked/past/over-horizon slots and stale versions return conflicts; no fee/refund.' })
  @RequireFacility(CLINIC.orderApprove)
  @HttpCode(HttpStatus.OK)
  reschedule(@CurrentFacility() scope: FacilityScope, @Param('id', ParseUUIDPipe) id: string, @Body() body: RescheduleOrderDto, @Req() request: AuthenticatedRequest) {
    return this.orders.reschedule(scope.facilityId, id, body, clinicSource(request));
  }

  @Post(':id/no-show')
  @ApiOperation({ summary: 'Record a patient no-show manually', description: 'Requires order:progress. Only CONFIRMED orders with all items still PENDING, after scheduledAt plus total item duration × quantity. Reason: 5–1000 characters. Atomically records NO_SHOW, NOT_PERFORMED items with history, retires assignments, audits and queues notification. Historical slot reservation, prices and payment remain unchanged; no penalty/refund or automatic no-show.' })
  @RequireFacility(CLINIC.orderProgress)
  @HttpCode(HttpStatus.OK)
  noShow(@CurrentFacility() scope: FacilityScope, @Param('id', ParseUUIDPipe) id: string, @Body() body: NoShowOrderDto, @Req() request: AuthenticatedRequest) {
    return this.orders.noShow(scope.facilityId, id, body, clinicSource(request));
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
