import { CanActivate, ExecutionContext, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Request } from 'express';
import { AppError } from '../errors/app-error';

/**
 * CSRF protection for the cookie-authenticated endpoints (refresh, logout): the browser must send an Origin
 * matching the admin web. Together with the SameSite=Strict cookie this blocks cross-site requests (spec §10).
 */
@Injectable()
export class SameOriginGuard implements CanActivate {
  constructor(private readonly config: ConfigService) {}

  canActivate(context: ExecutionContext): boolean {
    const origin = context.switchToHttp().getRequest<Request>().header('origin');
    if (origin && origin === this.config.getOrThrow<string>('WEB_ORIGIN')) return true;
    throw AppError.forbidden('Cross-origin request rejected.');
  }
}
