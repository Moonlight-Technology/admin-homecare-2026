import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { AppError } from '../../common/errors/app-error';
import { PrismaService, type Db } from '../../prisma/prisma.service';
import { AuditService, type AuditSource } from '../audit/audit.service';
import type { BlockQueryDto, ClinicSlotQueryDto, CreateBlockDto, CreateScheduleDto, PublicSlotQueryDto, ScheduleQueryDto, UpdateScheduleDto } from './dto/availability.dto';
import { addDays, computeSlots, fitsVisit, localDate, localToUtc, minutesOfDay, windowsOverlap, type Block, type ComputedSlot, type Mode, type ScheduleWindow } from './slot-math';

/** How far ahead customers can see slots. A working default until the booking horizon policy is agreed (spec §15). */
export const PUBLIC_HORIZON_DAYS = 60;
const MAX_BLOCK_DAYS = 366;

const scheduleSelect = { id: true, mode: true, dayOfWeek: true, startTime: true, endTime: true, slotMinutes: true, capacityPerSlot: true, active: true, updatedAt: true } satisfies Prisma.FacilityScheduleSelect;

const presentSlot = (slot: ComputedSlot) => ({ startsAt: slot.startsAt, endsAt: slot.endsAt, capacity: slot.capacity, reserved: slot.reserved, remaining: slot.remaining, blocked: slot.blocked });

/**
 * Facility availability (spec §5.3 step 5, §14 "simple facility-level slots and capacity").
 *
 * Reservation strategy: slots are computed from weekly windows minus blocks and are not stored until capacity is
 * used. Capacity is reserved only when the clinic approves an order (spec §5.5 step 5) through `reserve`, which
 * materialises the slot and increments `reserved` with a conditional update, so concurrent approvals can never
 * overbook. Pending orders hold nothing: tentative holds are an open policy (spec §15).
 */
