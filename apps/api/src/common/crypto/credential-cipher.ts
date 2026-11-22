import { createCipheriv, createDecipheriv, createHash, createHmac, randomBytes } from 'node:crypto';

/**
 * Protection for professional identifiers such as STR and SIP numbers (spec §7, §10). The number is stored
 * AES-256-GCM encrypted, shown masked, and matched through a keyed hash so duplicates are found without decrypting.
 * Both keys are derived from one secret so they never coincide.
 */
export class CredentialCipher {
  private readonly encryptionKey: Buffer;
  private readonly hashKey: Buffer;

  constructor(secret: string) {
    if (secret.length < 32) throw new Error('CREDENTIAL_ENCRYPTION_KEY must be at least 32 characters.');
    this.encryptionKey = createHash('sha256').update(`credential-encryption:${secret}`).digest();
    this.hashKey = createHash('sha256').update(`credential-hash:${secret}`).digest();
  }

  /** `v1.<iv>.<tag>.<ciphertext>`, all base64url. */
  encrypt(plain: string): string {
    const iv = randomBytes(12);
    const cipher = createCipheriv('aes-256-gcm', this.encryptionKey, iv);
    const ciphertext = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()]);
    return ['v1', iv.toString('base64url'), cipher.getAuthTag().toString('base64url'), ciphertext.toString('base64url')].join('.');
  }

  decrypt(stored: string): string {
    const [version, iv, tag, ciphertext] = stored.split('.');
    if (version !== 'v1' || !iv || !tag || !ciphertext) throw new Error('Unsupported credential ciphertext.');
    const decipher = createDecipheriv('aes-256-gcm', this.encryptionKey, Buffer.from(iv, 'base64url'));
    decipher.setAuthTag(Buffer.from(tag, 'base64url'));
    return Buffer.concat([decipher.update(Buffer.from(ciphertext, 'base64url')), decipher.final()]).toString('utf8');
  }

  /** Same number, same hash, whatever spacing or case it was typed with. */
  hash(number: string): string {
    return createHmac('sha256', this.hashKey).update(normalizeCredentialNumber(number)).digest('hex');
  }
}

/** Upper case without spaces: how the number is stored, hashed, and compared. */
export const normalizeCredentialNumber = (number: string) => number.replace(/\s+/g, '').toUpperCase();

/** Only the last four characters stay readable. */
export function maskCredentialNumber(number: string): string {
  const normalized = normalizeCredentialNumber(number);
  const visible = normalized.slice(-4);
  return `${'•'.repeat(Math.max(4, normalized.length - visible.length))}${visible}`;
}
