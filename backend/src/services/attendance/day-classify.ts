/**
 * One shared answer to "what kind of day was this, for this employee?".
 *
 * Every surface that counts present/absent days — the payroll engine, the
 * muster grid, the daily/monthly/per-employee reports — classifies days here,
 * so the same day can never read PRESENT on one screen and ABSENT on another.
 *
 * Rules (owner-specified, in priority order):
 *   1. Days before the employee joined, and days that haven't happened yet,
 *      belong to nobody's count — not present, not absent, not a paid off day.
 *   2. Sundays and configured holidays are paid weekly-offs. Working one is
 *      marked WO* / HL* (Sunday duty additionally pays an extra day).
 *   3. An approved punch is duty: P, or HD when the half-day policy applies.
 *   4. A punch still awaiting sign-off (PN) is unpaid until approved, so it
 *      counts under Absent — the PN cell in the grid shows why.
 *   5. Approved leave is LV (paid) or LOP (unpaid).
 *   6. Anything else on a working day is Absent.
 */
import { effectiveStatus, type HalfDayWindow, type ShiftClock } from './attendance-policy.js';
import { dayKey, endOfDay, minutesSinceMidnight, parseHHMM, startOfDay } from '../../utils/time.js';

/**
 * Day status codes (kept short so they fit a 31-column grid):
 *   P   present            HD  half day          A   absent
 *   WO  weekly off         WO* weekly off worked (Sunday duty = extra pay day)
 *   HL  holiday            HL* holiday worked
 *   LV  paid leave         LOP loss of pay       PN  awaiting approval
 *   ''  outside the employee's service (before joining) or a future date
 */
export type DayCode = 'P' | 'HD' | 'A' | 'WO' | 'WO*' | 'HL' | 'HL*' | 'LV' | 'LOP' | 'PN' | '';

export interface DayAttendance {
  status: string;
  checkIn: Date | null;
  checkOut: Date | null;
  approvalStatus: string | null;
}

export interface DayLeave {
  type: string;
  fromDate: Date;
  toDate: Date;
}

export interface ClassifyInput {
  date: Date;
  att?: DayAttendance | null;
  shift?: ShiftClock | null;
  /** Approved leaves that may cover this day (any range — overlap is resolved here). */
  leaves?: DayLeave[];
  /** Day-keys of configured holidays for the month. */
  holidays: Set<string>;
  joiningDate?: Date | null;
  now?: Date;
  /**
   * The dealer's midday window. Must be the same one used when the punch was
   * recorded, or a day would read HALF_DAY on one screen and PRESENT on another.
   */
  halfDayWindow?: HalfDayWindow;
}

export interface DayFacts {
  code: DayCode;
  /** False for pre-joining and future days — they count toward nothing. */
  counts: boolean;
  isFuture: boolean;
  beforeJoining: boolean;
  isSunday: boolean;
  isHoliday: boolean;
  isOff: boolean; // Sunday or holiday — a paid weekly-off either way
  /** Approved duty punch — the employee actually worked this day. */
  worked: boolean;
  /** Punch held for sign-off: not paid, counted absent until approved. */
  pending: boolean;
  late: boolean;
  /** Duty credit toward pay: 1 for a full day, 0.5 for a half day, else 0. */
  credit: number;
  status: string | null;
  leave: DayLeave | null;
}

/** Statuses that represent duty actually worked. */
const DUTY = new Set(['PRESENT', 'LATE', 'HALF_DAY']);

/** A punch is paid only if it never needed sign-off, or already got it. */
const approved = (a: { approvalStatus: string | null }) =>
  a.approvalStatus == null || a.approvalStatus === 'APPROVED';

export function classifyDay(input: ClassifyInput): DayFacts {
  const { date, att, shift, holidays, leaves = [], joiningDate, now = new Date(), halfDayWindow } = input;

  const status = att ? effectiveStatus(att, shift, halfDayWindow) : null;
  const worked = !!att?.checkIn && approved(att) && DUTY.has(status ?? '');
  const pending = !!att?.checkIn && att.approvalStatus === 'PENDING';

  const isSunday = date.getDay() === 0;
  const isHoliday = holidays.has(dayKey(date));
  const isFuture = startOfDay(date) > startOfDay(now);
  const beforeJoining = !!joiningDate && startOfDay(date) < startOfDay(joiningDate);
  const leave = leaves.find((l) => l.fromDate <= endOfDay(date) && l.toDate >= startOfDay(date)) ?? null;

  const facts: Omit<DayFacts, 'code' | 'counts'> = {
    isFuture,
    beforeJoining,
    isSunday,
    isHoliday,
    isOff: isSunday || isHoliday,
    worked,
    pending,
    late: worked && status === 'LATE',
    credit: worked ? (status === 'HALF_DAY' ? 0.5 : 1) : 0,
    status,
    leave,
  };

  // Outside the service window: no attendance expected, so nothing is counted.
  // A punch that exists anyway (back-dated joining, data fix) still counts.
  if (isFuture || (beforeJoining && !worked && !pending)) {
    return { ...facts, code: '', counts: false };
  }

  let code: DayCode;
  if (isSunday) code = worked ? 'WO*' : 'WO';
  else if (isHoliday) code = worked ? 'HL*' : 'HL';
  else if (worked) code = status === 'HALF_DAY' ? 'HD' : 'P';
  else if (pending) code = 'PN';
  else if (leave) code = leave.type === 'LOP' ? 'LOP' : 'LV';
  else code = 'A';

  return { ...facts, code, counts: true };
}

/**
 * Overtime for one day: duty worked past the shift's close plus its OT grace
 * (`Shift.otAfterMinutes`), read from the actual check-out clock time. Shared by
 * payroll, the muster grid and the daily report so one OT rule serves them all.
 */
export function overtimeMinutes(
  checkOut: Date | null | undefined,
  shift: { endTime?: string | null; otAfterMinutes?: number | null } | null | undefined,
): number {
  if (!checkOut) return 0;
  const endMin = parseHHMM(shift?.endTime ?? '18:00');
  let outMin = minutesSinceMidnight(checkOut);
  if (outMin < endMin) outMin += 1440; // checked out after midnight (night shift)
  return Math.max(0, outMin - (endMin + (shift?.otAfterMinutes ?? 0)));
}

export type { ShiftClock };
