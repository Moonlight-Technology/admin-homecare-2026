import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import { ArrayMaxSize, IsArray, IsBoolean, IsIn, IsInt, IsOptional, IsString, IsUUID, Matches, Max, MaxLength, Min } from 'class-validator';
import { FULFILLMENT_MODES, type FulfillmentModeName } from '../../catalog/dto/offering.dto';

const optional = ({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() || null : value);
const TIME = /^([01]\d|2[0-3]):[0-5]\d$/;
const DATE = /^\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/;
/** `a,b,c` in a query string → `['a','b','c']`. */
const csv = ({ value }: { value: unknown }) => (typeof value === 'string' ? value.split(',').map((item) => item.trim()).filter(Boolean) : value);

/** A weekly opening window for one mode, in the facility's local time (spec §4 Schedules). */
export class CreateScheduleDto {
  @ApiProperty({ enum: FULFILLMENT_MODES }) @IsIn(FULFILLMENT_MODES) mode: FulfillmentModeName;
  @ApiProperty({ minimum: 0, maximum: 6, description: '0 = Sunday … 6 = Saturday.' }) @Type(() => Number) @IsInt() @Min(0) @Max(6) dayOfWeek: number;
  @ApiProperty({ example: '08:00' }) @Matches(TIME, { message: 'startTime must be HH:MM' }) startTime: string;
  @ApiProperty({ example: '16:00', description: 'Exclusive; 24:00 is not accepted, use 23:59 at most.' }) @Matches(TIME, { message: 'endTime must be HH:MM' }) endTime: string;
  @ApiProperty({ example: 60, minimum: 15, maximum: 480 }) @Type(() => Number) @IsInt() @Min(15) @Max(480) slotMinutes: number;
  @ApiProperty({ example: 2, minimum: 0, maximum: 100, description: 'Visits per slot; 0 keeps the window closed.' }) @Type(() => Number) @IsInt() @Min(0) @Max(100) capacityPerSlot: number;
  @ApiPropertyOptional({ default: true }) @IsOptional() @IsBoolean() active?: boolean;
}

export class UpdateScheduleDto {
  @ApiPropertyOptional() @IsOptional() @Matches(TIME, { message: 'startTime must be HH:MM' }) startTime?: string;
  @ApiPropertyOptional() @IsOptional() @Matches(TIME, { message: 'endTime must be HH:MM' }) endTime?: string;
  @ApiPropertyOptional() @IsOptional() @Type(() => Number) @IsInt() @Min(15) @Max(480) slotMinutes?: number;
  @ApiPropertyOptional() @IsOptional() @Type(() => Number) @IsInt() @Min(0) @Max(100) capacityPerSlot?: number;
  @ApiPropertyOptional() @IsOptional() @IsBoolean() active?: boolean;
}

export class ScheduleQueryDto {
  @ApiPropertyOptional({ enum: FULFILLMENT_MODES }) @IsOptional() @IsIn(FULFILLMENT_MODES) mode?: FulfillmentModeName;
}

/**
 * Closed period in local time: whole days (`startDate`..`endDate`) or a time range on one day. Without `mode` it
 * closes both modes.
 */
export class CreateBlockDto {
  @ApiPropertyOptional({ enum: FULFILLMENT_MODES, nullable: true }) @IsOptional() @Transform(optional) @IsIn(FULFILLMENT_MODES) mode?: FulfillmentModeName | null;
  @ApiProperty({ example: '2026-12-25' }) @Matches(DATE, { message: 'startDate must be YYYY-MM-DD' }) startDate: string;
  @ApiPropertyOptional({ example: '2026-12-26', description: 'Last closed day; defaults to startDate.' }) @IsOptional() @Transform(optional) @Matches(DATE, { message: 'endDate must be YYYY-MM-DD' }) endDate?: string | null;
  @ApiPropertyOptional({ example: '12:00', description: 'With endTime: close only this time range on a single day.' }) @IsOptional() @Transform(optional) @Matches(TIME, { message: 'startTime must be HH:MM' }) startTime?: string | null;
  @ApiPropertyOptional({ example: '13:00' }) @IsOptional() @Transform(optional) @Matches(TIME, { message: 'endTime must be HH:MM' }) endTime?: string | null;
  @ApiPropertyOptional({ example: 'Libur Natal' }) @IsOptional() @Transform(optional) @IsString() @MaxLength(200) reason?: string | null;
}

export class BlockQueryDto {
  @ApiPropertyOptional({ description: 'Include blocks that already ended.' }) @IsOptional() @Transform(({ value }) => value === 'true' || value === true) @IsBoolean() includePast?: boolean;
}

export class ClinicSlotQueryDto {
  @ApiProperty({ enum: FULFILLMENT_MODES }) @IsIn(FULFILLMENT_MODES) mode: FulfillmentModeName;
  @ApiProperty({ example: '2026-12-01', description: 'First local date.' }) @Matches(DATE, { message: 'from must be YYYY-MM-DD' }) from: string;
  @ApiPropertyOptional({ default: 7, minimum: 1, maximum: 31 }) @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(31) days?: number;
}

export class PublicSlotQueryDto {
  @ApiProperty({ example: '2026-12-01' }) @Matches(DATE, { message: 'date must be YYYY-MM-DD' }) date: string;
  @ApiProperty({ enum: FULFILLMENT_MODES }) @IsIn(FULFILLMENT_MODES) mode: FulfillmentModeName;
  @ApiPropertyOptional({ description: 'Comma-separated offering ids booked together; their total duration must fit.' })
  @IsOptional()
  @Transform(csv)
  @IsArray()
  @ArrayMaxSize(10)
  @IsUUID('all', { each: true })
  offeringIds?: string[];
}
