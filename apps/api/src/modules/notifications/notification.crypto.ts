import { createHash, createHmac } from 'node:crypto';
import { CredentialCipher } from '../../common/crypto/credential-cipher';

/** Reuse reviewed AES-GCM implementation, with a distinct derived notification key. */
export class NotificationCipher {
  private readonly cipher: CredentialCipher;
  constructor(private readonly secret: string) {
    if (secret.length < 32) throw new Error('Notification encryption requires CREDENTIAL_ENCRYPTION_KEY.');
    this.cipher = new CredentialCipher(createHash('sha256').update(`notification:v1:${secret}`).digest('hex'));
  }
  encrypt(value: string) { return this.cipher.encrypt(value); }
  decrypt(value: string) { return this.cipher.decrypt(value); }
  recipientKey(value: string) { return createHmac('sha256', this.secret).update(`notification-recipient:${value.toLowerCase()}`).digest('hex'); }
  encode(payload: Record<string, unknown>) { return { notificationCiphertext: this.encrypt(JSON.stringify(payload)), notificationEncoding: 'v1' }; }
  decode(payload: unknown): Record<string, unknown> {
    if (!payload || typeof payload !== 'object' || Array.isArray(payload)) throw new Error('INVALID_PAYLOAD');
    const value = payload as Record<string, unknown>;
    if (value.notificationEncoding === 'v1') return JSON.parse(this.decrypt(String(value.notificationCiphertext))) as Record<string, unknown>;
    return value; // Legacy payloads are still readable; live cutoff prevents automatic backlog delivery.
  }
}
