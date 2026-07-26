import { describe, expect, it } from 'vitest';
import {
  dayCredit,
  effectiveStatus,
  isLateArrival,
  resolveAttendanceStatus,
} from '../src/services/attendance/attendance-policy.js';

const GENERAL = { startTime: '09:00', endTime: '18:00', gracePeriod: 15 };
const EVENING = { startTime: '14:00', endTime: '22:00', gracePeriod: 15 };
const NIGHT = { startTime: '22:00', endTime: '06:00', gracePeriod: 15 };

/** A UTC instant on 2026-07-15 — tests run with COMPANY_TZ=UTC. */
const at = (hhmm: string) => {
  const [h, m] = hhmm.split(':').map(Number);
  return new Date(Date.UTC(2026, 6, 15, h, m));
};

describe('resolveAttendanceStatus', () => {
  it('marks a normal full day PRESENT', () => {
    expect(resolveAttendanceStatus({ checkIn: at('09:00'), checkOut: at('18:00'), shift: GENERAL })).toBe('PRESENT');
  });

  it('marks arrival past the grace period LATE', () => {
    expect(resolveAttendanceStatus({ checkIn: at('09:30'), checkOut: at('18:00'), shift: GENERAL })).toBe('LATE');
    // Inside the grace period is still on time.
    expect(resolveAttendanceStatus({ checkIn: at('09:14'), checkOut: at('18:00'), shift: GENERAL })).toBe('PRESENT');
  });

  it('marks a check-IN inside the midday window as a half day', () => {
    expect(resolveAttendanceStatus({ checkIn: at('12:30'), checkOut: at('18:00'), shift: GENERAL })).toBe('HALF_DAY');
    expect(resolveAttendanceStatus({ checkIn: at('13:00'), checkOut: at('18:00'), shift: GENERAL })).toBe('HALF_DAY');
    expect(resolveAttendanceStatus({ checkIn: at('14:00'), checkOut: at('18:00'), shift: GENERAL })).toBe('HALF_DAY');
  });

  it('marks a check-OUT inside the midday window as a half day', () => {
    expect(resolveAttendanceStatus({ checkIn: at('09:00'), checkOut: at('12:30'), shift: GENERAL })).toBe('HALF_DAY');
    expect(resolveAttendanceStatus({ checkIn: at('09:00'), checkOut: at('13:15'), shift: GENERAL })).toBe('HALF_DAY');
    expect(resolveAttendanceStatus({ checkIn: at('09:00'), checkOut: at('14:00'), shift: GENERAL })).toBe('HALF_DAY');
  });

  it('treats punches outside the window as a full day', () => {
    // Arrived after the window closed — late, not half.
    expect(resolveAttendanceStatus({ checkIn: at('15:30'), checkOut: at('18:00'), shift: GENERAL })).toBe('LATE');
    // Left before the window opened — still a full day under the agreed rule.
    expect(resolveAttendanceStatus({ checkIn: at('09:00'), checkOut: at('11:00'), shift: GENERAL })).toBe('PRESENT');
  });

  it('does not mis-mark evening/night shifts that legitimately start midday', () => {
    // 13:00 is BEFORE the 14:00 evening shift starts — an early arrival, not a half day.
    expect(resolveAttendanceStatus({ checkIn: at('13:00'), checkOut: at('22:00'), shift: EVENING })).toBe('PRESENT');
    expect(resolveAttendanceStatus({ checkIn: at('13:00'), checkOut: at('06:00'), shift: NIGHT })).toBe('PRESENT');
  });

  it('does not half-day a check-out at or after the shift closes', () => {
    const earlyShift = { startTime: '08:00', endTime: '13:00', gracePeriod: 15 };
    expect(resolveAttendanceStatus({ checkIn: at('08:00'), checkOut: at('13:00'), shift: earlyShift })).toBe('PRESENT');
  });

  it('returns ABSENT with no check-in', () => {
    expect(resolveAttendanceStatus({ checkIn: null, checkOut: null, shift: GENERAL })).toBe('ABSENT');
  });
});

describe('isLateArrival', () => {
  it('is tracked independently of the half-day status', () => {
    // 12:45 reports as HALF_DAY but is still a late arrival needing approval.
    expect(resolveAttendanceStatus({ checkIn: at('12:45'), checkOut: at('18:00'), shift: GENERAL })).toBe('HALF_DAY');
    expect(isLateArrival(at('12:45'), GENERAL)).toBe(true);
    expect(isLateArrival(at('09:10'), GENERAL)).toBe(false);
  });
});

describe('effectiveStatus', () => {
  it('re-derives stored punches against the current policy', () => {
    const stored = { status: 'PRESENT', checkIn: at('09:00'), checkOut: at('13:10') };
    expect(effectiveStatus(stored, GENERAL)).toBe('HALF_DAY');
  });

  it('leaves admin decisions (leave / absent) untouched', () => {
    expect(effectiveStatus({ status: 'ON_LEAVE', checkIn: at('09:00'), checkOut: at('13:10') }, GENERAL)).toBe('ON_LEAVE');
    expect(effectiveStatus({ status: 'ABSENT', checkIn: null, checkOut: null }, GENERAL)).toBe('ABSENT');
  });
});

describe('dayCredit', () => {
  it('pays a half day at 0.5 and everything else in full', () => {
    expect(dayCredit('HALF_DAY')).toBe(0.5);
    expect(dayCredit('PRESENT')).toBe(1);
    expect(dayCredit('LATE')).toBe(1);
  });
});
