import { Controller, Get } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { Authenticated, CurrentAuth } from '../../common/access/access.decorators';
import type { AuthContext } from '../../common/access/auth-context';
import { PrismaService } from '../../prisma/prisma.service';

/** `GET /me`: identity, memberships, and the permissions the web uses to show menus (the API still enforces them). */
@ApiTags('Auth')
@ApiBearerAuth()
@Controller('me')
export class MeController {
  constructor(private readonly prisma: PrismaService) {}

  @Get()
  @Authenticated()
  async me(@CurrentAuth() auth: AuthContext) {
    const memberships = await this.prisma.membership.findMany({
      where: { userId: auth.userId, active: true },
      orderBy: { createdAt: 'asc' },
      select: {
        id: true,
        scopeType: true,
        role: { select: { code: true, name: true } },
        facility: { select: { id: true, displayName: true, verificationStatus: true, operatingStatus: true } },
      },
    });
    return {
      user: { id: auth.userId, email: auth.email, name: auth.name },
      memberships,
      platform: auth.platformRoles.length ? { roles: auth.platformRoles, permissions: [...auth.platformPermissions].sort() } : null,
      facility: auth.facility
        ? { facilityId: auth.facility.facilityId, role: auth.facility.roleCode, permissions: [...auth.facility.permissions].sort() }
        : null,
    };
  }
}
