import { createHash, timingSafeEqual } from 'node:crypto';
import { CanActivate, ExecutionContext, HttpStatus, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Request } from 'express';
import { AppError } from '../../common/errors/app-error';

const digest = (value: string) => createHash('sha256').update(value).digest();

/**
 * Machine authentication for the customer app's backend (spec §8: bookings require auth; customer identity lives in
 * the customer app). It sends `Authorization: Bearer <BOOKINGS_API_KEY>`; without a configured key the endpoint is off.
 */
@Injectable()
export class BookingKeyGuard implements CanActivate {
  constructor(private readonly config: ConfigService) {}

  canActivate(context: ExecutionContext): boolean {
    const expected = this.config.get<string>('BOOKINGS_API_KEY');
    if (!expected) throw new AppError(HttpStatus.SERVICE_UNAVAILABLE, 'BOOKINGS_DISABLED', 'Bookings are not enabled on this server.');
    const header = context.switchToHttp().getRequest<Request>().header('authorization') ?? '';
    const given = header.startsWith('Bearer ') ? header.slice(7) : '';
    // Compare fixed-length digests so neither length nor content leaks through timing.
    if (!given || !timingSafeEqual(digest(given), digest(expected))) throw AppError.unauthorized('A valid booking API key is required.');
    return true;
  }
}
