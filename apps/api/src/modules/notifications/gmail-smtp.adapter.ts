import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import nodemailer, { type Transporter } from 'nodemailer';
import type { EmailContent } from './notification.templates';

export class DeliveryError extends Error {
  constructor(readonly safeCode: string, readonly kind: 'transient' | 'permanent' | 'unknown' | 'pause') { super(safeCode); }
}

/** Whitelist codes only: SMTP exceptions may contain recipient, token, or credential material. */
export function smtpError(error: unknown): DeliveryError {
  const value = error as { code?: string; responseCode?: number; command?: string } | null;
  if (value?.code === 'EAUTH' || [454, 534, 535].includes(value?.responseCode ?? 0)) return new DeliveryError('SMTP_AUTH_PAUSED', 'pause');
  if ([421, 452].includes(value?.responseCode ?? 0)) return new DeliveryError('SMTP_QUOTA_PAUSED', 'pause');
  if (value?.responseCode && value.responseCode >= 400 && value.responseCode < 500) return new DeliveryError('SMTP_TEMPORARY_REJECTION', 'transient');
  if (value?.responseCode && value.responseCode >= 500) return new DeliveryError('SMTP_PERMANENT_REJECTION', 'permanent');
  if (['EDNS', 'ECONNECTION'].includes(value?.code ?? '') || (value?.code === 'ETIMEDOUT' && value?.command === 'CONN')) return new DeliveryError('SMTP_CONNECTION_FAILED', 'transient');
  return new DeliveryError('SMTP_RESULT_UNKNOWN', 'unknown');
}

@Injectable()
export class GmailSmtpAdapter {
  private transport?: Transporter;
  constructor(private readonly config: ConfigService) {}
  private client() {
    this.transport ??= nodemailer.createTransport({
      host: this.config.get<string>('SMTP_HOST', 'smtp.gmail.com'), port: this.config.get<number>('SMTP_PORT', 587),
      secure: this.config.get<boolean>('SMTP_SECURE', false), requireTLS: true,
      auth: { user: this.config.getOrThrow<string>('SMTP_USER'), pass: this.config.getOrThrow<string>('SMTP_PASSWORD') },
      tls: { rejectUnauthorized: true, minVersion: 'TLSv1.2' },
      connectionTimeout: 15000, greetingTimeout: 15000, socketTimeout: 30000,
      logger: false, debug: false, disableFileAccess: true, disableUrlAccess: true,
    });
    return this.transport;
  }
  async verify() {
    try { await this.client().verify(); } catch (error) { throw smtpError(error); }
  }
  async send(to: string, content: EmailContent, deliveryId: string): Promise<string> {
    try {
      const info = await this.client().sendMail({
        from: { name: this.config.get<string>('MAIL_FROM_NAME', 'Nakes'), address: this.config.getOrThrow<string>('MAIL_FROM_ADDRESS') },
        to, replyTo: this.config.get<string>('MAIL_REPLY_TO') || undefined,
        messageId: `<${deliveryId}@nakes.notification>`, ...content,
      });
      if (!Array.isArray(info.accepted) || info.accepted.length !== 1) throw new DeliveryError('SMTP_RECIPIENT_NOT_ACCEPTED', 'permanent');
      return String(info.messageId).slice(0, 250);
    } catch (error) { throw error instanceof DeliveryError ? error : smtpError(error); }
  }
}
