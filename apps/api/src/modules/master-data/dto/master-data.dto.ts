import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import { ArrayMaxSize, ArrayMinSize, IsBoolean, IsIn, IsInt, IsOptional, IsString, IsUUID, Matches, Max, MaxLength, Min, MinLength, ValidateNested } from 'class-validator';
import { PaginationQueryDto } from '../../../common/dto/pagination.dto';

const trim = ({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() : value);
const upperCode = ({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim().toUpperCase().replace(/[\s-]+/g, '_') : value);
const lowerSlug = ({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim().toLowerCase().replace(/[\s_]+/g, '-') : value);
const emptyToNull = ({ value }: { value: unknown }) => (typeof value === 'string' && value.trim() === '' ? null : typeof value === 'string' ? value.trim() : value);
const toBoolean = ({ value }: { value: unknown }) => (value === 'true' ? true : value === 'false' ? false : value);

/** Stable machine code: uppercase letters, digits, underscores. Fixed after creation. */
const CODE = /^[A-Z0-9][A-Z0-9_]{1,39}$/;
const CODE_MESSAGE = 'code must be 2–40 characters: letters, digits, or underscores';

export const MASTER_SORT_FIELDS = ['name', 'code', 'sortOrder', 'createdAt'] as const;

export class MasterListQueryDto extends PaginationQueryDto {
  @ApiPropertyOptional({ description: 'Filter by active flag.' })
  @IsOptional()
  @Transform(toBoolean)
  @IsBoolean()
  active?: boolean;

  @ApiPropertyOptional({ enum: MASTER_SORT_FIELDS, default: 'sortOrder' })
  @IsOptional()
  @IsIn(MASTER_SORT_FIELDS)
  sortBy: (typeof MASTER_SORT_FIELDS)[number] = 'sortOrder';
}

class OrderedFields {
  @ApiPropertyOptional({ default: true }) @IsOptional() @IsBoolean() active?: boolean;
  @ApiPropertyOptional({ default: 0, minimum: 0, maximum: 9999 }) @IsOptional() @IsInt() @Min(0) @Max(9999) sortOrder?: number;
}

// ─── Simple taxonomies: facility types, clinic classes, capabilities, practitioner types ────────

export class CreateTaxonomyDto extends OrderedFields {
  @ApiProperty({ example: 'KLINIK' }) @Transform(upperCode) @IsString() @Matches(CODE, { message: CODE_MESSAGE }) code: string;
  @ApiProperty({ example: 'Klinik' }) @Transform(trim) @IsString() @MinLength(2) @MaxLength(120) name: string;
}

export class UpdateTaxonomyDto extends OrderedFields {
  @ApiPropertyOptional() @IsOptional() @Transform(trim) @IsString() @MinLength(2) @MaxLength(120) name?: string;
}

// ─── Service categories ──────────────────────────────────────────────────────

export class CreateServiceCategoryDto extends OrderedFields {
  @ApiProperty({ example: 'laboratorium' })
  @Transform(lowerSlug)
  @IsString()
  @Matches(/^[a-z0-9][a-z0-9-]{1,59}$/, { message: 'slug must be 2–60 characters: lowercase letters, digits, or hyphens' })
  slug: string;

  @ApiProperty({ example: 'Laboratorium' }) @Transform(trim) @IsString() @MinLength(2) @MaxLength(120) name: string;
}

export class UpdateServiceCategoryDto extends OrderedFields {
  @ApiPropertyOptional() @IsOptional() @Transform(trim) @IsString() @MinLength(2) @MaxLength(120) name?: string;
}

// ─── Master services ─────────────────────────────────────────────────────────

export class MasterServiceQueryDto extends MasterListQueryDto {
  @ApiPropertyOptional() @IsOptional() @IsUUID() categoryId?: string;
}

export class CreateMasterServiceDto {
  @ApiProperty({ example: 'LAB_DARAH_LENGKAP' }) @Transform(upperCode) @IsString() @Matches(CODE, { message: CODE_MESSAGE }) code: string;
  @ApiProperty() @Transform(trim) @IsString() @MinLength(2) @MaxLength(160) name: string;
  @ApiProperty() @IsUUID() categoryId: string;
  @ApiPropertyOptional() @IsOptional() @Transform(emptyToNull) @IsString() @MaxLength(2000) description?: string | null;
  @ApiPropertyOptional({ default: true }) @IsOptional() @IsBoolean() active?: boolean;
}

export class UpdateMasterServiceDto {
  @ApiPropertyOptional() @IsOptional() @Transform(trim) @IsString() @MinLength(2) @MaxLength(160) name?: string;
  @ApiPropertyOptional() @IsOptional() @IsUUID() categoryId?: string;
  @ApiPropertyOptional() @IsOptional() @Transform(emptyToNull) @IsString() @MaxLength(2000) description?: string | null;
  @ApiPropertyOptional() @IsOptional() @IsBoolean() active?: boolean;
}

// ─── Document requirements ───────────────────────────────────────────────────

export const DOCUMENT_OWNER_TYPES = ['FACILITY', 'PRACTITIONER'] as const;

export class DocumentRequirementQueryDto extends MasterListQueryDto {
  @ApiPropertyOptional({ enum: DOCUMENT_OWNER_TYPES }) @IsOptional() @IsIn(DOCUMENT_OWNER_TYPES) ownerType?: (typeof DOCUMENT_OWNER_TYPES)[number];
}

export class CreateDocumentRequirementDto extends OrderedFields {
  @ApiProperty({ example: 'IZIN_OPERASIONAL' }) @Transform(upperCode) @IsString() @Matches(CODE, { message: CODE_MESSAGE }) code: string;
  @ApiProperty({ enum: DOCUMENT_OWNER_TYPES }) @IsIn(DOCUMENT_OWNER_TYPES) ownerType: (typeof DOCUMENT_OWNER_TYPES)[number];
  @ApiProperty() @Transform(trim) @IsString() @MinLength(2) @MaxLength(160) name: string;
  @ApiPropertyOptional() @IsOptional() @Transform(emptyToNull) @IsString() @MaxLength(2000) description?: string | null;
  @ApiPropertyOptional({ default: true }) @IsOptional() @IsBoolean() mandatory?: boolean;
}

export class UpdateDocumentRequirementDto extends OrderedFields {
  @ApiPropertyOptional() @IsOptional() @Transform(trim) @IsString() @MinLength(2) @MaxLength(160) name?: string;
  @ApiPropertyOptional() @IsOptional() @Transform(emptyToNull) @IsString() @MaxLength(2000) description?: string | null;
  @ApiPropertyOptional() @IsOptional() @IsBoolean() mandatory?: boolean;
}

// ─── Regions (lookup + import) ───────────────────────────────────────────────

/** 1 province, 2 regency/city, 3 district, 4 village (Kemendagri hierarchy). */
export const REGION_LEVELS = [1, 2, 3, 4] as const;

export class RegionQueryDto extends PaginationQueryDto {
  @ApiPropertyOptional({ enum: REGION_LEVELS }) @IsOptional() @Type(() => Number) @IsIn(REGION_LEVELS) level?: number;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(20) parentCode?: string;
}

export class RegionRowDto {
  @ApiProperty({ example: '31.71' }) @Transform(trim) @IsString() @Matches(/^[0-9][0-9.]{0,19}$/, { message: 'code must be digits and dots' }) code: string;
  @ApiProperty() @Transform(trim) @IsString() @MinLength(2) @MaxLength(160) name: string;
  @ApiProperty({ enum: REGION_LEVELS }) @IsIn(REGION_LEVELS) level: number;
  @ApiPropertyOptional() @IsOptional() @Transform(emptyToNull) @IsString() @MaxLength(20) parentCode?: string | null;
}

export class ImportRegionsDto {
  @ApiProperty({ type: [RegionRowDto] })
  @ValidateNested({ each: true })
  @Type(() => RegionRowDto)
  @ArrayMinSize(1)
  @ArrayMaxSize(5000)
  rows: RegionRowDto[];
}
