import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import { ArrayMaxSize, ArrayUnique, IsArray, IsEmail, IsIn, IsInt, IsLatitude, IsLongitude, IsOptional, IsString, IsUUID, Matches, MaxLength, MinLength, ValidateNested } from 'class-validator';
import { PaginationQueryDto } from '../../../common/dto/pagination.dto';
import { PASSWORD_MIN_LENGTH } from '../../auth/password.service';

const trim = ({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() : value);
const email = ({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim().toLowerCase() : value);
const optional = ({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() || null : value);
/** Indonesian phone numbers: digits with an optional leading +, spaces and dashes allowed. */
const PHONE = /^\+?[0-9][0-9\s-]{6,19}$/;

/**
 * Clinic profile fields shared by self-registration, admin creation, and profile edits. Which of them are required
 * to submit for verification is decided in FacilitiesService (spec §15 leaves the final list to operations).
 */
export class FacilityProfileDto {
  @ApiProperty({ example: 'Klinik Sehat Sentosa' }) @Transform(trim) @IsString() @MinLength(3) @MaxLength(160) displayName: string;
  @ApiProperty({ example: 'PT Sehat Sentosa Medika' }) @Transform(trim) @IsString() @MinLength(3) @MaxLength(200) legalName: string;
  @ApiProperty() @IsUUID() facilityTypeId: string;
  @ApiPropertyOptional({ nullable: true }) @IsOptional() @Transform(optional) @IsUUID() clinicClassId?: string | null;
  @ApiProperty({ type: [String] }) @IsArray() @ArrayUnique() @ArrayMaxSize(20) @IsUUID('all', { each: true }) capabilityIds: string[];
  @ApiPropertyOptional({ example: '021-5550123' }) @IsOptional() @Transform(optional) @IsString() @Matches(PHONE, { message: 'phone must be a valid phone number' }) phone?: string | null;
  @ApiPropertyOptional() @IsOptional() @Transform(email) @IsEmail() @MaxLength(254) email?: string | null;
  @ApiProperty({ example: 'Jl. Melati No. 10' }) @Transform(trim) @IsString() @MinLength(5) @MaxLength(500) addressLine: string;
  @ApiPropertyOptional({ nullable: true }) @IsOptional() @Transform(optional) @IsString() @MaxLength(20) regionCode?: string | null;
  @ApiPropertyOptional({ nullable: true }) @IsOptional() @Transform(optional) @Matches(/^[0-9]{5}$/, { message: 'postalCode must be 5 digits' }) postalCode?: string | null;
  @ApiPropertyOptional({ nullable: true }) @IsOptional() @Type(() => Number) @IsLatitude() latitude?: number | null;
  @ApiPropertyOptional({ nullable: true }) @IsOptional() @Type(() => Number) @IsLongitude() longitude?: number | null;
}

/** Profile edits send only what changed. */
export class UpdateFacilityProfileDto {
  @ApiPropertyOptional() @IsOptional() @Transform(trim) @IsString() @MinLength(3) @MaxLength(160) displayName?: string;
  @ApiPropertyOptional() @IsOptional() @Transform(trim) @IsString() @MinLength(3) @MaxLength(200) legalName?: string;
  @ApiPropertyOptional() @IsOptional() @IsUUID() facilityTypeId?: string;
  @ApiPropertyOptional({ nullable: true }) @IsOptional() @Transform(optional) @IsUUID() clinicClassId?: string | null;
  @ApiPropertyOptional({ type: [String] }) @IsOptional() @IsArray() @ArrayUnique() @ArrayMaxSize(20) @IsUUID('all', { each: true }) capabilityIds?: string[];
  @ApiPropertyOptional() @IsOptional() @Transform(optional) @IsString() @Matches(PHONE, { message: 'phone must be a valid phone number' }) phone?: string | null;
  @ApiPropertyOptional() @IsOptional() @Transform(email) @IsEmail() @MaxLength(254) email?: string | null;
  @ApiPropertyOptional() @IsOptional() @Transform(trim) @IsString() @MinLength(5) @MaxLength(500) addressLine?: string;
  @ApiPropertyOptional() @IsOptional() @Transform(optional) @IsString() @MaxLength(20) regionCode?: string | null;
  @ApiPropertyOptional() @IsOptional() @Transform(optional) @Matches(/^[0-9]{5}$/, { message: 'postalCode must be 5 digits' }) postalCode?: string | null;
  @ApiPropertyOptional() @IsOptional() @Type(() => Number) @IsLatitude() latitude?: number | null;
  @ApiPropertyOptional() @IsOptional() @Type(() => Number) @IsLongitude() longitude?: number | null;
}

export class OwnerAccountDto {
  @ApiProperty() @Transform(trim) @IsString() @MinLength(2) @MaxLength(120) name: string;
  @ApiProperty() @Transform(email) @IsEmail() @MaxLength(254) email: string;
}

export class RegistrationOwnerDto extends OwnerAccountDto {
  @ApiProperty({ minLength: PASSWORD_MIN_LENGTH }) @IsString() @MinLength(PASSWORD_MIN_LENGTH) @MaxLength(200) password: string;
}

/** `POST /clinic-registration` (spec §5.1). */
export class ClinicRegistrationDto {
  @ApiProperty({ type: RegistrationOwnerDto }) @ValidateNested() @Type(() => RegistrationOwnerDto) owner: RegistrationOwnerDto;
  @ApiProperty({ type: FacilityProfileDto }) @ValidateNested() @Type(() => FacilityProfileDto) facility: FacilityProfileDto;
}

/** `POST /admin/facilities` (spec §5.2): the owner gets an invitation; no password is ever sent. */
export class AdminCreateFacilityDto {
  @ApiProperty({ type: OwnerAccountDto }) @ValidateNested() @Type(() => OwnerAccountDto) owner: OwnerAccountDto;
  @ApiProperty({ type: FacilityProfileDto }) @ValidateNested() @Type(() => FacilityProfileDto) facility: FacilityProfileDto;
}

export const VERIFICATION_STATUSES = ['DRAFT', 'SUBMITTED', 'UNDER_REVIEW', 'VERIFIED', 'REVISION_REQUIRED', 'REJECTED'] as const;
export const OPERATING_STATUSES = ['INACTIVE', 'ACTIVE', 'SUSPENDED'] as const;

export class FacilityQueryDto extends PaginationQueryDto {
  @ApiPropertyOptional() @IsOptional() @IsUUID() facilityTypeId?: string;
  @ApiPropertyOptional() @IsOptional() @IsUUID() clinicClassId?: string;
  @ApiPropertyOptional({ enum: VERIFICATION_STATUSES }) @IsOptional() @IsIn(VERIFICATION_STATUSES) verificationStatus?: (typeof VERIFICATION_STATUSES)[number];
  @ApiPropertyOptional({ enum: OPERATING_STATUSES }) @IsOptional() @IsIn(OPERATING_STATUSES) operatingStatus?: (typeof OPERATING_STATUSES)[number];
}

export class FacilityStatusDto {
  @ApiProperty({ enum: ['ACTIVATE', 'SUSPEND'] }) @IsIn(['ACTIVATE', 'SUSPEND']) action: 'ACTIVATE' | 'SUSPEND';
  @ApiPropertyOptional({ description: 'Required when suspending.' }) @IsOptional() @Transform(trim) @IsString() @MaxLength(1000) reason?: string;
}

// ─── Verification ────────────────────────────────────────────────────────────

export const APPLICATION_STATUSES = ['SUBMITTED', 'UNDER_REVIEW', 'APPROVED', 'REVISION_REQUIRED', 'REJECTED'] as const;

export class ApplicationQueryDto extends PaginationQueryDto {
  @ApiPropertyOptional({ enum: APPLICATION_STATUSES }) @IsOptional() @IsIn(APPLICATION_STATUSES) status?: (typeof APPLICATION_STATUSES)[number];
}

export class ReviewDecisionDto {
  @ApiProperty({ enum: ['APPROVE', 'REJECT', 'REQUEST_REVISION'] }) @IsIn(['APPROVE', 'REJECT', 'REQUEST_REVISION']) decision: 'APPROVE' | 'REJECT' | 'REQUEST_REVISION';
  @ApiPropertyOptional({ description: 'Required for REJECT and REQUEST_REVISION.' }) @IsOptional() @Transform(trim) @IsString() @MaxLength(2000) reason?: string;
}

export class DocumentUploadInitDto {
  @ApiProperty() @IsUUID() requirementId: string;
  @ApiProperty() @Transform(trim) @IsString() @MinLength(1) @MaxLength(200) fileName: string;
  @ApiProperty({ example: 'application/pdf' }) @IsString() @MaxLength(100) mimeType: string;
  @ApiProperty() @Type(() => Number) @IsInt() sizeBytes: number;
}

export class DocumentCompleteDto {
  @ApiProperty() @IsUUID() documentId: string;
}

export const FACILITY_MEDIA_KINDS = ['LOGO', 'PHOTO'] as const;

export class MediaUploadInitDto {
  @ApiProperty({ enum: FACILITY_MEDIA_KINDS }) @IsIn(FACILITY_MEDIA_KINDS) kind: (typeof FACILITY_MEDIA_KINDS)[number];
  @ApiProperty() @Transform(trim) @IsString() @MinLength(1) @MaxLength(200) fileName: string;
  @ApiProperty({ example: 'image/jpeg', enum: ['image/jpeg', 'image/png'] }) @IsString() @MaxLength(100) mimeType: string;
  @ApiProperty({ description: 'At most 5 MB.' }) @Type(() => Number) @IsInt() sizeBytes: number;
}

export class MediaCompleteDto {
  @ApiProperty() @IsUUID() documentId: string;
  @ApiProperty({ enum: FACILITY_MEDIA_KINDS }) @IsIn(FACILITY_MEDIA_KINDS) kind: (typeof FACILITY_MEDIA_KINDS)[number];
  @ApiPropertyOptional({ nullable: true, maxLength: 200 }) @IsOptional() @Transform(optional) @IsString() @MaxLength(200) caption?: string | null;
}

export class MediaUpdateDto {
  @ApiProperty({ nullable: true, maxLength: 200 }) @Transform(optional) @IsOptional() @IsString() @MaxLength(200) caption: string | null;
}

export class MediaOrderDto {
  @ApiProperty({ type: [String], description: 'Every current photo id, in the new display order.' })
  @IsArray() @ArrayMaxSize(50) @ArrayUnique() @IsUUID('all', { each: true }) ids: string[];
}
