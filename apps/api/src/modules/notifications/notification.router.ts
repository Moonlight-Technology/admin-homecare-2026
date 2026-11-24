import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { NotificationOutbox } from '@prisma/client';
import { isEmail } from 'class-validator';
import { PrismaService, type Db } from '../../prisma/prisma.service';
import { hashToken } from '../auth/tokens';
import { NotificationCipher } from './notification.crypto';

export type RouteResult = { recipients: string[]; payload: Record<string, unknown>; outcome: 'READY' | 'BLOCKED' | 'SKIPPED'; code: string };
export const accountEvent = (type: string) => ['ACCOUNT_INVITATION', 'PASSWORD_RESET_REQUESTED'].includes(type);
const reviewerEvents: Record<string, string> = {
  FACILITY_APPLICATION_SUBMITTED: 'facility:review', PRACTITIONER_SUBMITTED: 'practitioner:review', AFFILIATION_PROPOSED: 'practitioner:review',
};
const operational = new Set([...Object.keys(reviewerEvents), 'FACILITY_VERIFICATION_DECIDED', 'PRACTITIONER_VERIFICATION_DECIDED', 'AFFILIATION_DECIDED', 'ORDER_SUBMITTED']);

@Injectable()
export class NotificationRouter {
  readonly cipher: NotificationCipher;
  constructor(private readonly prisma: PrismaService, private readonly config: ConfigService) {
    this.cipher = new NotificationCipher(config.getOrThrow<string>('CREDENTIAL_ENCRYPTION_KEY'));
  }

