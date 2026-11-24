import { isEmail } from 'class-validator';

/** Fail closed; these values are shared by the API, CLI and dedicated worker. */
export function notificationConfig(env: Record<string, unknown>) {
  const bool = (key: string, fallback = false) => {
    const value = env[key] ?? String(fallback);
    if (![true, false, 'true', 'false'].includes(value as boolean)) throw new Error(`${key} must be true or false.`);
    return value === true || value === 'true';
  };
  const int = (key: string, fallback: number, min: number, max: number) => {
    const value = Number(env[key] ?? fallback);
    if (!Number.isInteger(value) || value < min || value > max) throw new Error(`${key} is outside its allowed range.`);
    return value;
  };
  const enabled = bool('NOTIFICATIONS_ENABLED');
  if (env.MAIL_TRANSPORT && env.MAIL_TRANSPORT !== 'smtp') throw new Error('MAIL_TRANSPORT must be smtp.');
  const mode = String(env.NOTIFICATIONS_MODE ?? 'dry-run');
  if (!['dry-run', 'live'].includes(mode)) throw new Error('NOTIFICATIONS_MODE must be dry-run or live.');
  const email = bool('NOTIFICATIONS_EMAIL_ENABLED');
  const sms = bool('NOTIFICATIONS_SMS_ENABLED');
  const secure = bool('SMTP_SECURE');
  const tls = bool('SMTP_REQUIRE_TLS', true);
  const port = int('SMTP_PORT', 587, 1, 65535);
  const cutoff = String(env.NOTIFICATIONS_LIVE_FROM ?? '');
  if (cutoff && (!/^\d{4}-\d\d-\d\dT.*Z$/.test(cutoff) || !Number.isFinite(Date.parse(cutoff)))) throw new Error('NOTIFICATIONS_LIVE_FROM must be a UTC ISO timestamp.');
  const allowlist = String(env.NOTIFICATIONS_RECIPIENT_ALLOWLIST ?? '').split(',').map((v) => v.trim().toLowerCase()).filter(Boolean);
  if (allowlist.some((v) => !isEmail(v))) throw new Error('Notification allowlist must contain valid email addresses.');
  if (enabled && mode === 'live') {
    if (!cutoff) throw new Error('Live notifications require NOTIFICATIONS_LIVE_FROM to protect old backlog.');
    if (env.NODE_ENV !== 'production' && allowlist.length === 0) throw new Error('Non-production live notifications require a recipient allowlist.');
    if (email) {
      if (String(env.SMTP_HOST ?? 'smtp.gmail.com') !== 'smtp.gmail.com' || ![465, 587].includes(port) || secure !== (port === 465) || !tls) throw new Error('Gmail requires verified TLS on port 465 (secure) or 587 (STARTTLS).');
      if (!env.SMTP_PASSWORD || !isEmail(String(env.SMTP_USER ?? '')) || env.MAIL_FROM_ADDRESS !== env.SMTP_USER) throw new Error('Gmail needs SMTP_USER, App Password and matching MAIL_FROM_ADDRESS.');
      if (env.MAIL_REPLY_TO && !isEmail(String(env.MAIL_REPLY_TO))) throw new Error('MAIL_REPLY_TO must be an email address.');
      for (const key of ['INVITATION_URL', 'PASSWORD_RESET_URL', 'WEB_ORIGIN']) {
        let url: URL;
        try { url = new URL(String(env[key])); } catch { throw new Error(`${key} must be an absolute application URL.`); }
        if (url.username || url.password || url.search || url.hash || (env.NODE_ENV === 'production' && url.protocol !== 'https:') || !['http:', 'https:'].includes(url.protocol)) throw new Error(`${key} is not a safe application URL.`);
      }
    }
    // No customer-contact/consent contract exists yet. Do not enable an unused/bypassable SMS switch.
    if (sms) throw new Error('SMS live routing is not enabled: confirm provider contract and verified customer contacts first.');
  }
  return {
    NOTIFICATIONS_ENABLED: enabled, NOTIFICATIONS_MODE: mode, NOTIFICATIONS_EMAIL_ENABLED: email,
    NOTIFICATIONS_SMS_ENABLED: sms, NOTIFICATIONS_RECIPIENT_ALLOWLIST: allowlist.join(','), NOTIFICATIONS_LIVE_FROM: cutoff,
    NOTIFICATIONS_POLL_INTERVAL_MS: int('NOTIFICATIONS_POLL_INTERVAL_MS', 5000, 1000, 60000),
    NOTIFICATIONS_BATCH_SIZE: int('NOTIFICATIONS_BATCH_SIZE', 10, 1, 100),
    NOTIFICATIONS_MAX_ATTEMPTS: int('NOTIFICATIONS_MAX_ATTEMPTS', 5, 1, 10),
    NOTIFICATIONS_CONCURRENCY: int('NOTIFICATIONS_CONCURRENCY', 1, 1, 1),
    SMTP_HOST: String(env.SMTP_HOST ?? 'smtp.gmail.com'), SMTP_PORT: port, SMTP_SECURE: secure, SMTP_REQUIRE_TLS: tls,
    MAIL_TRANSPORT: 'smtp', MAIL_FROM_NAME: String(env.MAIL_FROM_NAME ?? 'Nakes'),
    SMTP_MAX_MESSAGES_PER_MINUTE: int('SMTP_MAX_MESSAGES_PER_MINUTE', 5, 1, 60),
    SMTP_MAX_MESSAGES_PER_DAY: int('SMTP_MAX_MESSAGES_PER_DAY', 100, 1, 500),
    GO_SMS_TIMEOUT_MS: int('GO_SMS_TIMEOUT_MS', 10000, 1000, 30000),
  };
}
