import { ConfigService } from '@nestjs/config';
import type { NotificationOutbox } from '@prisma/client';
import nodemailer from 'nodemailer';
import type { PrismaService } from '../../prisma/prisma.service';
import { hashToken } from '../auth/tokens';
import { DeliveryError, GmailSmtpAdapter, smtpError } from './gmail-smtp.adapter';
import { GoSmsAdapter, normalizeIndonesianPhone } from './gosms.adapter';
import { notificationConfig } from './notification.config';
import { NotificationCipher } from './notification.crypto';
import type { NotificationRepository } from './notification.repository';
import { NotificationRouter } from './notification.router';
import { renderEmail } from './notification.templates';
import { NotificationWorker } from './notification.worker';

jest.mock('nodemailer', () => ({ __esModule: true, default: { createTransport: jest.fn() } }));
const secret = 'notification-test-only-'.repeat(3);
const base = { CREDENTIAL_ENCRYPTION_KEY: secret, WEB_ORIGIN: 'http://localhost:3000', INVITATION_URL: 'http://localhost:3000/accept-invitation', PASSWORD_RESET_URL: 'http://localhost:3000/reset-password' };
const config = (extra: Record<string, unknown> = {}) => new ConfigService({ ...base, ...extra });
const rawToken = 'test-token';
const event = (extra: Record<string, unknown> = {}) => ({ id: 'event-1', eventType: 'ACCOUNT_INVITATION', entityId: 'user-1', recipient: 'user@example.test', payload: { invitationUrl: `${base.INVITATION_URL}?token=${rawToken}` }, ...extra } as unknown as NotificationOutbox);
const storedToken = () => ({ userId: 'user-1', purpose: 'INVITATION', usedAt: null, expiresAt: new Date(Date.now() + 60000), user: { email: 'user@example.test', status: 'INVITED' } });

describe('notification configuration', () => {
  it('is disabled by default and parses false literally', () => {
    expect(notificationConfig({}).NOTIFICATIONS_ENABLED).toBe(false);
    expect(notificationConfig({ NOTIFICATIONS_ENABLED: 'false' }).NOTIFICATIONS_ENABLED).toBe(false);
  });
  it.each(['yes', '0', '', 'False'])('rejects invalid booleans: %s', (value) => expect(() => notificationConfig({ NOTIFICATIONS_ENABLED: value })).toThrow());
  it('rejects live mode without cutoff and non-production allowlist', () => {
    expect(() => notificationConfig({ NOTIFICATIONS_ENABLED: 'true', NOTIFICATIONS_MODE: 'live' })).toThrow('LIVE_FROM');
    expect(() => notificationConfig({ NOTIFICATIONS_ENABLED: 'true', NOTIFICATIONS_MODE: 'live', NOTIFICATIONS_LIVE_FROM: new Date().toISOString() })).toThrow('allowlist');
  });
  it('rejects insecure SMTP, mismatched sender, unsafe URL and SMS live routing', () => {
    const env = { ...base, NOTIFICATIONS_ENABLED: 'true', NOTIFICATIONS_MODE: 'live', NOTIFICATIONS_EMAIL_ENABLED: 'true', NOTIFICATIONS_LIVE_FROM: new Date().toISOString(), NOTIFICATIONS_RECIPIENT_ALLOWLIST: 'user@example.test', SMTP_USER: 'sender@gmail.com', SMTP_PASSWORD: 'fake-app-password', MAIL_FROM_ADDRESS: 'sender@gmail.com' };
    expect(notificationConfig(env).SMTP_REQUIRE_TLS).toBe(true);
    expect(() => notificationConfig({ ...env, SMTP_REQUIRE_TLS: 'false' })).toThrow();
    expect(() => notificationConfig({ ...env, SMTP_PORT: '465' })).toThrow();
    expect(notificationConfig({ ...env, SMTP_PORT: '465', SMTP_SECURE: 'true' }).SMTP_SECURE).toBe(true);
    expect(() => notificationConfig({ ...env, MAIL_FROM_ADDRESS: 'other@gmail.com' })).toThrow();
    expect(() => notificationConfig({ ...env, INVITATION_URL: 'javascript:bad' })).toThrow();
    expect(() => notificationConfig({ ...env, NOTIFICATIONS_SMS_ENABLED: 'true' })).toThrow('SMS');
  });
  it('rejects malformed allowlist, cutoff, and quota', () => {
    expect(() => notificationConfig({ NOTIFICATIONS_RECIPIENT_ALLOWLIST: 'not-email' })).toThrow();
    expect(() => notificationConfig({ NOTIFICATIONS_LIVE_FROM: 'yesterday' })).toThrow();
    expect(() => notificationConfig({ SMTP_MAX_MESSAGES_PER_DAY: 'NaN' })).toThrow();
    expect(() => notificationConfig({ NOTIFICATIONS_CONCURRENCY: 2 })).toThrow();
  });
});

