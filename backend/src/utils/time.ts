/**
 * Company-timezone time helpers.
 *
 * The server may run in UTC (Railway) while the business operates in
 * Asia/Kolkata, so anything that compares a punch against a shift clock time
 * must read hours/minutes in the company timezone — never with getHours().
 */

export const COMPANY_TZ = process.env.COMPANY_TZ ?? 'Asia/Kolkata';

/** "09:30" -> 570. Returns 0 for malformed input. */
export function parseHHMM(t: string): number {
  const [h, m] = String(t).split(':').map(Number);
  return (Number.isFinite(h) ? h : 0) * 60 + (Number.isFinite(m) ? m : 0);
}

/** 570 -> "09:30". */
export function formatHHMM(minutes: number): string {
  const m = ((Math.round(minutes) % 1440) + 1440) % 1440;
  return `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
}

/** Minutes since midnight for a Date, read in the company timezone. */
export function minutesSinceMidnight(d: Date): number {
  const parts = new Intl.DateTimeFormat('en-US', {
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
    timeZone: COMPANY_TZ,
  }).formatToParts(d);
  const h = Number(parts.find((p) => p.type === 'hour')?.value ?? '0');
  const m = Number(parts.find((p) => p.type === 'minute')?.value ?? '0');
  return (h % 24) * 60 + m;
}

/** Stable per-calendar-day key, used to line attendance up against a month grid. */
export const dayKey = (d: Date) => `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;

export function startOfDay(d: Date): Date {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  return x;
}

export function endOfDay(d: Date): Date {
  const x = new Date(d);
  x.setHours(23, 59, 59, 999);
  return x;
}

/** Minutes the company timezone is ahead of UTC at the given instant (DST-aware). */
export function companyOffsetMinutes(at: Date): number {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: COMPANY_TZ,
    hour12: false,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  }).formatToParts(at);
  const get = (t: string) => Number(parts.find((p) => p.type === t)?.value ?? '0');
  const asUtc = Date.UTC(get('year'), get('month') - 1, get('day'), get('hour') % 24, get('minute'), get('second'));
  return Math.round((asUtc - Math.floor(at.getTime() / 1000) * 1000) / 60_000);
}

/**
 * The instant that reads as `hhmm` on `day`'s calendar date in the company
 * timezone. Manual punches are typed as wall-clock times, so they must be
 * anchored to the company clock rather than the server's (which may be UTC).
 */
export function atCompanyTime(day: Date, hhmm: string): Date {
  const mins = parseHHMM(hhmm);
  const naiveUtc = Date.UTC(day.getFullYear(), day.getMonth(), day.getDate(), Math.floor(mins / 60), mins % 60, 0);
  return new Date(naiveUtc - companyOffsetMinutes(new Date(naiveUtc)) * 60_000);
}

/** "8:05" from 485 minutes — the H:MM duration format the muster report uses. */
export function formatDuration(minutes: number | null | undefined): string {
  if (!minutes || minutes <= 0) return '00:00';
  const m = Math.round(minutes);
  return `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
}
