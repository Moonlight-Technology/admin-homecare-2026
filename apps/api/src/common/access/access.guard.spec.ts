import { ExecutionContext } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { AppError } from '../errors/app-error';
import { AccessGuard, bearerToken, checkRule } from './access.guard';
import { ACCESS_KEY, type AccessRule } from './access.decorators';
import type { AuthContext } from './auth-context';
import type { AuthContextService } from './auth-context.service';

const clinicUser: AuthContext = {
  userId: 'u-clinic',
  email: 'clinic@example.test',
  name: 'Clinic',
  platformRoles: [],
  platformPermissions: new Set(),
  facilityMemberships: [],
  facility: { facilityId: 'facility-a', membershipId: 'm1', roleCode: 'CLINIC_STAFF', permissions: new Set(['order:read']) },
};

function contextFor(rule: AccessRule | undefined, headers: Record<string, string> = {}) {
  const request: Record<string, unknown> = { header: (name: string) => headers[name.toLowerCase()] };
  const handler = () => undefined;
  if (rule) Reflect.defineMetadata(ACCESS_KEY, rule, handler);
  const context = {
    getHandler: () => handler,
    getClass: () => class {},
    switchToHttp: () => ({ getRequest: () => request }),
  } as unknown as ExecutionContext;
  return { context, request };
}

describe('AccessGuard', () => {
  const authContext = { fromAccessToken: jest.fn(async () => clinicUser) } as unknown as AuthContextService;
  const guard = new AccessGuard(new Reflector(), authContext);

  it('lets public routes through without a token', async () => {
    await expect(guard.canActivate(contextFor({ kind: 'public' }).context)).resolves.toBe(true);
  });

  it('rejects a protected route without a bearer token', async () => {
    await expect(guard.canActivate(contextFor({ kind: 'authenticated' }).context)).rejects.toMatchObject({ code: 'UNAUTHORIZED' });
  });

  it('denies a signed-in user on a route that declares no access rule (default deny)', async () => {
    const { context } = contextFor(undefined, { authorization: 'Bearer token' });
    await expect(guard.canActivate(context)).rejects.toMatchObject({ code: 'FORBIDDEN' });
  });

  it('attaches the auth context and passes the X-Facility-Id selection to the resolver', async () => {
    const { context, request } = contextFor({ kind: 'facility', permissions: ['order:read'] }, { authorization: 'Bearer token', 'x-facility-id': 'facility-a' });
    await expect(guard.canActivate(context)).resolves.toBe(true);
    expect(authContext.fromAccessToken).toHaveBeenCalledWith('token', 'facility-a');
    expect(request.auth).toBe(clinicUser);
  });
});

describe('checkRule', () => {
  it('blocks a clinic user from platform admin routes (AC-ADM-02)', () => {
    expect(() => checkRule({ kind: 'platform', permissions: ['facility:read'] }, clinicUser)).toThrow(AppError);
  });

  it('requires every listed facility permission', () => {
    expect(checkRule({ kind: 'facility', permissions: ['order:read'] }, clinicUser)).toBe(true);
    expect(() => checkRule({ kind: 'facility', permissions: ['order:read', 'order:approve'] }, clinicUser)).toThrow(AppError);
  });

  it('denies facility routes to a platform-only user', () => {
    const platformUser: AuthContext = { ...clinicUser, facility: null, platformRoles: ['PLATFORM_SUPER_ADMIN'], platformPermissions: new Set(['facility:read']) };
    expect(checkRule({ kind: 'platform', permissions: ['facility:read'] }, platformUser)).toBe(true);
    expect(() => checkRule({ kind: 'facility', permissions: ['order:read'] }, platformUser)).toThrow(AppError);
  });
});

describe('bearerToken', () => {
  it('reads only a well-formed bearer header', () => {
    expect(bearerToken('Bearer abc.def')).toBe('abc.def');
    expect(bearerToken('bearer abc')).toBe('abc');
    expect(bearerToken('Basic abc')).toBeNull();
    expect(bearerToken(undefined)).toBeNull();
  });
});