describe('notification payload protection', () => {
  const cipher = new NotificationCipher(secret);
  it('encrypts nondeterministically and authenticates ciphertext', () => {
    const a = cipher.encode({ token: rawToken });
    const b = cipher.encode({ token: rawToken });
    expect(a).not.toEqual(b);
    expect(JSON.stringify(a)).not.toContain(rawToken);
    expect(cipher.decode(a)).toEqual({ token: rawToken });
    expect(() => new NotificationCipher('another-secret-'.repeat(3)).decode(a)).toThrow();
  });
  it('hashes recipient keys and reads legacy payloads', () => {
    expect(cipher.recipientKey('USER@example.test')).toBe(cipher.recipientKey('user@example.test'));
    expect(cipher.recipientKey('user@example.test')).not.toContain('user@');
    expect(cipher.decode({ legacy: true })).toEqual({ legacy: true });
  });
});

describe('account eligibility and recipient routing', () => {
  it('checks the hashed one-time token and supports encrypted payloads', async () => {
    const lookup = jest.fn().mockResolvedValue(storedToken());
    const router = new NotificationRouter({ passwordResetToken: { findUnique: lookup } } as unknown as PrismaService, config());
    const source = event();
    source.payload = router.cipher.encode(source.payload as Record<string, unknown>);
    expect((await router.resolve(source)).recipients).toEqual(['user@example.test']);
    expect(lookup).toHaveBeenCalledWith(expect.objectContaining({ where: { tokenHash: hashToken(rawToken) } }));
  });
  it.each([
    { usedAt: new Date() }, { expiresAt: new Date(0) }, { purpose: 'PASSWORD_RESET' }, { userId: 'other-user' },
    { user: { status: 'DISABLED', email: 'user@example.test' } }, { user: { status: 'INVITED', email: 'changed@example.test' } },
  ])('skips an invalid/superseded token: %j', async (change) => {
    const router = new NotificationRouter({ passwordResetToken: { findUnique: jest.fn().mockResolvedValue({ ...storedToken(), ...change }) } } as unknown as PrismaService, config());
    expect((await router.resolve(event())).outcome).toBe('SKIPPED');
  });
  it('rejects foreign account links before querying tokens', async () => {
    const router = new NotificationRouter({} as PrismaService, config());
    expect((await router.resolve(event({ payload: { invitationUrl: 'https://attacker.test/accept-invitation?token=secret' } }))).code).toBe('INVALID_ACCOUNT_LINK');
  });
  it.each(['ORDER_RESCHEDULED', 'ORDER_STATUS_CHANGED'])('blocks %s instead of using a patient phone', async (type) => {
    const router = new NotificationRouter({} as PrismaService, config());
    const route = await router.resolve(event({ eventType: type, payload: { patientSnapshot: { phone: '081234567890' } } }));
    expect(route.code).toBe('CUSTOMER_CONTACT_UNRESOLVED'); expect(route.recipients).toEqual([]);
  });
  it('blocks unreadable payloads without exposing decryption errors', async () => {
    const router = new NotificationRouter({} as PrismaService, config());
    expect((await router.resolve(event({ payload: { notificationEncoding: 'v1', notificationCiphertext: 'corrupt' } }))).code).toBe('PAYLOAD_UNREADABLE');
  });
  it('resolves only active platform reviewers with the specific permission and deduplicates emails', async () => {
    const memberships = jest.fn().mockResolvedValue([{ user: { email: 'reviewer@example.test' } }, { user: { email: 'REVIEWER@example.test' } }]);
    const router = new NotificationRouter({ membership: { findMany: memberships }, facilityApplication: { findUnique: jest.fn().mockResolvedValue({ status: 'SUBMITTED' }) } } as unknown as PrismaService, config());
    const route = await router.resolve(event({ eventType: 'FACILITY_APPLICATION_SUBMITTED', payload: {} }));
    expect(route.recipients).toEqual(['reviewer@example.test']);
    expect(memberships).toHaveBeenCalledWith(expect.objectContaining({ where: expect.objectContaining({ active: true, scopeType: 'PLATFORM', user: { status: 'ACTIVE' }, role: { permissions: { some: { permission: { code: 'facility:review' } } } } }) }));
  });
  it('does not notify reviewers about a request that was already decided', async () => {
    const router = new NotificationRouter({ practitioner: { findUnique: jest.fn().mockResolvedValue({ verificationStatus: 'VERIFIED' }) } } as unknown as PrismaService, config());
    expect((await router.resolve(event({ eventType: 'PRACTITIONER_SUBMITTED', payload: {} }))).code).toBe('REVIEW_SUPERSEDED');
  });
  it('refreshes order time/timezone and resolves owners from current active memberships', async () => {
    const owners = jest.fn().mockResolvedValue([{ user: { email: 'owner@example.test' } }]);
    const router = new NotificationRouter({ order: { findUnique: jest.fn().mockResolvedValue({ status: 'PENDING_APPROVAL', scheduledAt: new Date(Date.now() + 86400000), timezone: 'Asia/Jayapura', facilityId: 'clinic-id' }) }, membership: { findMany: owners } } as unknown as PrismaService, config());
    const route = await router.resolve(event({ eventType: 'ORDER_SUBMITTED', recipient: 'stale-owner@example.test', payload: {} }));
    expect(route.recipients).toEqual(['owner@example.test']); expect(route.payload.timezone).toBe('Asia/Jayapura');
    expect(owners).toHaveBeenCalledWith(expect.objectContaining({ where: expect.objectContaining({ facilityId: 'clinic-id', scopeType: 'FACILITY', active: true, user: { status: 'ACTIVE' }, role: { code: 'CLINIC_OWNER_ADMIN' } }) }));
  });
  it('skips old order notifications after status or schedule is obsolete', async () => {
    const router = new NotificationRouter({ order: { findUnique: jest.fn().mockResolvedValue({ status: 'CANCELLED', scheduledAt: new Date(), facilityId: 'clinic-id' }) } } as unknown as PrismaService, config());
    expect((await router.resolve(event({ eventType: 'ORDER_SUBMITTED', payload: {} }))).code).toBe('ORDER_SUPERSEDED');
  });
  it('blocks a practitioner whose linked account was disabled', async () => {
    const router = new NotificationRouter({ practitioner: { findUnique: jest.fn().mockResolvedValue({ email: 'nakes@example.test', user: { status: 'DISABLED' } }) } } as unknown as PrismaService, config());
    expect((await router.resolve(event({ eventType: 'PRACTITIONER_VERIFICATION_DECIDED', payload: {} }))).outcome).toBe('BLOCKED');
  });
});