@Injectable()
export class AvailabilityService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  // ─── Weekly schedules ──────────────────────────────────────────────────────

  listSchedules(facilityId: string, query: ScheduleQueryDto) {
    return this.prisma.facilitySchedule.findMany({ where: { facilityId, ...(query.mode ? { mode: query.mode } : {}) }, orderBy: [{ mode: 'asc' }, { dayOfWeek: 'asc' }, { startTime: 'asc' }], select: scheduleSelect });
  }

  async createSchedule(facilityId: string, dto: CreateScheduleDto, source: AuditSource) {
    const window = { ...dto, active: dto.active ?? true };
    this.assertWindow(window);
    if (window.active) await this.assertNoOverlap(facilityId, window);
    return this.prisma.$transaction(async (tx) => {
      const created = await tx.facilitySchedule.create({ data: { facilityId, ...window }, select: scheduleSelect });
      await this.audit.record(source, { event: 'SCHEDULE_CREATED', entityType: 'FacilitySchedule', entityId: created.id, facilityId, after: window }, tx);
      return created;
    });
  }

  /** Changes apply to slots not yet reserved; reserved slots keep the capacity they were booked with. */
  async updateSchedule(facilityId: string, id: string, dto: UpdateScheduleDto, source: AuditSource) {
    const before = await this.prisma.facilitySchedule.findFirst({ where: { id, facilityId }, select: scheduleSelect });
    if (!before) throw AppError.notFound();
    const after = { mode: before.mode, dayOfWeek: before.dayOfWeek, startTime: dto.startTime ?? before.startTime, endTime: dto.endTime ?? before.endTime, slotMinutes: dto.slotMinutes ?? before.slotMinutes, capacityPerSlot: dto.capacityPerSlot ?? before.capacityPerSlot, active: dto.active ?? before.active };
    this.assertWindow(after);
    if (after.active) await this.assertNoOverlap(facilityId, after, id);
    return this.prisma.$transaction(async (tx) => {
      const updated = await tx.facilitySchedule.update({ where: { id }, data: dto, select: scheduleSelect });
      await this.audit.record(source, { event: 'SCHEDULE_UPDATED', entityType: 'FacilitySchedule', entityId: id, facilityId, before, after }, tx);
      return updated;
    });
  }

  // ─── Blocks ────────────────────────────────────────────────────────────────

  async listBlocks(facilityId: string, query: BlockQueryDto) {
    return this.prisma.scheduleBlock.findMany({
      where: { facilityId, ...(query.includePast ? {} : { endsAt: { gt: new Date() } }) },
      orderBy: { startsAt: 'asc' },
      select: { id: true, mode: true, startsAt: true, endsAt: true, reason: true, createdAt: true },
    });
  }

  async createBlock(facilityId: string, dto: CreateBlockDto, source: AuditSource) {
    const timezone = await this.timezone(facilityId);
    const { startsAt, endsAt } = this.blockRange(dto, timezone);
    return this.prisma.$transaction(async (tx) => {
      const block = await tx.scheduleBlock.create({ data: { facilityId, mode: dto.mode ?? null, startsAt, endsAt, reason: dto.reason ?? null }, select: { id: true, mode: true, startsAt: true, endsAt: true, reason: true, createdAt: true } });
      await this.audit.record(source, { event: 'SCHEDULE_BLOCK_CREATED', entityType: 'ScheduleBlock', entityId: block.id, facilityId, after: { mode: block.mode, startsAt, endsAt, reason: block.reason } }, tx);
      return block;
    });
  }

  async deleteBlock(facilityId: string, id: string, source: AuditSource) {
    const block = await this.prisma.scheduleBlock.findFirst({ where: { id, facilityId } });
    if (!block) throw AppError.notFound();
    await this.prisma.$transaction(async (tx) => {
      await tx.scheduleBlock.delete({ where: { id } });
      await this.audit.record(source, { event: 'SCHEDULE_BLOCK_DELETED', entityType: 'ScheduleBlock', entityId: id, facilityId, before: { mode: block.mode, startsAt: block.startsAt, endsAt: block.endsAt, reason: block.reason } }, tx);
    });
  }

  // ─── Slots ─────────────────────────────────────────────────────────────────

  /** Clinic view: every slot with capacity, confirmed reservations, waiting orders, and blocks. */
  async clinicSlots(facilityId: string, query: ClinicSlotQueryDto) {
    const days = query.days ?? 7;
    const { slots, timezone } = await this.slotsFor(facilityId, query.mode, query.from, days);
    const rangeStart = localToUtc(query.from, 0, timezone);
    const rangeEnd = localToUtc(addDays(query.from, days), 0, timezone);
    const pending = await this.prisma.order.groupBy({ by: ['scheduledAt'], where: { facilityId, mode: query.mode, status: 'PENDING_APPROVAL', scheduledAt: { gte: rangeStart, lt: rangeEnd } }, _count: { _all: true } });
    const pendingByStart = new Map(pending.map((row) => [row.scheduledAt.getTime(), row._count._all]));
    return {
      timezone,
      mode: query.mode,
      from: query.from,
      days,
      slots: slots.map((slot) => ({ ...presentSlot(slot), pendingOrders: pendingByStart.get(slot.startsAt.getTime()) ?? 0 })),
    };
  }

  /**
   * Customer view for one local date (spec §8): only public clinics, only start times where the whole visit — the
   * summed duration of the chosen offerings — fits before the window closes, misses blocks, and has capacity left.
   */
  async publicSlots(facilityId: string, query: PublicSlotQueryDto, now = new Date()) {
    const facility = await this.prisma.facility.findFirst({ where: { id: facilityId, verificationStatus: 'VERIFIED', operatingStatus: 'ACTIVE', provider: { status: 'ACTIVE' } }, select: { timezone: true } });
    if (!facility) throw AppError.notFound();
    const today = localDate(now, facility.timezone);
    if (query.date < today || query.date > addDays(today, PUBLIC_HORIZON_DAYS)) {
      throw AppError.unprocessable('DATE_OUT_OF_RANGE', `Choose a date from today up to ${PUBLIC_HORIZON_DAYS} days ahead.`, { fields: { date: ['date is outside the booking horizon'] } });
    }
    const durationMinutes = await this.visitDuration(facilityId, query.mode, query.offeringIds ?? []);
    const { slots, blocks } = await this.slotsFor(facilityId, query.mode, query.date, 1);
    return {
      date: query.date,
      mode: query.mode,
      timezone: facility.timezone,
      durationMinutes,
      slots: slots.filter((slot) => fitsVisit(slot, durationMinutes, blocks, now)).map((slot) => ({ startsAt: slot.startsAt, endsAt: new Date(slot.startsAt.getTime() + durationMinutes * 60_000), remaining: slot.remaining })),
    };
  }

  /** Order snapshots, not today's offering durations/prices, determine the replacement visit length. */
  async slotsForVisit(facilityId: string, mode: Mode, date: string, durationMinutes: number, now = new Date()) {
    const timezone = await this.timezone(facilityId);
    const today = localDate(now, timezone);
    if (date < today || date > addDays(today, PUBLIC_HORIZON_DAYS)) throw AppError.unprocessable('DATE_OUT_OF_RANGE', 'Choose a local date within the 60-day booking horizon.');
    const { slots, blocks } = await this.slotsFor(facilityId, mode, date, 1);
    return { date, mode, timezone, durationMinutes, slots: slots.filter((slot) => fitsVisit(slot, durationMinutes, blocks, now)).map((slot) => ({ startsAt: slot.startsAt, endsAt: new Date(slot.startsAt.getTime() + durationMinutes * 60_000), remaining: slot.remaining })) };
  }

  /** Whether a new booking may start at `startsAt`: same rules as the public slot list, for the whole visit length. */
  async isBookable(facilityId: string, mode: Mode, startsAt: Date, durationMinutes: number, now = new Date()) {
    const timezone = await this.timezone(facilityId);
    const date = localDate(startsAt, timezone);
    const today = localDate(now, timezone);
    if (date < today || date > addDays(today, PUBLIC_HORIZON_DAYS)) return false;
    const { slots, blocks } = await this.slotsFor(facilityId, mode, date, 1);
    const slot = slots.find((candidate) => candidate.startsAt.getTime() === startsAt.getTime());
    return Boolean(slot && fitsVisit(slot, durationMinutes, blocks, now));
  }

  /**
   * Reserves one visit at `startsAt` inside the caller's transaction (used when an order is approved, S6). The slot
   * must exist in the schedule, not be blocked, and still have capacity; the increment is conditional, so two
   * approvals racing for the last place cannot both succeed.
   */
  async reserve(tx: Db, input: { facilityId: string; mode: Mode; startsAt: Date; durationMinutes: number }, now?: Date) {
    const timezone = await this.timezone(input.facilityId, tx);
    const date = localDate(input.startsAt, timezone);
    if (now && (date < localDate(now, timezone) || date > addDays(localDate(now, timezone), PUBLIC_HORIZON_DAYS))) throw AppError.conflict('SLOT_UNAVAILABLE', 'Choose a future slot within the booking horizon.');
    const { slots, blocks } = await this.slotsFor(input.facilityId, input.mode, date, 1, tx);
    const slot = slots.find((candidate) => candidate.startsAt.getTime() === input.startsAt.getTime());
    if (!slot) throw AppError.conflict('SLOT_UNAVAILABLE', 'The visit time is no longer in the clinic schedule.');
    if (!fitsVisit({ ...slot, remaining: Math.max(slot.remaining, 1) }, input.durationMinutes, blocks, now ?? new Date(0))) throw AppError.conflict('SLOT_UNAVAILABLE', 'The visit time is blocked, past, or does not fit the clinic schedule.');

    // skipDuplicates (INSERT … ON CONFLICT DO NOTHING) instead of upsert: a concurrent first reservation must not raise
    // a unique violation, which would abort the caller's whole transaction in PostgreSQL. Typed queries rather than raw
    // SQL keep the schema-qualified table names, whatever the connection's search_path.
    await tx.facilitySlot.createMany({ data: [{ facilityId: input.facilityId, mode: input.mode, startsAt: input.startsAt, endsAt: slot.endsAt, capacity: slot.capacity }], skipDuplicates: true });
    const row = await tx.facilitySlot.findUniqueOrThrow({ where: { facilityId_mode_startsAt: { facilityId: input.facilityId, mode: input.mode, startsAt: input.startsAt } }, select: { id: true } });
    // `reserved < capacity` compares two columns in the same UPDATE, so the last place goes to exactly one caller.
    const taken = await tx.facilitySlot.updateMany({ where: { id: row.id, reserved: { lt: tx.facilitySlot.fields.capacity } }, data: { reserved: { increment: 1 }, version: { increment: 1 } } });
    if (taken.count === 0) throw AppError.conflict('SLOT_FULL', 'This visit time is fully booked.');
    return row.id;
  }

  /** Gives one reserved place back (e.g. a confirmed order later cancelled through an approved process). */
  async release(tx: Db, slotId: string, facilityId: string) {
    const released = await tx.facilitySlot.updateMany({ where: { id: slotId, facilityId, reserved: { gt: 0 } }, data: { reserved: { decrement: 1 }, version: { increment: 1 } } });
    if (!released.count) throw AppError.conflict('SLOT_RESERVATION_MISSING', 'The slot reservation could not be released. Reload or contact an administrator.');
  }

  // ─── Helpers ───────────────────────────────────────────────────────────────

  private async slotsFor(facilityId: string, mode: Mode, fromDate: string, days: number, db: Db = this.prisma) {
    const timezone = await this.timezone(facilityId, db);
    const rangeStart = localToUtc(fromDate, 0, timezone);
    const rangeEnd = localToUtc(addDays(fromDate, days), 0, timezone);
    const [windows, blockRows, reserved] = await Promise.all([
      db.facilitySchedule.findMany({ where: { facilityId, mode, active: true }, select: scheduleSelect }),
      db.scheduleBlock.findMany({ where: { facilityId, startsAt: { lt: rangeEnd }, endsAt: { gt: rangeStart }, OR: [{ mode: null }, { mode }] }, select: { mode: true, startsAt: true, endsAt: true } }),
      db.facilitySlot.findMany({ where: { facilityId, mode, startsAt: { gte: rangeStart, lt: rangeEnd } }, select: { mode: true, startsAt: true, capacity: true, reserved: true } }),
    ]);
    const blocks: Block[] = blockRows;
    return { timezone, blocks, slots: computeSlots({ mode, fromDate, days, timezone, windows: windows as ScheduleWindow[], blocks, reserved }) };
  }

  /** Sum of the chosen offerings' durations; each must be a published offering of this clinic with the mode enabled. */
  private async visitDuration(facilityId: string, mode: Mode, offeringIds: string[]) {
    if (!offeringIds.length) return 0;
    const unique = [...new Set(offeringIds)];
    const offerings = await this.prisma.serviceOffering.findMany({
      where: { id: { in: unique }, status: 'PUBLISHED', provider: { facilityId }, masterService: { active: true, deletedAt: null }, modes: { some: { mode, enabled: true } } },
      select: { id: true, durationMinutes: true },
    });
    if (offerings.length !== unique.length) throw AppError.unprocessable('OFFERING_NOT_AVAILABLE', 'Some services are not available at this clinic for this mode.', { fields: { offeringIds: ['one or more services are not bookable here in this mode'] } });
    return offerings.reduce((total, offering) => total + offering.durationMinutes, 0);
  }

  private async timezone(facilityId: string, db: Db = this.prisma) {
    const facility = await db.facility.findUnique({ where: { id: facilityId }, select: { timezone: true } });
    if (!facility) throw AppError.notFound();
    return facility.timezone;
  }

  private assertWindow(window: Pick<ScheduleWindow, 'startTime' | 'endTime' | 'slotMinutes'>) {
    const length = minutesOfDay(window.endTime) - minutesOfDay(window.startTime);
    if (length <= 0) throw AppError.unprocessable('VALIDATION_FAILED', 'The closing time must be after the opening time.', { fields: { endTime: ['endTime must be after startTime'] } });
    if (window.slotMinutes > length) throw AppError.unprocessable('VALIDATION_FAILED', 'The slot is longer than the opening hours.', { fields: { slotMinutes: ['slotMinutes must fit inside the window'] } });
  }

  /** Active windows of one mode and day must not overlap, or the same slot would be offered twice. */
  private async assertNoOverlap(facilityId: string, window: Pick<ScheduleWindow, 'mode' | 'dayOfWeek' | 'startTime' | 'endTime'>, exceptId?: string) {
    const siblings = await this.prisma.facilitySchedule.findMany({ where: { facilityId, mode: window.mode, dayOfWeek: window.dayOfWeek, active: true, ...(exceptId ? { id: { not: exceptId } } : {}) }, select: { id: true, startTime: true, endTime: true } });
    const clash = siblings.find((sibling) => windowsOverlap(sibling, window));
    if (clash) throw AppError.conflict('SCHEDULE_OVERLAP', `These hours overlap an existing window (${clash.startTime}–${clash.endTime}).`, { scheduleId: clash.id });
  }

  /** Local whole days, or a time range on one local day, → UTC instants. */
  private blockRange(dto: CreateBlockDto, timezone: string) {
    const endDate = dto.endDate ?? dto.startDate;
    if (endDate < dto.startDate) throw AppError.unprocessable('VALIDATION_FAILED', 'The end date must not be before the start date.', { fields: { endDate: ['endDate must not be before startDate'] } });
    if (Boolean(dto.startTime) !== Boolean(dto.endTime)) throw AppError.unprocessable('VALIDATION_FAILED', 'Give both a start and an end time, or neither for whole days.', { fields: { endTime: ['startTime and endTime go together'] } });
    if (dto.startTime && dto.endTime) {
      if (endDate !== dto.startDate) throw AppError.unprocessable('VALIDATION_FAILED', 'A time range closes a single day.', { fields: { endDate: ['use one day with a time range'] } });
      if (minutesOfDay(dto.endTime) <= minutesOfDay(dto.startTime)) throw AppError.unprocessable('VALIDATION_FAILED', 'The end time must be after the start time.', { fields: { endTime: ['endTime must be after startTime'] } });
      return { startsAt: localToUtc(dto.startDate, minutesOfDay(dto.startTime), timezone), endsAt: localToUtc(dto.startDate, minutesOfDay(dto.endTime), timezone) };
    }
    const startsAt = localToUtc(dto.startDate, 0, timezone);
    const endsAt = localToUtc(addDays(endDate, 1), 0, timezone);
    if (endsAt.getTime() - startsAt.getTime() > MAX_BLOCK_DAYS * 86_400_000) throw AppError.unprocessable('VALIDATION_FAILED', `A block can cover at most ${MAX_BLOCK_DAYS} days.`, { fields: { endDate: ['block is too long'] } });
    return { startsAt, endsAt };
  }
}
