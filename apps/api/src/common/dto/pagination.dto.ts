import { ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsIn, IsInt, IsOptional, IsString, Max, MaxLength, Min } from 'class-validator';

/** `page`, `limit`, `search`, `sortOrder`; each list DTO whitelists its own `sortBy` values (spec §8). */
export class PaginationQueryDto {
  @ApiPropertyOptional({ default: 1, minimum: 1 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page = 1;

  @ApiPropertyOptional({ default: 20, minimum: 1, maximum: 100 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  limit = 20;

  @ApiPropertyOptional({ maxLength: 100 })
  @IsOptional()
  @IsString()
  @MaxLength(100)
  search?: string;

  @ApiPropertyOptional({ enum: ['asc', 'desc'], default: 'desc' })
  @IsOptional()
  @IsIn(['asc', 'desc'])
  sortOrder: 'asc' | 'desc' = 'desc';
}

export type Paginated<T> = { items: T[]; page: number; limit: number; total: number };

export const paginate = <T>(items: T[], total: number, query: Pick<PaginationQueryDto, 'page' | 'limit'>): Paginated<T> => ({
  items,
  page: query.page,
  limit: query.limit,
  total,
});

export const skipTake = (query: Pick<PaginationQueryDto, 'page' | 'limit'>) => ({ skip: (query.page - 1) * query.limit, take: query.limit });
