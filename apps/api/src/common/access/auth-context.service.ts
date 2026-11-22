import { Injectable } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { AppError } from '../errors/app-error';
import { PrismaService } from '../../prisma/prisma.service';
import type { AuthContext, FacilityScope } from './auth-context';

export type AccessTokenPayload = { sub: string; typ: 'access' };

const membershipInclude = {
  role: { select: { code: true, permissions: { select: { permission: { select: { code: true } } } } } },
} as const;

/** Turns an access token into the caller's live identity, memberships, and permissions. */
@Injectable()
export class AuthContextService {
  constructor(
    private readonly jwt: JwtService,
    private readonly prisma: PrismaService,
  ) {}

  async fromAccessToken(token: string, requestedFacilityId?: string): Promise<AuthContext> {
    let payload: AccessTokenPayload;
    try {
      payload = await this.jwt.verifyAsync<AccessTokenPayload>(token);
    } catch {
      throw AppError.unauthorized('The session has expired. Please sign in again.');
    }
    if (payload.typ !== 'access') throw AppError.unauthorized();
    return this.load(payload.sub, requestedFacilityId);
  }

  /**
   * `requestedFacilityId` (X-Facility-Id) only picks among the user's own active facility memberships;
   * it can never grant access to a facility the user is not a member of.
   */
  async load(userId: string, requestedFacilityId?: string): Promise<AuthContext> {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: {
        id: true,
        email: true,
        name: true,
        status: true,
        memberships: { where: { active: true }, include: membershipInclude, orderBy: { createdAt: 'asc' } },
      },
    });
    if (!user || user.status !== 'ACTIVE') throw AppError.unauthorized();

    const permissionsOf = (membership: (typeof user.memberships)[number]) =>
      membership.role.permissions.map((entry) => entry.permission.code);
    const platform = user.memberships.filter((membership) => membership.scopeType === 'PLATFORM');
    const facilityMemberships: FacilityScope[] = user.memberships
      .filter((membership) => membership.scopeType === 'FACILITY' && membership.facilityId)
      .map((membership) => ({
        facilityId: membership.facilityId!,
        membershipId: membership.id,
        roleCode: membership.role.code,
        permissions: new Set(permissionsOf(membership)),
      }));

    const facility = requestedFacilityId
      ? facilityMemberships.find((scope) => scope.facilityId === requestedFacilityId) ?? null
      : facilityMemberships[0] ?? null;
    if (requestedFacilityId && !facility) throw AppError.forbidden();

    return {
      userId: user.id,
      email: user.email,
      name: user.name,
      platformRoles: platform.map((membership) => membership.role.code),
      platformPermissions: new Set(platform.flatMap(permissionsOf)),
      facilityMemberships,
      facility,
    };
  }
}
