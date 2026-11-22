import type { JwtService } from '@nestjs/jwt';
import type { PrismaService } from '../../prisma/prisma.service';
import { AuthContextService } from './auth-context.service';

const membership = (id: string, scopeType: 'PLATFORM' | 'FACILITY', facilityId: string | null, roleCode: string, permissions: string[]) => ({
  id,
  scopeType,
  facilityId,
  role: { code: roleCode, permissions: permissions.map((code) => ({ permission: { code } })) },
});

function serviceWith(user: unknown) {
  const prisma = { user: { findUnique: jest.fn(async () => user) } } as unknown as PrismaService;
  const jwt = { verifyAsync: jest.fn(async () => ({ sub: 'u1', typ: 'access' })) } as unknown as JwtService;
  return new AuthContextService(jwt, prisma);
}

const activeUser = {
  id: 'u1',
  email: 'staff@example.test',
  name: 'Staff',
  status: 'ACTIVE',
  memberships: [
    membership('m-a', 'FACILITY', 'facility-a', 'CLINIC_OWNER_ADMIN', ['order:read', 'order:approve']),
    membership('m-b', 'FACILITY', 'facility-b', 'CLINIC_STAFF', ['order:read']),
  ],
};

describe('AuthContextService', () => {
  it('acts for the first facility membership by default', async () => {
    const auth = await serviceWith(activeUser).load('u1');
    expect(auth.facility?.facilityId).toBe('facility-a');
    expect(auth.platformPermissions.size).toBe(0);
  });

  it('switches only to a facility the user is a member of', async () => {
    const auth = await serviceWith(activeUser).load('u1', 'facility-b');
    expect(auth.facility?.facilityId).toBe('facility-b');
    expect([...auth.facility!.permissions]).toEqual(['order:read']);
  });

  it('refuses a facility id the user has no membership for (spec §3)', async () => {
    await expect(serviceWith(activeUser).load('u1', 'facility-z')).rejects.toMatchObject({ code: 'FORBIDDEN' });
  });

  it('rejects suspended or deleted users even with a valid token', async () => {
    await expect(serviceWith({ ...activeUser, status: 'SUSPENDED' }).load('u1')).rejects.toMatchObject({ code: 'UNAUTHORIZED' });
    await expect(serviceWith(null).load('u1')).rejects.toMatchObject({ code: 'UNAUTHORIZED' });
  });

  it('collects platform permissions separately from facility ones', async () => {
    const auth = await serviceWith({ ...activeUser, memberships: [membership('m-p', 'PLATFORM', null, 'PLATFORM_OPERATOR', ['facility:read', 'facility:review'])] }).load('u1');
    expect(auth.platformRoles).toEqual(['PLATFORM_OPERATOR']);
    expect(auth.platformPermissions.has('facility:review')).toBe(true);
    expect(auth.facility).toBeNull();
  });
});
