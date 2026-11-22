import { Controller, Get, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiPropertyOptional, ApiTags } from '@nestjs/swagger';
import { Prisma } from '@prisma/client';
import { IsDateString, IsOptional, IsString, IsUUID, MaxLength } from 'class-validator';
import { RequirePlatform } from '../../common/access/access.decorators';
import { paginate, PaginationQueryDto, skipTake } from '../../common/dto/pagination.dto';
import { PrismaService } from '../../prisma/prisma.service';
import { PLATFORM_PERMISSIONS } from '../users-access/permissions.catalog';

class AuditLogQueryDto extends PaginationQueryDto {
  @ApiPropertyOptional() @IsOptional() @IsUUID() actorId?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(100) entityType?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(200) entityId?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(100) event?: string;
  @ApiPropertyOptional() @IsOptional() @IsDateString() from?: string;
  @ApiPropertyOptional() @IsOptional() @IsDateString() to?: string;
}

/** `GET /admin/audit-logs`: search sensitive actions by actor, entity, event, and time (spec §4). */
@ApiTags('Audit')
@ApiBearerAuth()
@Controller('admin/audit-logs')
export class AuditLogsController {
  constructor(private readonly prisma: PrismaService) {}

  @Get()
  @RequirePlatform(PLATFORM_PERMISSIONS.auditRead)
  async list(@Query() query: AuditLogQueryDto) {
    const where: Prisma.AuditLogWhereInput = {
      ...(query.actorId ? { actorId: query.actorId } : {}),
      ...(query.entityType ? { entityType: query.entityType } : {}),
      ...(query.entityId ? { entityId: query.entityId } : {}),
      ...(query.event ? { event: query.event } : {}),
      ...(query.from || query.to ? { createdAt: { ...(query.from ? { gte: new Date(query.from) } : {}), ...(query.to ? { lt: new Date(query.to) } : {}) } } : {}),
      ...(query.search ? { OR: [{ event: { contains: query.search, mode: 'insensitive' } }, { entityType: { contains: query.search, mode: 'insensitive' } }, { entityId: { contains: query.search } }] } : {}),
    };
    const [items, total] = await Promise.all([
      this.prisma.auditLog.findMany({ where, orderBy: { createdAt: query.sortOrder }, ...skipTake(query) }),
      this.prisma.auditLog.count({ where }),
    ]);
    const actorIds = [...new Set(items.map((item) => item.actorId).filter((id): id is string => Boolean(id)))];
    const actors = actorIds.length ? await this.prisma.user.findMany({ where: { id: { in: actorIds } }, select: { id: true, name: true, email: true } }) : [];
    const byId = new Map(actors.map((actor) => [actor.id, actor]));
    return paginate(items.map((item) => ({ ...item, actor: item.actorId ? byId.get(item.actorId) ?? null : null })), total, query);
  }
}
