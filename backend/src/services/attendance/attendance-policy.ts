/**
 * Attendance day-status policy (owner-specified).
 *
 * Half day — a punch that lands inside the midday window (default 12:30–14:00)
 * marks the day HALF_DAY:
 *   • arrives inside the window and works to shift close  → half day
 *   • works from shift start and leaves inside the window → half day
 * The window is only applied *mid-shift*: a check-in before the shift starts,
 * or a check-out at/after the shift closes, is a normal full day. That guard
 * keeps evening/night shifts (which legitimately start at 14:00 or 22:00)
 * from being mis-marked.
 *
 * Anything outside the window follows the usual rule — late past the shift's
 * grace period is LATE, otherwise PRESENT.
 *
 * Window is env-tunable: HALF_DAY_WINDOW_START / HALF_DAY_WINDOW_END ("HH:MM").
 */
import { parseHHMM, minutesSinceMidnight } from '../../utils/time.js';

const HALF_DAY_START = parseHHMM(process.env.HALF_DAY_WINDOW_START ?? '12:30');
const HALF_DAY_END = parseHHMM(process.env.HALF_DAY_WINDOW_END ?? '14:00');

export type DayStatus = 'PRESENT' | 'LATE' | 'HALF_DAY' | 'ABSENT';

/** Statuses that come from an actual punch (as opposed to leave/absent marking). */
const PUNCH_STATUSES = new Set(['PRESENT', 'LATE', 'HALF_DAY']);

export const isPunchStatus = (s: string) => PUNCH_STATUSES.has(s);

export const inHalfDayWindow = (minutes: number) => minutes >= HALF_DAY_START && minutes <= HALF_DAY_END;

export interface ShiftClock {
  startTime: string; // "09:00"
  endTime: string; // "18:00"
  gracePeriod?: number | null; // minutes of late tolerance
}

export interface ResolveInput {
  checkIn: Date | null;
  checkOut: Date | null;
  shift: ShiftClock;
}

/**
 * The day's status from its punch times. Pure — used both when a punch is
 * recorded and when payroll/reports re-derive a stored row, so a policy change
 * applies consistently to history instead of only to new punches.
 */
export function resolveAttendanceStatus({ checkIn, checkOut, shift }: ResolveInput): DayStatus {
  if (!checkIn) return 'ABSENT';

  const startMin = parseHHMM(shift.startTime);
  const endMin = parseHHMM(shift.endTime);
  const inMin = minutesSinceMidnight(checkIn);

  // Arrived mid-shift, inside the midday window → half day.
  if (inMin > startMin && inHalfDayWindow(inMin)) return 'HALF_DAY';

  // Left inside the midday window before the shift closed → half day.
  if (checkOut) {
    const outMin = minutesSinceMidnight(checkOut);
    if (outMin < endMin && inHalfDayWindow(outMin)) return 'HALF_DAY';
  }

  return inMin > startMin + (shift.gracePeriod ?? 0) ? 'LATE' : 'PRESENT';
}

/**
 * Re-derive the status of a stored attendance row. Rows that were marked
 * ON_LEAVE / ABSENT / HOLIDAY by an admin decision are left untouched — only
 * real punches are re-evaluated against the current half-day policy.
 */
export function effectiveStatus(
  att: { status: string; checkIn: Date | null; checkOut: Date | null },
  shift: ShiftClock | null | undefined,
): string {
  if (!shift || !isPunchStatus(att.status) || !att.checkIn) return att.status;
  return resolveAttendanceStatus({ checkIn: att.checkIn, checkOut: att.checkOut, shift });
}

/**
 * Whether the arrival is past the shift's grace period. Tracked separately from
 * the day status because a late arrival that also lands in the midday window is
 * reported as HALF_DAY — but it still needs the late-punch approval and counts
 * toward the late-punch discipline policy.
 */
export function isLateArrival(checkIn: Date, shift: ShiftClock): boolean {
  return minutesSinceMidnight(checkIn) > parseHHMM(shift.startTime) + (shift.gracePeriod ?? 0);
}

/** Day credit toward pay: a half day is worth 0.5, any other punch a full day. */
export const dayCredit = (status: string) => (status === 'HALF_DAY' ? 0.5 : 1);
