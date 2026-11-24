import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { IsEmail, IsIn, IsOptional, IsString, MaxLength, MinLength } from 'class-validator';
import { PaginationQueryDto } from '../../common/dto/pagination.dto';

export const CLINIC_ROLES = ['CLINIC_OWNER_ADMIN', 'CLINIC_STAFF'] as const;
const trim = ({ value }: { value: unknown }) => typeof value === 'string' ? value.trim() : value;

export class StaffQueryDto extends PaginationQueryDto {
  @ApiPropertyOptional({ enum: ['ACTIVE', 'INACTIVE'] }) @IsOptional() @IsIn(['ACTIVE', 'INACTIVE']) access?: 'ACTIVE' | 'INACTIVE';
  @ApiPropertyOptional({ enum: CLINIC_ROLES }) @IsOptional() @IsIn(CLINIC_ROLES) roleCode?: (typeof CLINIC_ROLES)[number];
}

export class InviteStaffDto {
  @ApiProperty() @Transform(trim) @IsString() @MinLength(2) @MaxLength(120) name: string;
  @ApiProperty() @Transform(({ value }: { value: unknown }) => typeof value === 'string' ? value.trim().toLowerCase() : value) @IsEmail() @MaxLength(254) email: string;
  @ApiProperty({ enum: CLINIC_ROLES }) @IsIn(CLINIC_ROLES) roleCode: (typeof CLINIC_ROLES)[number];
}

export class UpdateStaffRoleDto {
  @ApiProperty({ enum: CLINIC_ROLES }) @IsIn(CLINIC_ROLES) roleCode: (typeof CLINIC_ROLES)[number];
}

export class StaffAccessDto {
  @ApiProperty({ enum: ['ENABLE', 'DISABLE'], description: 'Changes only the membership in the caller\'s clinic, never the global account status.' }) @IsIn(['ENABLE', 'DISABLE']) action: 'ENABLE' | 'DISABLE';
  @ApiProperty() @Transform(trim) @IsString() @MinLength(5) @MaxLength(1000) reason: string;
}
