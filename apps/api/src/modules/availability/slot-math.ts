/**
 * Slot arithmetic without I/O (spec §5.3 step 5, §7). Weekly schedules are in the facility's local time; Indonesian
 * zones have no daylight saving, so a fixed offset converts local wall time to UTC exactly.
 */
export const TIMEZONE_OFFSET_MINUTES: Record<string, number> = { 'Asia/Jakarta': 420, 'Asia/Makassar': 480, 'Asia/Jayapura': 540 };

export type Mode = 'ON_SITE' | 'HOMECARE';
export type ScheduleWindow = { id: string; mode: Mode; dayOfWeek: number; startTime: string; endTime: string; slotMinutes: number; capacityPerSlot: number; active: boolean };
export type Block = { mode: Mode | null; startsAt: Date; endsAt: Date };
export type ReservedSlot = { mode: Mode; startsAt: Date; capacity: number; reserved: number };

export type ComputedSlot = {
  mode: Mode;
  startsAt: Date;
  endsAt: Date;
  /** End of the schedule window the slot belongs to: a visit must finish by then. */
  windowEndsAt: Date;
  scheduleId: string;
  capacity: number;
  reserved: number;
  remaining: number;
  blocked: boolean;
};

export const offsetMinutes = (timezone: string) => TIMEZONE_OFFSET_MINUTES[timezone] ?? TIMEZONE_OFFSET_MINUTES['Asia/Jakarta']!;

/** "08:30" → 510. Callers validate the format. */
export const minutesOfDay = (time: string) => {
  const [hours, minutes] = time.split(':').map(Number);
  return hours! * 60 + minutes!;
};

/** Local calendar date + minutes after local midnight → UTC instant. */
export function localToUtc(date: string, minutes: number, timezone: string): Date {
  return new Date(Date.parse(`${date}T00:00:00.000Z`) + (minutes - offsetMinutes(timezone)) * 60_000);
}

/** Local calendar date (YYYY-MM-DD) of a UTC instant. */
export function localDate(instant: Date, timezone: string): string {
  return new Date(instant.getTime() + offsetMinutes(timezone) * 60_000).toISOString().slice(0, 10);
}

/** 0 = Sunday … 6 = Saturday, as JavaScript counts. */
export const dayOfWeek = (date: string) => new Date(`${date}T00:00:00.000Z`).getUTCDay();

export const addDays = (date: string, days: number) => new Date(Date.parse(`${date}T00:00:00.000Z`) + days * 86_400_000).toISOString().slice(0, 10);

const overlaps = (aStart: Date, aEnd: Date, bStart: Date, bEnd: Date) => aStart < bEnd && bStart < aEnd;

/** True when two windows of the same mode and day overlap in time. */
export function windowsOverlap(a: Pick<ScheduleWindow, 'startTime' | 'endTime'>, b: Pick<ScheduleWindow, 'startTime' | 'endTime'>) {
  return minutesOfDay(a.startTime) < minutesOfDay(b.endTime) && minutesOfDay(b.startTime) < minutesOfDay(a.endTime);
}

/**
 * Slots for `days` local dates starting at `fromDate`: every active window cut into `slotMinutes` steps (a partial
 * last step is dropped). Capacity comes from the materialised slot when one exists (it was fixed when capacity was
 * first reserved), otherwise from the window. Slots touching a block are kept but marked `blocked`.
 */
export function computeSlots(input: { mode: Mode; fromDate: string; days: number; timezone: string; windows: ScheduleWindow[]; blocks: Block[]; reserved: ReservedSlot[] }): ComputedSlot[] {
  const reservedByStart = new Map(input.reserved.filter((slot) => slot.mode === input.mode).map((slot) => [slot.startsAt.getTime(), slot]));
  const blocks = input.blocks.filter((block) => block.mode === null || block.mode === input.mode);
  const slots: ComputedSlot[] = [];
  for (let offset = 0; offset < input.days; offset += 1) {
    const date = addDays(input.fromDate, offset);
    const windows = input.windows.filter((window) => window.active && window.mode === input.mode && window.dayOfWeek === dayOfWeek(date)).sort((a, b) => minutesOfDay(a.startTime) - minutesOfDay(b.startTime));
    for (const window of windows) {
      const end = minutesOfDay(window.endTime);
      const windowEndsAt = localToUtc(date, end, input.timezone);
      for (let start = minutesOfDay(window.startTime); start + window.slotMinutes <= end; start += window.slotMinutes) {
        const startsAt = localToUtc(date, start, input.timezone);
        const endsAt = localToUtc(date, start + window.slotMinutes, input.timezone);
        const materialised = reservedByStart.get(startsAt.getTime());
        const capacity = materialised?.capacity ?? window.capacityPerSlot;
        const reserved = materialised?.reserved ?? 0;
        slots.push({
          mode: input.mode,
          startsAt,
          endsAt,
          windowEndsAt,
          scheduleId: window.id,
          capacity,
          reserved,
          remaining: Math.max(0, capacity - reserved),
          blocked: blocks.some((block) => overlaps(startsAt, endsAt, block.startsAt, block.endsAt)),
        });
      }
    }
  }
  return slots;
}

/**
 * Whether a visit of `durationMinutes` can start at this slot: it must not be blocked, must have capacity left,
 * must not have started yet, and must finish inside its schedule window without running into a block.
 */
export function fitsVisit(slot: ComputedSlot, durationMinutes: number, blocks: Block[], now: Date): boolean {
  if (slot.blocked || slot.remaining <= 0 || slot.startsAt <= now) return false;
  const visitEnds = new Date(slot.startsAt.getTime() + durationMinutes * 60_000);
  if (visitEnds > slot.windowEndsAt) return false;
  return !blocks.some((block) => (block.mode === null || block.mode === slot.mode) && overlaps(slot.startsAt, visitEnds, block.startsAt, block.endsAt));
}
