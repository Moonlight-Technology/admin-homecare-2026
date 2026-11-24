export type PlatformRole = 'PLATFORM_SUPER_ADMIN' | 'PLATFORM_OPERATOR';
export type PlatformUser = {
  id: string; name: string; email: string;
  status: 'INVITED' | 'ACTIVE' | 'SUSPENDED' | 'DISABLED';
  createdAt: string; lastLoginAt: string | null;
  memberships: Array<{ id: string; role: { code: string; name: string } }>;
};
export const ROLE_LABELS: Record<PlatformRole, string> = { PLATFORM_SUPER_ADMIN: 'Super admin', PLATFORM_OPERATOR: 'Operator platform' };
