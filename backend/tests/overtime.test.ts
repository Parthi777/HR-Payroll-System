/**
 * Overtime, which is paid in days.
 *
 * `overtimeMinutes` used to read the check-out as minutes-since-midnight and
 * treat any value below the shift's end time as having crossed into the next
 * day:
 *
 *     if (outMin < endMin) outMin += 1440;  // "night shift"
 *
 * For a night shift that is sometimes right. For the general shift it is the
 * definition of leaving early — and it paid for it. Checking out at 17:00 on an
 * 18:00 shift produced 1380 minutes of overtime: 23 hours, or 2.3 extra days of
 * salary at ten OT hours to the day, for going home an hour early.
 *
 * Every case here is a real instant on a real date, because the bug was
 * precisely the belief that a clock reading is enough to place a moment in time.
 */
import { describe, expect, it } from 'vitest';
import { overtimeMinutes } from '../src/services/attendance/day-classify.js';

/** The day the shift began. */
const SHIFT_DAY = new Date(2026, 6, 1);
/** An instant `dayOffset` days after the shift day, at the given clock time. */
const at = (dayOffset: number, h: number, m = 0) => {
  const d = new Date(2026, 6, 1 + dayOffset);
  d.setHours(h, m, 0, 0);
  return d;
};

const GENERAL = { startTime: '09:00', endTime: '18:00', otAfterMinutes: 0 };
const NIGHT = { startTime: '22:00', endTime: '06:00', otAfterMinutes: 0 };

describe('overtime on a day shift', () => {
  it('pays the minutes worked past the close', () => {
    expect(overtimeMinutes(at(0, 19, 30), GENERAL, SHIFT_DAY)).toBe(90);
  });

  it('pays nothing for leaving on time', () => {
    expect(overtimeMinutes(at(0, 18), GENERAL, SHIFT_DAY)).toBe(0);
  });

  it('pays nothing for leaving an hour early', () => {
    // The regression. This returned 1380 — 23 hours — because 17:00 reads as
    // "before 18:00" and the old rule took that to mean the next morning.
    expect(overtimeMinutes(at(0, 17), GENERAL, SHIFT_DAY)).toBe(0);
  });

  it('pays nothing for leaving at midday', () => {
    expect(overtimeMinutes(at(0, 14, 30), GENERAL, SHIFT_DAY)).toBe(0);
  });

  it('still pays a day shift that genuinely runs past midnight', () => {
    // 18:00 close, out at 00:30 the next day: six and a half hours over.
    expect(overtimeMinutes(at(1, 0, 30), GENERAL, SHIFT_DAY)).toBe(390);
  });
});

describe('overtime on a night shift, which closes the next day', () => {
  it('pays the minutes past a close that falls after midnight', () => {
    expect(overtimeMinutes(at(1, 6, 30), NIGHT, SHIFT_DAY)).toBe(30);
  });

  it('pays nothing for leaving on time', () => {
    expect(overtimeMinutes(at(1, 6), NIGHT, SHIFT_DAY)).toBe(0);
  });

  it('pays nothing for leaving early', () => {
    // The old rule was wrong here too, for the same reason and by the same
    // 23 hours — the night shift it was written for was not actually spared.
    expect(overtimeMinutes(at(1, 5), NIGHT, SHIFT_DAY)).toBe(0);
  });

  it('pays a long overrun', () => {
    expect(overtimeMinutes(at(1, 9), NIGHT, SHIFT_DAY)).toBe(180);
  });
});

describe('the shift’s OT grace', () => {
  const withGrace = { ...GENERAL, otAfterMinutes: 30 };

  it('does not pay inside the grace', () => {
    expect(overtimeMinutes(at(0, 18, 20), withGrace, SHIFT_DAY)).toBe(0);
  });

  it('pays only the part beyond it', () => {
    expect(overtimeMinutes(at(0, 19), withGrace, SHIFT_DAY)).toBe(30);
  });
});

describe('edges', () => {
  it('pays nothing when there is no check-out', () => {
    expect(overtimeMinutes(null, GENERAL, SHIFT_DAY)).toBe(0);
    expect(overtimeMinutes(undefined, GENERAL, SHIFT_DAY)).toBe(0);
  });

  it('falls back to a 09:00-18:00 day when no shift is given', () => {
    expect(overtimeMinutes(at(0, 19), null, SHIFT_DAY)).toBe(60);
    expect(overtimeMinutes(at(0, 17), null, SHIFT_DAY)).toBe(0);
  });
});
