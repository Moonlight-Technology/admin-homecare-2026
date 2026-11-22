import { createHmac, timingSafeEqual } from 'node:crypto';

export type LinkAction = 'upload' | 'download';
type Payload = { d: string; a: LinkAction; e: number };

/**
 * Short-lived signed links for document upload/download (spec §10). The token binds one document id, one action,
 * and an expiry; guessing a storage key or document id alone grants nothing (AC-SEC-02).
 */
export function signLink(secret: string, documentId: string, action: LinkAction, ttlSeconds: number, now = Date.now()) {
  const expiresAt = Math.floor(now / 1000) + ttlSeconds;
  const body = Buffer.from(JSON.stringify({ d: documentId, a: action, e: expiresAt } satisfies Payload)).toString('base64url');
  return { token: `${body}.${mac(secret, body)}`, expiresAt: new Date(expiresAt * 1000) };
}

export function verifyLink(secret: string, token: string | undefined, documentId: string, action: LinkAction, now = Date.now()): boolean {
  const [body, signature, extra] = (token ?? '').split('.');
  if (!body || !signature || extra !== undefined) return false;
  const expected = Buffer.from(mac(secret, body));
  const given = Buffer.from(signature);
  if (expected.length !== given.length || !timingSafeEqual(expected, given)) return false;
  try {
    const payload = JSON.parse(Buffer.from(body, 'base64url').toString()) as Payload;
    return payload.d === documentId && payload.a === action && payload.e * 1000 > now;
  } catch {
    return false;
  }
}

const mac = (secret: string, body: string) => createHmac('sha256', secret).update(body).digest('base64url');
