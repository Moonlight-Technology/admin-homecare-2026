import { applyDecorators, createParamDecorator, ExecutionContext, SetMetadata } from '@nestjs/common';
import { ApiBearerAuth, ApiExtension, ApiHeader } from '@nestjs/swagger';
import { AppError } from '../errors/app-error';
import type { FacilityPermission, PlatformPermission } from '../../modules/users-access/permissions.catalog';
import type { AuthContext, AuthenticatedRequest, FacilityScope } from './auth-context';

export const ACCESS_KEY = 'nakes:access';

/** Every route must declare one of these; a route without it is denied (default deny, spec §3). */
export type AccessRule =
  | { kind: 'public' }
  | { kind: 'authenticated' }
  | { kind: 'platform'; permissions: PlatformPermission[] }
  | { kind: 'facility'; permissions: FacilityPermission[] };

/** No login needed (login, refresh, health, public catalog). */
export const Public = () => applyDecorators(
  SetMetadata(ACCESS_KEY, { kind: 'public' } satisfies AccessRule),
  ApiExtension('x-access', { kind: 'public' }),
);

/** Any signed-in user, e.g. `GET /me`. */
export const Authenticated = () => applyDecorators(
  SetMetadata(ACCESS_KEY, { kind: 'authenticated' } satisfies AccessRule),
  ApiBearerAuth(),
  ApiExtension('x-access', { kind: 'authenticated' }),
);

/** Platform admin routes: all listed permissions through an active platform membership. */
export const RequirePlatform = (...permissions: PlatformPermission[]) =>
  applyDecorators(
    SetMetadata(ACCESS_KEY, { kind: 'platform', permissions } satisfies AccessRule),
    ApiBearerAuth(),
    ApiExtension('x-access', { kind: 'platform', permissions }),
  );

/** Clinic routes: all listed permissions on the facility the request acts for. */
export const RequireFacility = (...permissions: FacilityPermission[]) =>
  applyDecorators(
    SetMetadata(ACCESS_KEY, { kind: 'facility', permissions } satisfies AccessRule),
    ApiBearerAuth(),
    ApiExtension('x-access', { kind: 'facility', permissions }),
    ApiHeader({ name: 'X-Facility-Id', required: false, description: 'Select a facility from the caller’s active memberships. When omitted, the earliest active facility membership is selected.' }),
  );

export const CurrentAuth = createParamDecorator((_: unknown, context: ExecutionContext): AuthContext => {
  const auth = context.switchToHttp().getRequest<AuthenticatedRequest>().auth;
  if (!auth) throw AppError.unauthorized();
  return auth;
});

/** The caller's facility; only on `@RequireFacility` routes, where the guard has already resolved it. */
export const CurrentFacility = createParamDecorator((_: unknown, context: ExecutionContext): FacilityScope => {
  const facility = context.switchToHttp().getRequest<AuthenticatedRequest>().auth?.facility;
  if (!facility) throw AppError.forbidden();
  return facility;
});