describe('SMTP adapter and safe templates', () => {
  it('escapes HTML and excludes patient/review fields', () => {
    const rendered = renderEmail('ORDER_SUBMITTED', { code: '<script>evil</script>', reason: 'PRIVATE-REASON', patientSnapshot: { name: 'PRIVATE-PATIENT' }, scheduledAt: '2026-12-01T03:00:00Z', timezone: 'Asia/Makassar' }, base.WEB_ORIGIN);
    expect(rendered.html).toContain('&lt;script&gt;');
    expect(rendered.html).not.toContain('<script>'); expect(rendered.text).toContain('Asia/Makassar');
    expect(JSON.stringify(rendered)).not.toContain('PRIVATE-');
  });
  it('requires an SMTP accepted recipient, uses TLS, and never enables protocol debug', async () => {
    const sendMail = jest.fn().mockResolvedValue({ accepted: ['user@example.test'], messageId: 'provider-id' });
    (nodemailer.createTransport as jest.Mock).mockReturnValue({ sendMail });
    const adapter = new GmailSmtpAdapter(config({ SMTP_USER: 'sender@gmail.com', SMTP_PASSWORD: 'fake-only', MAIL_FROM_ADDRESS: 'sender@gmail.com' }));
    expect(await adapter.send('user@example.test', { subject: 'Test', text: 'test', html: '<p>test</p>' }, 'id')).toBe('provider-id');
    expect(nodemailer.createTransport).toHaveBeenCalledWith(expect.objectContaining({ requireTLS: true, tls: { rejectUnauthorized: true, minVersion: 'TLSv1.2' }, debug: false }));
    sendMail.mockResolvedValueOnce({ accepted: [] });
    await expect(adapter.send('user@example.test', { subject: 'Test', text: '', html: '' }, 'id')).rejects.toMatchObject({ safeCode: 'SMTP_RECIPIENT_NOT_ACCEPTED' });
  });
  it.each([
    [{ code: 'EAUTH' }, 'pause'], [{ responseCode: 452 }, 'pause'], [{ responseCode: 450 }, 'transient'],
    [{ responseCode: 550 }, 'permanent'], [{ code: 'ETIMEDOUT', command: 'CONN' }, 'transient'],
    [{ code: 'ETIMEDOUT', command: 'DATA' }, 'unknown'], [{ message: 'password-and-secret-token' }, 'unknown'],
  ])('sanitizes SMTP errors: %j', (error, kind) => { const failure = smtpError(error); expect(failure.kind).toBe(kind); expect(failure.message).not.toContain('secret'); });
});

