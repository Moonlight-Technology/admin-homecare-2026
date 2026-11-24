import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { IsEmail, IsIn, IsOptional, IsString, MaxLength, MinLength } from 'class-validator';
import { PaginationQueryDto } from '../../common/dto/pagination.dto';

export const PLATFORM_ROLES = ['PLATFORM_SUPER_ADMIN', 'PLATFORM_OPERATOR'] as const;
const trim = ({ value }: { value: unknown }) => typeof value === 'string' ? value.trim() : value;

export class UserQueryDto extends PaginationQueryDto {
  @ApiPropertyOptional({ enum: ['INVITED', 'ACTIVE', 'SUSPENDED', 'DISABLED'] })
  @IsOptional() @IsIn(['INVITED', 'ACTIVE', 'SUSPENDED', 'DISABLED']) status?: 'INVITED' | 'ACTIVE' | 'SUSPENDED' | 'DISABLED';

  @ApiPropertyOptional({ enum: PLATFORM_ROLES })
  @IsOptional() @IsIn(PLATFORM_ROLES) roleCode?: (typeof PLATFORM_ROLES)[number];
}

export class InvitePlatformUserDto {
  @ApiProperty() @Transform(trim) @IsString() @MinLength(2) @MaxLength(120) name: string;
  @ApiProperty() @Transform(({ value }: { value: unknown }) => typeof value === 'string' ? value.trim().toLowerCase() : value)
  @IsEmail() @MaxLength(254) email: string;
  @ApiProperty({ enum: PLATFORM_ROLES }) @IsIn(PLATFORM_ROLES) roleCode: (typeof PLATFORM_ROLES)[number];
}

export class UpdatePlatformUserDto {
  @ApiProperty() @Transform(trim) @IsString() @MinLength(2) @MaxLength(120) name: string;
  @ApiPropertyOptional({ enum: PLATFORM_ROLES }) @IsOptional() @IsIn(PLATFORM_ROLES) roleCode?: (typeof PLATFORM_ROLES)[number];
}

export class PlatformUserStatusDto {
  @ApiProperty({ enum: ['ENABLE', 'SUSPEND', 'DISABLE'], description: 'ENABLE restores ACTIVE accounts, or INVITED plus a new invitation when no password has been set.' })
  @IsIn(['ENABLE', 'SUSPEND', 'DISABLE']) action: 'ENABLE' | 'SUSPEND' | 'DISABLE';
  @ApiProperty({ description: 'Audit reason for every status change.' })
  @Transform(trim) @IsString() @MinLength(5) @MaxLength(1000) reason: string;
}
