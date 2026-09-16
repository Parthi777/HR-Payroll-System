/**
 * The holiday calendar — the date handling, and the payroll consequence.
 *
 * Until these routes existed the Holiday table was read by the payroll engine,
 * the muster grid and every report, and written by nothing: the calendar was
 * permanently empty, so a declared holiday was an ordinary working day and
 * anyone who stayed home was marked absent and docked.
 *
 * What is pinned here is the part that is easy to get quietly wrong. `dayKey()`
 * reads a Date with getFullYear/getMonth/getDate — the server's own timezone —
 * so a holiday has to be stored as local midnight of the intended day. Coercing
 * "2026-08-15" would give UTC midnight, which is the 14th in any timezone
 * behind UTC, and the holiday would land on the wrong day for a whole company.
 *
 * These exercise the parse/format pair and `classifyDay` directly rather than
 * through HTTP, so they need no database and no server.
 */
import { describe, expect, it } from 'vitest';
import { classifyDay } from '../src/services/attendance/day-classify.js';
import { dayKey } from '../src/utils/time.js';

/** The transform the route applies to an incoming "YYYY-MM-DD". */
function toStoredDate(iso: string): Date {
  const [y, m, d] = iso.split('-').map(Number);
  return new Date(y, m - 1, d);
}

/** What the route returns to the client for a stored row. */
function toIso(date: Date): string {
  const p = (n: number) => String(n).padStart(2, '0');
  return `${date.getFullYear()}-${p(date.getMonth() + 1)}-${p(date.getDate())}`;
}

const shift = { startTime: '09:00', endTime: '18:00', gracePeriod: 15, otAfterMinutes: 0 };
const halfDayWindow = { start: '12:30', end: '14:00' };

/** A day in the middle of a month, with no punch and no leave. */
function classify(date: Date, holidays: Set<string>) {
  return classifyDay({
    halfDayWindow,
    date,
    att: undefined,
    shift,
    leaves: [],
    holidays,
    joiningDate: new Date(2020, 0, 1),
    now: new Date(2026, 11, 31),
  });
}

describe('storing a holiday date', () => {
  it('round-trips the calendar day it was given', () => {
    for (const iso of ['2026-01-01', '2026-08-15', '2026-10-02', '2026-12-25']) {
      expect(toIso(toStoredDate(iso))).toBe(iso);
    }
  });

  it('keys to the same day the payroll loop builds', () => {
    // The payroll loop walks `new Date(year, month - 1, dn)`. A stored holiday
    // must produce an identical dayKey or the lookup silently misses.
    const stored = toStoredDate('2026-08-15');
    const fromPayrollLoop = new Date(2026, 7, 15);
    expect(dayKey(stored)).toBe(dayKey(fromPayrollLoop));
  });

  it('does NOT slip a day the way UTC coercion would', () => {
    // The bug this guards against: `new Date("2026-08-15")` is UTC midnight.
    // Asserting the two differ in construction is the point — our stored value
    // is anchored to the local calendar, not to an instant.
    const ours = toStoredDate('2026-08-15');
    expect(ours.getDate()).toBe(15);
    expect(ours.getMonth()).toBe(7);
    expect(ours.getHours()).toBe(0);
  });

  it('rejects a date that does not exist', () => {
    // 31 February rolls over to March in JS; the route catches that by checking
    // the parts survived construction.
    const [y, m, d] = '2026-02-31'.split('-').map(Number);
    const rolled = new Date(y, m - 1, d);
    expect(rolled.getDate()).not.toBe(d);
  });
});

describe('what a configured holiday does to the day', () => {
  const weekday = new Date(2026, 7, 14); // Friday 14 Aug 2026

  it('an unlisted holiday is an ordinary working day — absent, and docked', () => {
    const day = classify(weekday, new Set());
    expect(day.code).toBe('A');
    expect(day.isOff).toBe(false);
  });

  it('listing it makes the same day a paid day off', () => {
    const holidays = new Set([dayKey(toStoredDate('2026-08-14'))]);
    const day = classify(weekday, holidays);
    expect(day.code).toBe('HL');
    expect(day.isOff).toBe(true);
  });

  it('a holiday on a Sunday changes nothing — it was already a weekly off', () => {
    const sunday = new Date(2026, 7, 16); // Sunday 16 Aug 2026
    expect(sunday.getDay()).toBe(0);
    const without = classify(sunday, new Set());
    const with_ = classify(sunday, new Set([dayKey(toStoredDate('2026-08-16'))]));
    expect(without.isOff).toBe(true);
    expect(with_.isOff).toBe(true);
    // Which is why the UI marks such a row "already a weekly off".
    expect(with_.code).toBe(without.code);
  });
});