describe('prepared GoSMS adapter', () => {
  it.each(['081234567890', '+6281234567890', '6281234567890'])('normalizes %s', (phone) => expect(normalizeIndonesianPhone(phone)).toBe('6281234567890'));
  it('rejects invalid numbers and remains disabled', async () => {
    expect(() => normalizeIndonesianPhone('123')).toThrow();
    const request = jest.fn();
    await expect(new GoSmsAdapter(config(), request).send('081234567890', 'hello', 'OTP')).rejects.toMatchObject({ safeCode: 'SMS_DISABLED_OR_UNCONFIRMED' });
    expect(request).not.toHaveBeenCalled();
  });
  const smsConfig = () => config({ NOTIFICATIONS_ENABLED: true, NOTIFICATIONS_MODE: 'live', NOTIFICATIONS_SMS_ENABLED: true, GO_SMS_CONTRACT: 'legacy-v2-confirmed', GO_SMS_BASE_URL: 'https://provider.example.test/api/v2', GO_SMS_OTP_PATH: '/sms-otp/send', GO_SMS_API_KEY: 'fake-key' });
  it('checks the business response, not just HTTP 200', async () => {
    const request = jest.fn().mockResolvedValue({ ok: true, status: 200, json: async () => ({ success: true, data: { queued: 1, failed: 0 } }) });
    expect(await new GoSmsAdapter(smsConfig(), request).send('081234567890', 'OTP test', 'OTP')).toEqual({ accepted: true, messageId: null });
    request.mockResolvedValueOnce({ ok: true, status: 200, json: async () => ({ success: false }) });
    await expect(new GoSmsAdapter(smsConfig(), request).send('081234567890', 'test', 'OTP')).rejects.toMatchObject({ kind: 'unknown' });
  });
  it('does not blindly retry timeout or provider failure', async () => {
    const request = jest.fn().mockRejectedValue(new Error('secret-provider-response'));
    await expect(new GoSmsAdapter(smsConfig(), request).send('081234567890', 'test', 'OTP')).rejects.toMatchObject({ safeCode: 'SMS_RESULT_UNKNOWN', kind: 'unknown' });
    expect(request).toHaveBeenCalledTimes(1);
  });
});

