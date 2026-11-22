/** Display-only formatting; money stays exact decimal on the API (DESIGN.md §5). Times shown in Asia/Jakarta. */
export const TIMEZONE = 'Asia/Jakarta';

const idr = new Intl.NumberFormat('id-ID', { style: 'currency', currency: 'IDR', maximumFractionDigits: 0 });
const number = new Intl.NumberFormat('id-ID');
const dateTime = new Intl.DateTimeFormat('id-ID', { dateStyle: 'medium', timeStyle: 'short', timeZone: TIMEZONE });
const date = new Intl.DateTimeFormat('id-ID', { dateStyle: 'medium', timeZone: TIMEZONE });
const time = new Intl.DateTimeFormat('id-ID', { hour: '2-digit', minute: '2-digit', hourCycle: 'h23', timeZone: TIMEZONE });
const weekdayDate = new Intl.DateTimeFormat('id-ID', { weekday: 'long', day: 'numeric', month: 'long', timeZone: TIMEZONE });
const relative = new Intl.RelativeTimeFormat('id-ID', { numeric: 'auto' });

export const formatIDR = (value: string | number) => idr.format(Number(value));
export const formatNumber = (value: number) => number.format(value);
export const formatDateTime = (value: string | Date) => dateTime.format(new Date(value));
export const formatDate = (value: string | Date) => date.format(new Date(value));
/** "08.00" in Asia/Jakarta. */
export const formatTime = (value: string | Date) => time.format(new Date(value));
/** "Selasa, 1 Desember". */
export const formatWeekdayDate = (value: string | Date) => weekdayDate.format(new Date(value));
/** Today's calendar date in Asia/Jakarta, YYYY-MM-DD. */
export const jakartaToday = (now = Date.now()) => new Date(now + 7 * 3_600_000).toISOString().slice(0, 10);

/** "2 jam lalu", "kemarin". */
export function formatRelative(value: string | Date, now = Date.now()) {
  const seconds = Math.round((new Date(value).getTime() - now) / 1000);
  const steps: Array<[Intl.RelativeTimeFormatUnit, number]> = [['second', 60], ['minute', 60], ['hour', 24], ['day', 7], ['week', 4.35], ['month', 12], ['year', Infinity]];
  let amount = seconds;
  for (const [unit, size] of steps) {
    if (Math.abs(amount) < size) return relative.format(Math.round(amount), unit);
    amount /= size;
  }
  return relative.format(Math.round(amount), 'year');
}
