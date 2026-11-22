/** Shapes returned by the clinic availability API (S5). Times are local wall time (HH:MM); instants are UTC ISO. */
import type { FulfillmentMode } from '@/features/catalog/types';

export type Schedule = { id: string; mode: FulfillmentMode; dayOfWeek: number; startTime: string; endTime: string; slotMinutes: number; capacityPerSlot: number; active: boolean; updatedAt: string };

export type ScheduleBlock = { id: string; mode: FulfillmentMode | null; startsAt: string; endsAt: string; reason: string | null; createdAt: string };

export type ClinicSlot = { startsAt: string; endsAt: string; capacity: number; reserved: number; remaining: number; blocked: boolean; pendingOrders: number };
export type ClinicSlots = { timezone: string; mode: FulfillmentMode; from: string; days: number; slots: ClinicSlot[] };

/** Monday first, as Indonesian calendars show the week; values are JavaScript weekdays (0 = Sunday). */
export const WEEK: Array<{ day: number; label: string }> = [
  { day: 1, label: 'Senin' },
  { day: 2, label: 'Selasa' },
  { day: 3, label: 'Rabu' },
  { day: 4, label: 'Kamis' },
  { day: 5, label: 'Jumat' },
  { day: 6, label: 'Sabtu' },
  { day: 0, label: 'Minggu' },
];

export const dayLabel = (day: number) => WEEK.find((entry) => entry.day === day)?.label ?? String(day);

export const SLOT_LENGTHS = [15, 20, 30, 45, 60, 90, 120, 180, 240];