describe('worker safety', () => {
  function setup(extra: Record<string, unknown> = {}) {
    const cfg = config({ NOTIFICATIONS_ENABLED: true, NOTIFICATIONS_MODE: 'live', NOTIFICATIONS_EMAIL_ENABLED: true, NOTIFICATIONS_LIVE_FROM: '2026-01-01T00:00:00Z', ...extra });
    const repository = { heartbeat: jest.fn(), simulate: jest.fn(), maintenance: jest.fn(), recoverExpired: jest.fn(), materialize: jest.fn(), claim: jest.fn().mockResolvedValueOnce({ id: 'delivery', outboxId: 'event', recipientEncrypted: 'encrypted', attempts: 0, leaseToken: 'lease' }).mockResolvedValue(null), submitted: jest.fn().mockResolvedValue(true), reserveBudget: jest.fn().mockResolvedValue(null), finish: jest.fn(), pause: jest.fn() };
    const router = { cipher: { decrypt: () => 'user@example.test' }, resolve: jest.fn().mockResolvedValue({ outcome: 'READY', recipients: ['user@example.test'], payload: { invitationUrl: `${base.INVITATION_URL}?token=fake` } }) };
    const email = { send: jest.fn().mockResolvedValue('id') };
    const db = { notificationOutbox: { findUniqueOrThrow: jest.fn().mockResolvedValue(event({ createdAt: new Date() })) } };
    const worker = new NotificationWorker(db as unknown as PrismaService, cfg, repository as unknown as NotificationRepository, router as unknown as NotificationRouter, email as unknown as GmailSmtpAdapter);
    return { worker, repository, router, email };
  }
  it('does nothing when disabled', async () => { const t = setup({ NOTIFICATIONS_ENABLED: false }); await t.worker.tick(); expect(t.repository.claim).not.toHaveBeenCalled(); expect(t.email.send).not.toHaveBeenCalled(); });
  it('simulates without touching live claims or sending', async () => { const t = setup({ NOTIFICATIONS_MODE: 'dry-run' }); await t.worker.tick(); expect(t.repository.simulate).toHaveBeenCalled(); expect(t.repository.materialize).not.toHaveBeenCalled(); expect(t.email.send).not.toHaveBeenCalled(); });
  it('does not send after losing its fencing token', async () => { const t = setup(); t.repository.submitted.mockResolvedValue(false); await t.worker.tick(); expect(t.email.send).not.toHaveBeenCalled(); });
  it('never redirects unallowlisted account tokens', async () => { const t = setup({ NOTIFICATIONS_RECIPIENT_ALLOWLIST: 'other@example.test' }); await t.worker.tick(); expect(t.email.send).not.toHaveBeenCalled(); expect(t.repository.finish).toHaveBeenCalledWith(expect.anything(), 'BLOCKED', 'RECIPIENT_NOT_ALLOWLISTED'); });
  it('marks SMTP accepted, not delivered', async () => { const t = setup(); await t.worker.tick(); expect(t.repository.finish).toHaveBeenCalledWith(expect.anything(), 'ACCEPTED', null, { messageId: 'id' }); });
  it('does not retry an ambiguous provider result', async () => { const t = setup(); t.email.send.mockRejectedValue(new DeliveryError('SMTP_RESULT_UNKNOWN', 'unknown')); await t.worker.tick(); expect(t.repository.finish).toHaveBeenCalledWith(expect.anything(), 'UNKNOWN', 'SMTP_RESULT_UNKNOWN'); });
  it('retries transient rejection with backoff', async () => { const t = setup(); t.email.send.mockRejectedValue(new DeliveryError('SMTP_TEMPORARY_REJECTION', 'transient')); await t.worker.tick(); expect(t.repository.finish).toHaveBeenCalledWith(expect.anything(), 'PENDING', 'SMTP_TEMPORARY_REJECTION', expect.objectContaining({ availableAt: expect.any(Date) })); });
  it('pauses the shared channel on auth failure', async () => { const t = setup(); t.email.send.mockRejectedValue(new DeliveryError('SMTP_AUTH_PAUSED', 'pause')); await t.worker.tick(); expect(t.repository.pause).toHaveBeenCalledWith('SMTP_AUTH_PAUSED', expect.any(Date)); });
  it('does not spend an SMTP call when shared quota is exhausted', async () => { const t = setup(); const next = new Date(Date.now() + 60000); t.repository.reserveBudget.mockResolvedValue(next); await t.worker.tick(); expect(t.email.send).not.toHaveBeenCalled(); expect(t.repository.finish).toHaveBeenCalledWith(expect.anything(), 'PENDING', 'CHANNEL_PAUSED_OR_RATE_LIMITED', { availableAt: next }); });
  it('does not send after stop is requested', async () => { const t = setup(); t.worker.stop(); await t.worker.tick(); expect(t.repository.claim).not.toHaveBeenCalled(); expect(t.email.send).not.toHaveBeenCalled(); });
  it('enforces maximum retry attempts', async () => { const t = setup({ NOTIFICATIONS_MAX_ATTEMPTS: 1 }); t.email.send.mockRejectedValue(new DeliveryError('SMTP_TEMPORARY_REJECTION', 'transient')); await t.worker.tick(); expect(t.repository.finish).toHaveBeenCalledWith(expect.anything(), 'FAILED', 'SMTP_TEMPORARY_REJECTION'); });
});
