import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import { ArrayMaxSize, ArrayMinSize, IsArray, IsBoolean, IsIn, IsInt, IsOptional, IsString, IsUUID, Matches, Max, MaxLength, Min, MinLength, ValidateNested } from 'class-validator';
import { PaginationQueryDto } from '../../../common/dto/pagination.dto';

const trim = ({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() : value);
const optional = ({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() || null : value);
/** Money arrives as a decimal string (or number) and stays exact: up to 12 digits and 2 decimals, Decimal(14,2). */
const money = ({ value }: { value: unknown }) => (typeof value === 'number' ? String(value) : typeof value === 'string' ? value.trim() || null : value);
const MONEY = /^\d{1,12}(\.\d{1,2})?$/;
const MONEY_MESSAGE = 'must be an amount in rupiah with at most 2 decimals';

export const FULFILLMENT_MODES = ['ON_SITE', 'HOMECARE'] as const;
export type FulfillmentModeName = (typeof FULFILLMENT_MODES)[number];
export const OFFERING_STATUSES = ['DRAFT', 'PUBLISHED', 'UNPUBLISHED', 'ARCHIVED'] as const;

/**
 * One fulfillment mode of an offering. The price override replaces the base price for that mode; the visit fee is
 * homecare only. Homecare coverage rules stay open (spec §1), so no service area is accepted yet.
 */
export class OfferingModeDto {
  @ApiProperty({ enum: FULFILLMENT_MODES }) @IsIn(FULFILLMENT_MODES) mode: FulfillmentModeName;
  @ApiPropertyOptional({ default: true }) @IsOptional() @IsBoolean() enabled?: boolean;
  @ApiPropertyOptional({ example: '175000', nullable: true }) @IsOptional() @Transform(money) @Matches(MONEY, { message: `priceOverride ${MONEY_MESSAGE}` }) priceOverride?: string | null;
  @ApiPropertyOptional({ example: '50000', nullable: true, description: 'HOMECARE only.' }) @IsOptional() @Transform(money) @Matches(MONEY, { message: `visitFee ${MONEY_MESSAGE}` }) visitFee?: string | null;
}

class OfferingFields {
  @ApiPropertyOptional({ nullable: true }) @IsOptional() @Transform(optional) @IsString() @MaxLength(4000) description?: string | null;
  @ApiPropertyOptional({ nullable: true, description: 'Preparation the patient must do, e.g. fasting 8 hours.' }) @IsOptional() @Transform(optional) @IsString() @MaxLength(2000) preparationNote?: string | null;
  @ApiPropertyOptional({ nullable: true }) @IsOptional() @Transform(optional) @IsString() @MaxLength(4000) terms?: string | null;
}

/** `POST /clinic/offerings` (AC-SVC-01): a master service, a public title, base price, duration, and its modes. */
export class CreateOfferingDto extends OfferingFields {
  @ApiProperty() @IsUUID() masterServiceId: string;
  @ApiProperty({ example: 'Cek darah lengkap di rumah' }) @Transform(trim) @IsString() @MinLength(3) @MaxLength(160) name: string;
  @ApiProperty({ example: '150000' }) @Transform(money) @Matches(MONEY, { message: `basePrice ${MONEY_MESSAGE}` }) basePrice: string;
  @ApiProperty({ example: 30, minimum: 5, maximum: 1440 }) @Type(() => Number) @IsInt() @Min(5) @Max(1440) durationMinutes: number;
  @ApiProperty({ type: [OfferingModeDto] }) @IsArray() @ArrayMinSize(1) @ArrayMaxSize(2) @ValidateNested({ each: true }) @Type(() => OfferingModeDto) modes: OfferingModeDto[];
}

/** Edits send only what changed; `modes` replaces the mode settings (modes left out are disabled). */
export class UpdateOfferingDto extends OfferingFields {
  @ApiPropertyOptional({ description: 'Only while the offering is a draft.' }) @IsOptional() @IsUUID() masterServiceId?: string;
  @ApiPropertyOptional() @IsOptional() @Transform(trim) @IsString() @MinLength(3) @MaxLength(160) name?: string;
  @ApiPropertyOptional() @IsOptional() @Transform(money) @Matches(MONEY, { message: `basePrice ${MONEY_MESSAGE}` }) basePrice?: string;
  @ApiPropertyOptional() @IsOptional() @Type(() => Number) @IsInt() @Min(5) @Max(1440) durationMinutes?: number;
  @ApiPropertyOptional({ type: [OfferingModeDto] }) @IsOptional() @IsArray() @ArrayMinSize(1) @ArrayMaxSize(2) @ValidateNested({ each: true }) @Type(() => OfferingModeDto) modes?: OfferingModeDto[];
}

export class OfferingQueryDto extends PaginationQueryDto {
  @ApiPropertyOptional({ enum: OFFERING_STATUSES }) @IsOptional() @IsIn(OFFERING_STATUSES) status?: (typeof OFFERING_STATUSES)[number];
  @ApiPropertyOptional({ enum: FULFILLMENT_MODES }) @IsOptional() @IsIn(FULFILLMENT_MODES) mode?: FulfillmentModeName;
}

// ─── Public discovery ────────────────────────────────────────────────────────

export class PublicFacilityQueryDto extends PaginationQueryDto {
  @ApiPropertyOptional() @IsOptional() @IsUUID() facilityTypeId?: string;
  @ApiPropertyOptional() @IsOptional() @IsUUID() clinicClassId?: string;
  @ApiPropertyOptional() @IsOptional() @IsUUID() capabilityId?: string;
  @ApiPropertyOptional() @IsOptional() @IsUUID() categoryId?: string;
  @ApiPropertyOptional({ description: 'Region code or a parent code (province/regency prefix).' }) @IsOptional() @IsString() @Matches(/^[0-9.]{2,20}$/, { message: 'regionCode must be a region code' }) regionCode?: string;
  @ApiPropertyOptional({ enum: FULFILLMENT_MODES }) @IsOptional() @IsIn(FULFILLMENT_MODES) mode?: FulfillmentModeName;
}

export class PublicOfferingQueryDto {
  @ApiPropertyOptional({ enum: FULFILLMENT_MODES }) @IsOptional() @IsIn(FULFILLMENT_MODES) mode?: FulfillmentModeName;
}
