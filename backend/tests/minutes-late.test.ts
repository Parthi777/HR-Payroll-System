/**
 * `minutesLate` — the figure the approvals screen puts next to a held punch.
 *
 * It exists because that screen shows punches being held *because* the server
 * called them late, while the roster they are measured against is nowhere on
 * the page. Reading "10:27 AM" and knowing whether that is late requires the
 * shift start and its grace period, which the person clicking Approve 27 times
 * does not have.
 *
 * `isLateArrival` is defined in terms of this, so the pair cannot disagree —
 * a screen saying "0m late" about a punch the server refused to pay would be a
 * bug with no visible cause. These pin that relationship in both directions.
 *
 * Clocks are read in company time (vitest pins TZ and COMPANY_TZ to UTC).
 */
import { describe, expect, it } from 'vitest';
import { isLateArrival, minutesLate } from '../src/services/attendance/attendance-policy.js';

const general = { startTime: '09:00', endTime: '18:00', gracePeriod: 15 };
const noGrace = { startTime: '09:00', endTime: '18:00', gracePeriod: null };
const night = { startTime: '22:00', endTime: '06:00', gracePeriod: 15 };

/** A punch at HH:MM on 16 Sep 2026, in the (UTC-pinned) company clock. */
const at = (h: number, m: number) => new Date(Date.UTC(2026, 8, 16, h, m, 0));

describe('minutesLate', () => {
  it('is null for an on-time arrival', () => {
    expect(minutesLate(at(8, 55), general)).toBeNull();
    expect(minutesLate(at(9, 0), general)).toBeNull();
  });

  it('is null inside the grace period, including its last minute', () => {
    expect(minutesLate(at(9, 14), general)).toBeNull();
    expect(minutesLate(at(9, 15), general)).toBeNull();
  });

  it('starts counting the minute grace runs out', () => {
    expect(minutesLate(at(9, 16), general)).toBe(1);
  });

  it('measures from shift start + grace, not from shift start', () => {
    // 10:27 on a 09:00 shift with 15m grace is 72 late, not 87.
    expect(minutesLate(at(10, 27), general)).toBe(72);
    expect(minutesLate(at(11, 24), general)).toBe(129);
  });

  it('treats a missing grace period as none', () => {
    expect(minutesLate(at(9, 1), noGrace)).toBe(1);
    expect(minutesLate(at(9, 0), noGrace)).toBeNull();
  });

  it('handles a night shift by its own start time', () => {
    expect(minutesLate(at(22, 10), night)).toBeNull();
    expect(minutesLate(at(22, 30), night)).toBe(15);
  });
});

describe('isLateArrival agrees with minutesLate, always', () => {
  const shifts = [general, noGrace, night];
  const times = [
    at(0, 0), at(8, 55), at(9, 0), at(9, 15), at(9, 16), at(10, 27),
    at(11, 24), at(13, 0), at(21, 59), at(22, 0), at(22, 30), at(23, 59),
  ];

  it.each(shifts.map((s, i) => [i, s] as const))('shift %i', (_i, shift) => {
    for (const t of times) {
      expect(isLateArrival(t, shift)).toBe(minutesLate(t, shift) !== null);
    }
  });

  it('never reports a late punch as zero minutes late', () => {
    for (const shift of shifts) {
      for (const t of times) {
        if (isLateArrival(t, shift)) expect(minutesLate(t, shift)).toBeGreaterThan(0);
      }
    }
  });
});
