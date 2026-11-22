import { CanActivate, ExecutionContext, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { AppError } from '../errors/app-error';
import { AuthContextService } from './auth-context.service';
import { ACCESS_KEY, type AccessRule } from './access.decorators';
import type { AuthenticatedRequest } from './auth-context';

/**
 * Global guard: authenticates the bearer token, then checks the route's access rule.
 * A route with no rule is denied, so a forgotten decorator can never expose data (spec §3).
 */
@Injectable()
export class AccessGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly authContext: AuthContextService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const rule = this.reflector.getAllAndOverride<AccessRule | undefined>(ACCESS_KEY, [context.getHandler(), context.getClass()]);
    if (rule?.kind === 'public') return true;

    const request = context.switchToHttp().getRequest<AuthenticatedRequest>();
    const token = bearerToken(request.header('authorization'));
    if (!token) throw AppError.unauthorized();
    request.auth = await this.authContext.fromAccessToken(token, request.header('x-facility-id'));

    if (!rule) throw AppError.forbidden();
    return checkRule(rule, request.auth);
  }
}

export function bearerToken(header: string | undefined): string | null {
  const match = header?.match(/^Bearer\s+(\S+)$/i);
  return match?.[1] ?? null;
}

/** Pure rule check, exported for tests. */
export function checkRule(rule: AccessRule, auth: NonNullable<AuthenticatedRequest['auth']>): true {
  if (rule.kind === 'public' || rule.kind === 'authenticated') return true;
  if (rule.kind === 'platform') {
    if (rule.permissions.every((code) => auth.platformPermissions.has(code))) return true;
    throw AppError.forbidden();
  }
  if (auth.facility && rule.permissions.every((code) => auth.facility!.permissions.has(code))) return true;
  throw AppError.forbidden();
}
