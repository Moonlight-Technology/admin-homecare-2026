/** Response of `GET /me`. */
export type Me = {
  user: { id: string; email: string; name: string };
  memberships: Array<{
    id: string;
    scopeType: 'PLATFORM' | 'FACILITY';
    role: { code: string; name: string };
    facility: { id: string; displayName: string; verificationStatus: string; operatingStatus: string } | null;
  }>;
  platform: { roles: string[]; permissions: string[] } | null;
  facility: { facilityId: string; role: string; permissions: string[] } | null;
};

/** Menu visibility only; the API enforces every permission again (spec §3). */
export const canPlatform = (me: Me | null, permission: string) => Boolean(me?.platform?.permissions.includes(permission));
export const canFacility = (me: Me | null, permission: string) => Boolean(me?.facility?.permissions.includes(permission));

/** Where a user lands after signing in. */
export function homePath(me: Me): string {
  if (me.platform) return '/admin';
  if (me.facility) return '/clinic';
  return '/no-access';
}
