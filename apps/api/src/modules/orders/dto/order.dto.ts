import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import { ArrayMaxSize, ArrayMinSize, IsArray, IsDateString, IsIn, IsInt, IsLatitude, IsLongitude, IsOptional, IsString, IsUUID, Matches, Max, MaxLength, Min, MinLength, ValidateNested } from 'class-validator';
import { PaginationQueryDto } from '../../../common/dto/pagination.dto';
import { FULFILLMENT_MODES, type FulfillmentModeName } from '../../catalog/dto/offering.dto';

const trim = ({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() : value);
const optional = ({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() || null : value);
const PHONE = /^\+?[0-9][0-9\s-]{6,19}$/;
const DATE = /^\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/;

/** Minimum patient data the clinic needs for the visit (spec §5.5 step 4). No clinical information. */
export class BookingPatientDto {
  @ApiProperty({ description: 'Patient id in the customer app.' }) @IsUUID() id: string;
  @ApiProperty({ example: 'Siti Rahma' }) @Transform(trim) @IsString() @MinLength(2) @MaxLength(120) name: string;
  @ApiPropertyOptional({ example: '0812-3456-7890' }) @IsOptional() @Transform(optional) @Matches(PHONE, { message: 'phone must be a valid phone number' }) phone?: string | null;
  @ApiPropertyOptional({ enum: ['FEMALE', 'MALE'] }) @IsOptional() @IsIn(['FEMALE', 'MALE']) sex?: 'FEMALE' | 'MALE';
  @ApiPropertyOptional({ example: 1988 }) @IsOptional() @Type(() => Number) @IsInt() @Min(1900) @Max(2100) birthYear?: number;
}

/** Homecare visit address; on-site visits use the clinic address. */
export class BookingAddressDto {
  @ApiProperty({ example: 'Jl. Kenanga No. 5, RT 02/RW 03' }) @Transform(trim) @IsString() @MinLength(5) @MaxLength(500) line: string;
  @ApiPropertyOptional() @IsOptional() @Transform(optional) @IsString() @MaxLength(20) regionCode?: string | null;
  @ApiPropertyOptional() @IsOptional() @Transform(optional) @Matches(/^[0-9]{5}$/, { message: 'postalCode must be 5 digits' }) postalCode?: string | null;
  @ApiPropertyOptional() @IsOptional() @Type(() => Number) @IsLatitude() latitude?: number;
  @ApiPropertyOptional() @IsOptional() @Type(() => Number) @IsLongitude() longitude?: number;
  @ApiPropertyOptional({ description: 'Directions for the visiting practitioner. No clinical notes.' }) @IsOptional() @Transform(optional) @IsString() @MaxLength(500) note?: string | null;
}

export class BookingItemDto {
  @ApiProperty() @IsUUID() offeringId: string;
  @ApiPropertyOptional({ default: 1, minimum: 1, maximum: 10 }) @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(10) quantity?: number;
}

/**
 * `POST /bookings` (spec §5.5 steps 1–3): one patient, one clinic, one mode, one visit, one or more services from
 * that clinic. Retrying with the same `Idempotency-Key` returns the same order (AC-ORD-10).
 */
export class CreateBookingDto {
  @ApiProperty({ description: 'Customer account id in the customer app.' }) @IsUUID() customerId: string;
  @ApiProperty({ type: BookingPatientDto }) @ValidateNested() @Type(() => BookingPatientDto) patient: BookingPatientDto;
  @ApiProperty() @IsUUID() facilityId: string;
  @ApiProperty({ enum: FULFILLMENT_MODES }) @IsIn(FULFILLMENT_MODES) mode: FulfillmentModeName;
  @ApiProperty({ example: '2026-12-01T01:00:00.000Z', description: 'Slot start from GET /public/facilities/:id/slots.' }) @IsDateString({ strict: true }) scheduledAt: string;
  @ApiProperty({ type: [BookingItemDto] }) @IsArray() @ArrayMinSize(1) @ArrayMaxSize(10) @ValidateNested({ each: true }) @Type(() => BookingItemDto) items: BookingItemDto[];
  @ApiPropertyOptional({ type: BookingAddressDto, description: 'Required for HOMECARE.' }) @IsOptional() @ValidateNested() @Type(() => BookingAddressDto) address?: BookingAddressDto;
}

export const ORDER_STATUSES = ['PENDING_APPROVAL', 'CONFIRMED', 'REJECTED', 'IN_PROGRESS', 'COMPLETED', 'CANCELLED', 'EXPIRED', 'NO_SHOW'] as const;
export const ASSIGNMENT_STATUSES = ['UNASSIGNED', 'PARTIALLY_ASSIGNED', 'ASSIGNED'] as const;

export class OrderQueryDto extends PaginationQueryDto {
  @ApiPropertyOptional({ enum: ORDER_STATUSES }) @IsOptional() @IsIn(ORDER_STATUSES) status?: (typeof ORDER_STATUSES)[number];
  @ApiPropertyOptional({ enum: FULFILLMENT_MODES }) @IsOptional() @IsIn(FULFILLMENT_MODES) mode?: FulfillmentModeName;
  @ApiPropertyOptional({ enum: ASSIGNMENT_STATUSES }) @IsOptional() @IsIn(ASSIGNMENT_STATUSES) assignmentStatus?: (typeof ASSIGNMENT_STATUSES)[number];
  @ApiPropertyOptional({ description: 'First local visit date (YYYY-MM-DD).' }) @IsOptional() @Matches(DATE, { message: 'from must be YYYY-MM-DD' }) from?: string;
  @ApiPropertyOptional({ description: 'Last local visit date (YYYY-MM-DD).' }) @IsOptional() @Matches(DATE, { message: 'to must be YYYY-MM-DD' }) to?: string;
}

export class AdminOrderQueryDto extends OrderQueryDto {
  @ApiPropertyOptional() @IsOptional() @IsUUID() facilityId?: string;
}

export class RejectOrderDto {
  @ApiProperty({ minLength: 5 }) @Transform(trim) @IsString() @MaxLength(1000) reason: string;
}

export class AssignPractitionerDto {
  @ApiProperty() @IsUUID() practitionerId: string;
  @ApiPropertyOptional({ description: 'Assign to one service; omit to assign the whole visit.' }) @IsOptional() @IsUUID() orderItemId?: string;
}

export class ItemStatusDto {
  @ApiProperty({ enum: ['IN_PROGRESS', 'COMPLETED', 'NOT_PERFORMED'] }) @IsIn(['IN_PROGRESS', 'COMPLETED', 'NOT_PERFORMED']) status: 'IN_PROGRESS' | 'COMPLETED' | 'NOT_PERFORMED';
  @ApiPropertyOptional({ description: 'Required for NOT_PERFORMED. Operational reason only, no clinical notes.' }) @IsOptional() @Transform(trim) @IsString() @MaxLength(1000) reason?: string;
}
