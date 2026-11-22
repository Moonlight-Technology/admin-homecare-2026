import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import { ArrayMaxSize, ArrayMinSize, IsArray, IsDateString, IsEmail, IsIn, IsOptional, IsString, IsUUID, Matches, MaxLength, MinLength, ValidateIf, ValidateNested } from 'class-validator';
import { PaginationQueryDto } from '../../../common/dto/pagination.dto';
import { OPERATING_STATUSES, VERIFICATION_STATUSES } from '../../facilities/dto/facility.dto';

const trim = ({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() : value);
const email = ({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim().toLowerCase() || null : value);
const optional = ({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() || null : value);
const PHONE = /^\+?[0-9][0-9\s-]{6,19}$/;

/**
 * Credential types recognised so far: STR (registration) and SIP (practice licence). The detailed qualification
 * mapping per practitioner type is still open (spec §1), so only these two are accepted until it is agreed.
 */
export const CREDENTIAL_TYPES = ['STR', 'SIP'] as const;
export type CredentialType = (typeof CREDENTIAL_TYPES)[number];

export class CredentialInputDto {
  @ApiProperty({ enum: CREDENTIAL_TYPES }) @IsIn(CREDENTIAL_TYPES) credentialType: CredentialType;
  @ApiProperty({ example: '3121100220145678' })
  @Transform(trim)
  @IsString()
  @MinLength(5)
  @MaxLength(60)
  @Matches(/^[A-Za-z0-9./\s-]+$/, { message: 'number may only contain letters, digits, spaces, dots, slashes and dashes' })
  number: string;
  @ApiPropertyOptional({ example: 'Konsil Kedokteran Indonesia' }) @IsOptional() @Transform(optional) @IsString() @MaxLength(200) issuingAuthority?: string | null;
  @ApiPropertyOptional({ example: '2024-01-15' }) @IsOptional() @Transform(optional) @IsDateString({ strict: true }) validFrom?: string | null;
  @ApiPropertyOptional({ example: '2029-01-15', description: 'Empty for credentials without an expiry (STR seumur hidup).' }) @IsOptional() @Transform(optional) @IsDateString({ strict: true }) validUntil?: string | null;
}

/** Identity fields shared by admin and clinic registration. */
export class PractitionerProfileDto {
  @ApiProperty({ example: 'dr. Rina Kusuma' }) @Transform(trim) @IsString() @MinLength(3) @MaxLength(160) fullName: string;
  @ApiProperty() @IsUUID() practitionerTypeId: string;
  @ApiPropertyOptional() @IsOptional() @Transform(optional) @IsString() @Matches(PHONE, { message: 'phone must be a valid phone number' }) phone?: string | null;
  @ApiPropertyOptional() @IsOptional() @Transform(email) @ValidateIf((_, value) => value !== null) @IsEmail() @MaxLength(254) email?: string | null;
}

/** Registration needs at least one STR: it is what makes the identity unique and what reviewers verify. */
export class CreatePractitionerDto extends PractitionerProfileDto {
  @ApiProperty({ type: [CredentialInputDto] }) @IsArray() @ArrayMinSize(1) @ArrayMaxSize(10) @ValidateNested({ each: true }) @Type(() => CredentialInputDto) credentials: CredentialInputDto[];
}

export class UpdatePractitionerDto {
  @ApiPropertyOptional() @IsOptional() @Transform(trim) @IsString() @MinLength(3) @MaxLength(160) fullName?: string;
  @ApiPropertyOptional() @IsOptional() @IsUUID() practitionerTypeId?: string;
  @ApiPropertyOptional() @IsOptional() @Transform(optional) @IsString() @Matches(PHONE, { message: 'phone must be a valid phone number' }) phone?: string | null;
  @ApiPropertyOptional() @IsOptional() @Transform(email) @ValidateIf((_, value) => value !== null) @IsEmail() @MaxLength(254) email?: string | null;
}

export class PractitionerQueryDto extends PaginationQueryDto {
  @ApiPropertyOptional() @IsOptional() @IsUUID() practitionerTypeId?: string;
  @ApiPropertyOptional({ enum: VERIFICATION_STATUSES }) @IsOptional() @IsIn(VERIFICATION_STATUSES) verificationStatus?: (typeof VERIFICATION_STATUSES)[number];
  @ApiPropertyOptional({ enum: OPERATING_STATUSES }) @IsOptional() @IsIn(OPERATING_STATUSES) operatingStatus?: (typeof OPERATING_STATUSES)[number];
}

export class PractitionerStatusDto {
  @ApiProperty({ enum: ['ACTIVATE', 'SUSPEND'] }) @IsIn(['ACTIVATE', 'SUSPEND']) action: 'ACTIVATE' | 'SUSPEND';
  @ApiPropertyOptional({ description: 'Required when suspending.' }) @IsOptional() @Transform(trim) @IsString() @MaxLength(1000) reason?: string;
}

export class PractitionerReviewDto {
  @ApiProperty({ enum: ['APPROVE', 'REJECT', 'REQUEST_REVISION'] }) @IsIn(['APPROVE', 'REJECT', 'REQUEST_REVISION']) decision: 'APPROVE' | 'REJECT' | 'REQUEST_REVISION';
  @ApiPropertyOptional({ description: 'Required for REJECT and REQUEST_REVISION.' }) @IsOptional() @Transform(trim) @IsString() @MaxLength(2000) reason?: string;
}

/** Clinic lookup by exact STR number: clinics cannot browse the practitioner directory (least privilege). */
export class PractitionerLookupDto {
  @ApiProperty() @Transform(trim) @IsString() @MinLength(5) @MaxLength(60) strNumber: string;
}

// ─── Affiliations ────────────────────────────────────────────────────────────

export const AFFILIATION_STATUSES = ['PROPOSED', 'ACTIVE', 'REJECTED', 'ENDED'] as const;

export class AffiliationQueryDto extends PaginationQueryDto {
  @ApiPropertyOptional({ enum: AFFILIATION_STATUSES }) @IsOptional() @IsIn(AFFILIATION_STATUSES) status?: (typeof AFFILIATION_STATUSES)[number];
}

/**
 * `POST /clinic/practitioner-affiliations`: propose an existing practitioner (`practitionerId`, found by STR lookup)
 * or register a new one in the same step (`practitioner`). Exactly one of the two.
 */
export class ProposeAffiliationDto {
  @ApiPropertyOptional() @ValidateIf((dto: ProposeAffiliationDto) => !dto.practitioner) @IsUUID() practitionerId?: string;
  @ApiPropertyOptional({ type: CreatePractitionerDto }) @ValidateIf((dto: ProposeAffiliationDto) => !dto.practitionerId) @ValidateNested() @Type(() => CreatePractitionerDto) practitioner?: CreatePractitionerDto;
  @ApiPropertyOptional({ example: '2026-12-01' }) @IsOptional() @Transform(optional) @IsDateString({ strict: true }) startDate?: string | null;
  @ApiPropertyOptional({ description: 'Role or competency at this clinic. No clinical data.' }) @IsOptional() @Transform(optional) @IsString() @MaxLength(500) note?: string | null;
}

/** Clinic actions on its own affiliation: withdraw a proposal, or end an active affiliation. */
export class UpdateAffiliationDto {
  @ApiProperty({ enum: ['WITHDRAW', 'END'] }) @IsIn(['WITHDRAW', 'END']) action: 'WITHDRAW' | 'END';
  @ApiPropertyOptional() @IsOptional() @Transform(trim) @IsString() @MaxLength(1000) reason?: string;
  @ApiPropertyOptional({ description: 'Last day of an ended affiliation; defaults to today.' }) @IsOptional() @Transform(optional) @IsDateString({ strict: true }) endDate?: string | null;
}

export class AffiliationReviewDto {
  @ApiProperty({ enum: ['APPROVE', 'REJECT'] }) @IsIn(['APPROVE', 'REJECT']) decision: 'APPROVE' | 'REJECT';
  @ApiPropertyOptional({ description: 'Required for REJECT.' }) @IsOptional() @Transform(trim) @IsString() @MaxLength(1000) reason?: string;
}
