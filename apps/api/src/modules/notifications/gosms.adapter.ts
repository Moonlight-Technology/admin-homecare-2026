import { ConfigService } from '@nestjs/config';
import { DeliveryError } from './gmail-smtp.adapter';

export function normalizeIndonesianPhone(input: string) {
  const compact = input.replace(/[\s()-]/g, '');
  const value = compact.startsWith('+62') ? compact.slice(1) : compact.startsWith('08') ? `62${compact.slice(1)}` : compact;
  if (!/^628\d{8,11}$/.test(value)) throw new DeliveryError('SMS_INVALID_PHONE', 'permanent');
  return value;
}

/** Prepared for the audited legacy v2 contract only. No SMS event routing until customer identity/consent is defined. */
export class GoSmsAdapter {
  constructor(private readonly config: ConfigService, private readonly request: typeof fetch = fetch) {}
  async send(to: string, message: string, purpose: 'OTP' | 'TRANSACTIONAL') {
    if (!this.config.get<boolean>('NOTIFICATIONS_ENABLED') || this.config.get<string>('NOTIFICATIONS_MODE') !== 'live' || !this.config.get<boolean>('NOTIFICATIONS_SMS_ENABLED') || this.config.get<string>('GO_SMS_CONTRACT') !== 'legacy-v2-confirmed') throw new DeliveryError('SMS_DISABLED_OR_UNCONFIRMED', 'permanent');
    const base = new URL(this.config.getOrThrow<string>('GO_SMS_BASE_URL'));
    const path = this.config.getOrThrow<string>(purpose === 'OTP' ? 'GO_SMS_OTP_PATH' : 'GO_SMS_TRANSACTIONAL_PATH');
    if (base.protocol !== 'https:' || base.username || base.password || base.search || base.hash || !/^\/[a-zA-Z0-9/_-]+$/.test(path) || path.startsWith('//')) throw new DeliveryError('SMS_INVALID_ENDPOINT', 'permanent');
    const target = new URL(`${base.toString().replace(/\/$/, '')}${path}`);
    if (target.origin !== base.origin) throw new DeliveryError('SMS_INVALID_ENDPOINT', 'permanent');
    const phone = normalizeIndonesianPhone(to);
    if (!message || message.length > 480) throw new DeliveryError('SMS_INVALID_MESSAGE', 'permanent');
    try {
      const response = await this.request(target, { method: 'POST', redirect: 'error', signal: AbortSignal.timeout(this.config.get<number>('GO_SMS_TIMEOUT_MS', 10000)), headers: { Authorization: `Bearer ${this.config.getOrThrow<string>('GO_SMS_API_KEY')}`, Accept: 'application/json', 'Content-Type': 'application/json' }, body: JSON.stringify({ to: phone, message, ...(this.config.get<string>('GO_SMS_SENDER') ? { sender: this.config.get<string>('GO_SMS_SENDER') } : {}) }) });
      if ([401, 403, 429].includes(response.status)) throw new DeliveryError('SMS_PROVIDER_PAUSED', 'pause');
      if (!response.ok) throw new DeliveryError('SMS_HTTP_RESULT_UNKNOWN', 'unknown');
      const result = await response.json() as { success?: boolean; data?: { queued?: number; failed?: number; id?: string } };
      if (result.success !== true || result.data?.queued !== 1 || result.data?.failed !== 0) throw new DeliveryError('SMS_BUSINESS_RESULT_UNKNOWN', 'unknown');
      return { accepted: true, messageId: typeof result.data.id === 'string' ? result.data.id.slice(0, 250) : null };
    } catch (error) { throw error instanceof DeliveryError ? error : new DeliveryError('SMS_RESULT_UNKNOWN', 'unknown'); }
  }
}
