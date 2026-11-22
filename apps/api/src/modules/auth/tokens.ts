import { createHash, randomBytes } from 'node:crypto';
import type { CookieOptions } from 'express';

export const REFRESH_COOKIE = 'nakes_rt';
/** The refresh cookie is only ever sent to the auth endpoints. */
export const REFRESH_COOKIE_PATH = '/api/v1/auth';

/** 256-bit opaque token; only its SHA-256 hash is stored. */
export const newOpaqueToken = () => randomBytes(32).toString('base64url');

export const hashToken = (token: string) => createHash('sha256').update(token).digest('hex');

export const refreshCookieOptions = (secure: boolean, maxAgeMs: number): CookieOptions => ({
  httpOnly: true,
  secure,
  sameSite: 'strict',
  path: REFRESH_COOKIE_PATH,
  maxAge: maxAgeMs,
});
