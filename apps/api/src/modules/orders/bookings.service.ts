import { randomBytes } from 'node:crypto';
import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { AppError } from '../../common/errors/app-error';
import { sumMoney, toMoney } from '../../common/money';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { AvailabilityService } from '../availability/availability.service';
import { OutboxService } from '../notifications/outbox.service';
import type { CreateBookingDto } from './dto/order.dto';

/** `NK-261201-7Q2M4K`: date of booking plus 6 unambiguous characters. */
export function orderCode(now = new Date()) {
  const alphabet = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
  const random = Array.from(randomBytes(6), (byte) => alphabet[byte % alphabet.length]).join('');
  return `NK-${now.toISOString().slice(2, 10).replace(/-/g, '')}-${random}`;
}

/**
 * Customer booking contract (spec §5.5 steps 1–3, §7 constraints). The customer app's backend calls it; nothing here
 * trusts client-side checks: provider, offerings, mode, schedule, capacity and prices are all re-validated, and the
 * order, its item snapshots and the first history entry are written in one transaction.
 */
@Injectable()
export class BookingsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly availability: AvailabilityService,
    private readonly audit: AuditService,
    private readonly outbox: OutboxService,
  ) {}

  async create(dto: CreateBookingDto, idempotencyKey: string) {
    // AC-ORD-10: the same key returns the order it created, never a second one.
    const existing = await this.byIdempotencyKey(idempotencyKey);
    if (existing) return this.replay(existing, dto);

    const facility = await this.prisma.facility.findFirst({
      where: { id: dto.facilityId, verificationStatus: 'VERIFIED', operatingStatus: 'ACTIVE', provider: { status: 'ACTIVE' } },
      select: { id: true, displayName: true, addressLine: true, phone: true, timezone: true, provider: { select: { id: true } } },
    });
    if (!facility?.provider) throw AppError.unprocessable('FACILITY_NOT_BOOKABLE', 'This clinic is not accepting bookings.', { fields: { facilityId: ['clinic not found or not active'] } });
    if (dto.mode === 'HOMECARE' && !dto.address) throw AppError.unprocessable('VALIDATION_FAILED', 'A homecare visit needs the visit address.', { fields: { address: ['address is required for homecare'] } });

    // Same offering twice is one line with a higher quantity.
    const quantities = new Map<string, number>();
    for (const item of dto.items) quantities.set(item.offeringId, (quantities.get(item.offeringId) ?? 0) + (item.quantity ?? 1));
    const offerings = await this.prisma.serviceOffering.findMany({
      where: { id: { in: [...quantities.keys()] } },
      select: { id: true, providerId: true, masterServiceId: true, name: true, status: true, basePrice: true, durationMinutes: true, masterService: { select: { active: true, deletedAt: true } }, modes: { where: { mode: dto.mode }, select: { enabled: true, priceOverride: true, visitFee: true } } },
    });
    const byId = new Map(offerings.map((offering) => [offering.id, offering]));
    const errors: Record<string, string[]> = {};
    dto.items.forEach((item, index) => {
      const offering = byId.get(item.offeringId);
      // AC-ORD-02: every item must belong to the booked clinic's provider.
      if (!offering || offering.providerId !== facility.provider!.id) errors[`items.${index}.offeringId`] = ['service is not offered by this clinic'];
      else if (offering.status !== 'PUBLISHED' || !offering.masterService.active || offering.masterService.deletedAt) errors[`items.${index}.offeringId`] = ['service is not available'];
      else if (!offering.modes[0]?.enabled) errors[`items.${index}.offeringId`] = [`service is not offered as ${dto.mode.toLowerCase().replace('_', '-')}`];
    });
    if (Object.keys(errors).length) throw AppError.unprocessable('BOOKING_ITEMS_INVALID', 'Some services cannot be booked together at this clinic.', { fields: errors });

    const lines = [...quantities.entries()].map(([offeringId, quantity]) => {
      const offering = byId.get(offeringId)!;
      const mode = offering.modes[0]!;
      return { offering, quantity, price: toMoney(mode.priceOverride ?? offering.basePrice), visitFee: mode.visitFee ? toMoney(mode.visitFee) : null };
    });
    const durationMinutes = lines.reduce((total, line) => total + line.offering.durationMinutes * line.quantity, 0);
    const scheduledAt = new Date(dto.scheduledAt);
    await this.assertSlot(facility.id, dto.mode, scheduledAt, durationMinutes);

    // One visit, so one visit fee: the highest among the booked homecare services (working assumption, spec §1).
    const itemSubtotal = sumMoney(lines.map((line) => line.price.times(line.quantity)));
    const feeTotal = dto.mode === 'HOMECARE' ? lines.reduce((max, line) => (line.visitFee && line.visitFee.greaterThan(max) ? line.visitFee : max), new Prisma.Decimal(0)) : new Prisma.Decimal(0);
    const grandTotal = itemSubtotal.plus(feeTotal).toDecimalPlaces(2);

    try {
      const orderId = await this.prisma.$transaction(async (tx) => {
        const order = await tx.order.create({
          data: {
            code: orderCode(),
            customerId: dto.customerId,
            patientId: dto.patient.id,
            providerId: facility.provider!.id,
            facilityId: facility.id,
            mode: dto.mode,
            scheduledAt,
            timezone: facility.timezone,
            patientSnapshot: { name: dto.patient.name, phone: dto.patient.phone ?? null, sex: dto.patient.sex ?? null, birthYear: dto.patient.birthYear ?? null },
            facilitySnapshot: { displayName: facility.displayName, addressLine: facility.addressLine, phone: facility.phone, timezone: facility.timezone },
            addressSnapshot: dto.mode === 'HOMECARE' && dto.address ? { ...dto.address } : Prisma.JsonNull,
            itemSubtotal,
            feeTotal,
            grandTotal,
            status: 'PENDING_APPROVAL',
            idempotencyKey,
            items: {
              create: lines.map((line) => ({
                offeringId: line.offering.id,
                masterServiceId: line.offering.masterServiceId,
                nameSnapshot: line.offering.name,
                priceSnapshot: line.price,
                durationMinutes: line.offering.durationMinutes,
                modeSnapshot: dto.mode,
                quantity: line.quantity,
              })),
            },
            statusHistory: { create: { previousStatus: null, newStatus: 'PENDING_APPROVAL', actorId: null, reason: null } },
          },
          select: { id: true, code: true },
        });
        await this.audit.record({ actorId: null, scope: 'SYSTEM' }, { event: 'ORDER_SUBMITTED', entityType: 'Order', entityId: order.id, facilityId: facility.id, after: { code: order.code, mode: dto.mode, scheduledAt, itemCount: lines.length, grandTotal } }, tx);
        const owner = await tx.membership.findFirst({ where: { facilityId: facility.id, active: true, role: { code: 'CLINIC_OWNER_ADMIN' } }, select: { user: { select: { email: true } } } });
        await this.outbox.enqueue({ eventType: 'ORDER_SUBMITTED', entityType: 'Order', entityId: order.id, recipient: owner?.user.email, payload: { code: order.code, facilityName: facility.displayName, scheduledAt: scheduledAt.toISOString(), mode: dto.mode } }, tx);
        return order.id;
      });
      return this.summary(orderId);
    } catch (error) {
      // A concurrent retry with the same key won the insert: answer with its order.
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002' && JSON.stringify(error.meta?.target ?? '').includes('idempotencyKey')) {
        const winner = await this.byIdempotencyKey(idempotencyKey);
        if (winner) return this.replay(winner, dto);
      }
      throw error;
    }
  }

  /** What the customer app needs back; the same shape on a replay. */
  async summary(orderId: string) {
    const order = await this.prisma.order.findUniqueOrThrow({
      where: { id: orderId },
      select: { id: true, code: true, status: true, paymentStatus: true, mode: true, scheduledAt: true, timezone: true, currency: true, itemSubtotal: true, feeTotal: true, grandTotal: true, facilityId: true, createdAt: true, items: { select: { id: true, offeringId: true, nameSnapshot: true, priceSnapshot: true, quantity: true, durationMinutes: true } } },
    });
    return order;
  }

  /** The visit must start on a schedule slot with room, fit its window, and miss blocks (no tentative hold, spec §15). */
  private async assertSlot(facilityId: string, mode: 'ON_SITE' | 'HOMECARE', scheduledAt: Date, durationMinutes: number) {
    if (!(await this.availability.isBookable(facilityId, mode, scheduledAt, durationMinutes))) {
      throw AppError.unprocessable('SLOT_UNAVAILABLE', 'This visit time is not available. Pick another slot.', { fields: { scheduledAt: ['time is not an available slot for these services'] } });
    }
  }

  private byIdempotencyKey(idempotencyKey: string) {
    return this.prisma.order.findUnique({ where: { idempotencyKey }, select: { id: true, customerId: true, facilityId: true } });
  }

  /** A key belongs to one booking: reusing it for another customer or clinic is a client bug, not a retry. */
  private async replay(existing: { id: string; customerId: string; facilityId: string | null }, dto: CreateBookingDto) {
    if (existing.customerId !== dto.customerId || existing.facilityId !== dto.facilityId) {
      throw AppError.conflict('IDEMPOTENCY_KEY_REUSED', 'This Idempotency-Key was already used for a different booking.');
    }
    return this.summary(existing.id);
  }
}