  async resolve(event: NotificationOutbox, db: Db = this.prisma): Promise<RouteResult> {
    let payload: Record<string, unknown>;
    try { payload = this.cipher.decode(event.payload); } catch { return { recipients: [], payload: {}, outcome: 'BLOCKED', code: 'PAYLOAD_UNREADABLE' }; }
    const result = (outcome: RouteResult['outcome'], code: string, recipients: string[] = []): RouteResult => ({ outcome, code, recipients, payload });
    if (accountEvent(event.eventType)) {
      const invitation = event.eventType === 'ACCOUNT_INVITATION';
      const configured = this.config.get<string>(invitation ? 'INVITATION_URL' : 'PASSWORD_RESET_URL');
      let url: URL;
      let base: URL;
      try { url = new URL(String(payload[invitation ? 'invitationUrl' : 'resetUrl'])); base = new URL(String(configured)); } catch { return result('SKIPPED', 'INVALID_ACCOUNT_LINK'); }
      if (url.origin !== base.origin || url.pathname !== base.pathname || url.username || url.password || url.hash || !['http:', 'https:'].includes(url.protocol)) return result('SKIPPED', 'INVALID_ACCOUNT_LINK');
      const rawToken = url.searchParams.get('token');
      if (!rawToken || [...url.searchParams.keys()].some((key) => key !== 'token') || url.searchParams.getAll('token').length !== 1) return result('SKIPPED', 'INVALID_ACCOUNT_LINK');
      const token = await db.passwordResetToken.findUnique({ where: { tokenHash: hashToken(rawToken) }, include: { user: true } });
      if (!token || token.userId !== event.entityId || token.purpose !== (invitation ? 'INVITATION' : 'PASSWORD_RESET') || token.usedAt || token.expiresAt <= new Date() || token.user.status !== (invitation ? 'INVITED' : 'ACTIVE') || token.user.email.toLowerCase() !== event.recipient?.toLowerCase()) return result('SKIPPED', 'ACCOUNT_LINK_NOT_ELIGIBLE');
      return isEmail(token.user.email) ? result('READY', 'READY', [token.user.email.toLowerCase()]) : result('BLOCKED', 'INVALID_RECIPIENT');
    }
    if (['ORDER_STATUS_CHANGED', 'ORDER_RESCHEDULED'].includes(event.eventType)) return result('BLOCKED', 'CUSTOMER_CONTACT_UNRESOLVED');
    if (!operational.has(event.eventType)) return result('BLOCKED', 'EVENT_NOT_SUPPORTED');

    // All operational emails are generic links to an authenticated view: no patient or review notes.
    if (event.eventType === 'ORDER_SUBMITTED') {
      const order = await db.order.findUnique({ where: { id: event.entityId }, select: { status: true, scheduledAt: true, timezone: true, facilityId: true } });
      if (!order || order.status !== 'PENDING_APPROVAL' || order.scheduledAt <= new Date()) return result('SKIPPED', 'ORDER_SUPERSEDED');
      payload.scheduledAt = order.scheduledAt.toISOString(); payload.timezone = order.timezone;
      const owners = order.facilityId ? await this.owners(db, order.facilityId) : [];
      return owners.length ? result('READY', 'READY', owners) : result('BLOCKED', 'OWNER_UNRESOLVED');
    }
    const permission = reviewerEvents[event.eventType];
    if (permission) {
      // Obsolete requests no longer notify reviewers.
      if (event.eventType === 'FACILITY_APPLICATION_SUBMITTED') {
        const application = await db.facilityApplication.findUnique({ where: { id: event.entityId }, select: { status: true } });
        if (!application || application.status !== 'SUBMITTED') return result('SKIPPED', 'REVIEW_SUPERSEDED');
      } else if (event.eventType === 'PRACTITIONER_SUBMITTED') {
        const practitioner = await db.practitioner.findUnique({ where: { id: event.entityId }, select: { verificationStatus: true } });
        if (!practitioner || practitioner.verificationStatus !== 'SUBMITTED') return result('SKIPPED', 'REVIEW_SUPERSEDED');
      } else {
        const affiliation = await db.practitionerAffiliation.findUnique({ where: { id: event.entityId }, select: { status: true } });
        if (!affiliation || affiliation.status !== 'PROPOSED') return result('SKIPPED', 'REVIEW_SUPERSEDED');
      }
      const memberships = await db.membership.findMany({ where: { active: true, scopeType: 'PLATFORM', user: { status: 'ACTIVE' }, role: { permissions: { some: { permission: { code: permission } } } } }, select: { user: { select: { email: true } } } });
      const recipients = [...new Set(memberships.map((m) => m.user.email.toLowerCase()).filter((email) => isEmail(email)))];
      return recipients.length ? result('READY', 'READY', recipients) : result('BLOCKED', 'REVIEWER_UNRESOLVED');
    }
    let recipients: string[] = [];
    if (event.eventType === 'FACILITY_VERIFICATION_DECIDED') {
      const application = await db.facilityApplication.findUnique({ where: { id: event.entityId }, select: { facilityId: true } });
      if (application) recipients = await this.owners(db, application.facilityId);
    } else if (event.eventType === 'AFFILIATION_DECIDED') {
      const affiliation = await db.practitionerAffiliation.findUnique({ where: { id: event.entityId }, select: { facilityId: true } });
      if (affiliation) recipients = await this.owners(db, affiliation.facilityId);
    } else {
      const practitioner = await db.practitioner.findUnique({ where: { id: event.entityId }, select: { email: true, user: { select: { status: true } } } });
      // A current stored contact is required; a disabled linked account must not receive mail.
      if (practitioner?.email && (!practitioner.user || practitioner.user.status === 'ACTIVE')) recipients = [practitioner.email.toLowerCase()];
    }
    recipients = [...new Set(recipients.filter((email) => isEmail(email)))];
    return recipients.length ? result('READY', 'READY', recipients) : result('BLOCKED', 'RECIPIENT_UNRESOLVED');
  }

  private async owners(db: Db, facilityId: string) {
    const owners = await db.membership.findMany({ where: { facilityId, active: true, scopeType: 'FACILITY', role: { code: 'CLINIC_OWNER_ADMIN' }, user: { status: 'ACTIVE' } }, select: { user: { select: { email: true } } } });
    return [...new Set(owners.map((m) => m.user.email.toLowerCase()).filter((email) => isEmail(email)))];
  }
}
