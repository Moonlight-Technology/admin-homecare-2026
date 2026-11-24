export type ClinicRoleCode = 'CLINIC_OWNER_ADMIN' | 'CLINIC_STAFF';
export type ClinicRole = { code: string; name: string; permissions: string[] };
export type StaffMember = {
  id: string; facilityId: string; active: boolean; createdAt: string;
  user: { id: string; name: string; email: string; status: string };
  role: ClinicRole;
};
