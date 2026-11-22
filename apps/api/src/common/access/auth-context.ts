import type { Request } from 'express';

/** The facility a clinic user acts for, resolved from their membership; never from the request body (spec §3). */
export type FacilityScope = {
  facilityId: string;
  membershipId: string;
  roleCode: string;
  permissions: ReadonlySet<string>;
};

/** Who is calling, reloaded from the database on every request so revoked access takes effect at once. */
export type AuthContext = {
  userId: string;
  email: string;
  name: string;
  platformRoles: string[];
  platformPermissions: ReadonlySet<string>;
  /** Facility memberships the user may switch between; MVP users normally have one. */
  facilityMemberships: FacilityScope[];
  /** The facility this request acts for, when the user has a facility membership. */
  facility: FacilityScope | null;
};

export type AuthenticatedRequest = Request & { requestId?: string; auth?: AuthContext };
