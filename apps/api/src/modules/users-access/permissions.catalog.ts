/**
 * Every permission the API knows (spec §3). Access is default-deny: a route is reachable only when it names
 * one of these, and a user holds it through a role on an active membership of the matching scope.
 */
export const PLATFORM_PERMISSIONS = {
  dashboardRead: 'platform:dashboard:read',
  facilityRead: 'facility:read',
  facilityCreate: 'facility:create',
  facilityUpdate: 'facility:update',
  facilityReview: 'facility:review',
  facilityStatus: 'facility:status',
  practitionerRead: 'practitioner:read',
  practitionerReview: 'practitioner:review',
  practitionerStatus: 'practitioner:status',
  masterRead: 'master:read',
  masterWrite: 'master:write',
  orderReadAll: 'order:read-all',
  orderOverride: 'order:override',
  platformUserRead: 'platform-user:read',
  platformUserManage: 'platform-user:manage',
  auditRead: 'audit:read',
} as const;

export const FACILITY_PERMISSIONS = {
  dashboardRead: 'clinic:dashboard:read',
  profileRead: 'clinic:profile:read',
  profileUpdate: 'clinic:profile:update',
  verificationSubmit: 'clinic:verification:submit',
  documentManage: 'clinic:document:manage',
  offeringRead: 'offering:read',
  offeringCreate: 'offering:create',
  offeringUpdate: 'offering:update',
  offeringPublish: 'offering:publish',
  scheduleRead: 'schedule:read',
  scheduleManage: 'schedule:manage',
  affiliationRead: 'affiliation:read',
  affiliationManage: 'affiliation:manage',
  orderRead: 'order:read',
  orderApprove: 'order:approve',
  orderAssign: 'order:assign',
  orderProgress: 'order:progress',
  staffRead: 'staff:read',
  staffManage: 'staff:manage',
} as const;

export type PlatformPermission = (typeof PLATFORM_PERMISSIONS)[keyof typeof PLATFORM_PERMISSIONS];
export type FacilityPermission = (typeof FACILITY_PERMISSIONS)[keyof typeof FACILITY_PERMISSIONS];
export type PermissionCode = PlatformPermission | FacilityPermission;

const platform = Object.values(PLATFORM_PERMISSIONS);
const facility = Object.values(FACILITY_PERMISSIONS);

/** Built-in roles seeded on every environment (spec §3). Clinic staff permissions can be narrowed per facility later. */
export const SYSTEM_ROLES = [
  {
    code: 'PLATFORM_SUPER_ADMIN',
    name: 'Platform super admin',
    scope: 'PLATFORM',
    permissions: platform,
  },
  {
    code: 'PLATFORM_OPERATOR',
    name: 'Platform operator',
    scope: 'PLATFORM',
    // Reviews and oversight, but no master data writes, user management, or order overrides.
    permissions: platform.filter((code) => !['master:write', 'platform-user:manage', 'order:override'].includes(code)),
  },
  {
    code: 'CLINIC_OWNER_ADMIN',
    name: 'Clinic owner / admin',
    scope: 'FACILITY',
    permissions: facility,
  },
  {
    code: 'CLINIC_STAFF',
    name: 'Clinic staff',
    scope: 'FACILITY',
    // Day-to-day operations only: no staff administration, verification, or publishing.
    permissions: [
      FACILITY_PERMISSIONS.dashboardRead,
      FACILITY_PERMISSIONS.profileRead,
      FACILITY_PERMISSIONS.offeringRead,
      FACILITY_PERMISSIONS.scheduleRead,
      FACILITY_PERMISSIONS.affiliationRead,
      FACILITY_PERMISSIONS.orderRead,
      FACILITY_PERMISSIONS.orderAssign,
      FACILITY_PERMISSIONS.orderProgress,
    ],
  },
] as const satisfies ReadonlyArray<{ code: string; name: string; scope: 'PLATFORM' | 'FACILITY'; permissions: readonly PermissionCode[] }>;

export const isPlatformPermission = (code: string): code is PlatformPermission => (platform as string[]).includes(code);
