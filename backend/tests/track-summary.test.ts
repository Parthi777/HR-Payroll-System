import { describe, expect, it } from 'vitest';
import {
  GAP_MS,
  classifyFix,
  summarizeTrack,
  trackingWindow,
  type TrackRow,
} from '../src/services/tracking/tracking.service.js';

// The away-time arithmetic behind the Live Tracking page and its report.
// Pure — no database. See docs/LIVE-TRACKING.md.

const T0 = new Date('2026-10-26T09:00:00Z');
const at = (min: number) => new Date(T0.getTime() + min * 60_000);
const fix = (min: number, status: string, extra: Partial<TrackRow> = {}): TrackRow => ({
  ts: at(min), kind: 'FIX', status, distance: status === 'OUTSIDE' ? 250 : 20, lat: 11.4, lng: 77.6, ...extra,
});
const ev = (min: number, kind: string): TrackRow => ({ ts: at(min), kind });

/** Fixes every 2 minutes from `a` to `b` (inclusive of a, exclusive of b). */
const every2 = (a: number, b: number, status: string) => {
  const out: TrackRow[] = [];
  for (let m = a; m < b; m += 2) out.push(fix(m, status));
  return out;
};

const base = { from: T0, seedStatus: 'INSIDE', radius: 100 };
const sum = (s: ReturnType<typeof summarizeTrack>) => s.insideMin + s.outsideMin + s.offMin + s.noSignalMin;

describe('summarizeTrack', () => {
  it('counts a fully covered day as inside', () => {
    const s = summarizeTrack({ ...base, to: at(60), rows: every2(2, 60, 'INSIDE') });
    expect(s).toMatchObject({ insideMin: 60, outsideMin: 0, offMin: 0, noSignalMin: 0, episodes: [] });
    expect(s.current.state).toBe('INSIDE');
  });

  it('measures one stretch away from the fence', () => {
    const rows = [...every2(2, 20, 'INSIDE'), ...every2(20, 30, 'OUTSIDE'), ...every2(30, 60, 'INSIDE')];
    rows[10] = fix(20, 'OUTSIDE', { distance: 400 }); // furthest point: 300 m beyond a 100 m fence
    const s = summarizeTrack({ ...base, to: at(60), rows });
    expect(s.outsideMin).toBe(10);
    expect(s.insideMin).toBe(50);
    expect(s.episodes).toHaveLength(1);
    expect(s.episodes[0]).toMatchObject({ from: at(20), to: at(30), minutes: 10, maxBeyondM: 300 });
  });

  it('caps what one fix vouches for — the rest of a long gap is no signal', () => {
    // Inside at 0 (seed), then nothing until a fix at 20 minutes.
    const s = summarizeTrack({ ...base, to: at(20), rows: [fix(20, 'INSIDE')] });
    expect(s.insideMin).toBe(GAP_MS / 60_000);
    expect(s.noSignalMin).toBe(20 - GAP_MS / 60_000);
  });

  it('a gap cuts an away episode short instead of stretching it', () => {
    const s = summarizeTrack({ ...base, to: at(30), rows: [fix(0, 'OUTSIDE'), fix(30, 'OUTSIDE')] });
    expect(s.outsideMin).toBe(6);
    expect(s.noSignalMin).toBe(24);
    expect(s.episodes).toHaveLength(1);
  });

  it('time after the phone reports GPS off is "off", however long', () => {
    const s = summarizeTrack({
      ...base,
      to: at(30),
      rows: [fix(2, 'INSIDE'), fix(4, 'INSIDE'), ev(5, 'GPS_OFF'), ev(20, 'GPS_ON'), fix(22, 'INSIDE'), ...every2(24, 30, 'INSIDE')],
    });
    expect(s.offMin).toBe(15);
    expect(s.noSignalMin).toBe(0);
    expect(s.insideMin).toBe(15);
  });

  it('no permission counts as off from the moment it is reported', () => {
    const s = summarizeTrack({ ...base, to: at(60), rows: [ev(0, 'NO_PERMISSION')] });
    expect(s.offMin).toBe(60);
    expect(s.current.state).toBe('OFF');
  });

  it('a mock-location fix counts as off and is counted', () => {
    const s = summarizeTrack({
      ...base, to: at(10), rows: [fix(2, 'INSIDE'), fix(4, 'INSIDE', { isMock: true }), fix(6, 'INSIDE'), fix(8, 'INSIDE')],
    });
    expect(s.mockFixes).toBe(1);
    expect(s.offMin).toBe(2);
    expect(s.insideMin).toBe(8);
  });

  it('borderline is inside', () => {
    const s = summarizeTrack({ ...base, to: at(10), rows: every2(2, 10, 'BORDERLINE') });
    expect(s.insideMin).toBe(10);
    expect(s.outsideMin).toBe(0);
  });

  it('a day with no fixes at all reads as no signal after the first interval', () => {
    // What a refused "allow all the time" or a dead phone looks like.
    const s = summarizeTrack({ ...base, to: at(120), rows: [] });
    expect(s.insideMin).toBe(6);
    expect(s.noSignalMin).toBe(114);
    expect(s.current).toEqual({ state: 'NO_SIGNAL', since: at(6) });
  });

  it('a check-in outside the fence starts the day away', () => {
    const s = summarizeTrack({ ...base, seedStatus: 'OUTSIDE', to: at(4), rows: [fix(2, 'OUTSIDE')] });
    expect(s.outsideMin).toBe(4);
    expect(s.current).toEqual({ state: 'OUTSIDE', since: T0 });
  });

  it('live: the current state and since when the phone has gone quiet', () => {
    const s = summarizeTrack({ ...base, to: at(19), rows: [...every2(2, 12, 'INSIDE')] });
    // Last fix at 10 → vouched until 16 → no signal since 16.
    expect(s.current).toEqual({ state: 'NO_SIGNAL', since: at(16) });
  });

  it('live: away since the episode began', () => {
    const s = summarizeTrack({ ...base, to: at(31), rows: [...every2(2, 20, 'INSIDE'), ...every2(20, 32, 'OUTSIDE')] });
    expect(s.current).toEqual({ state: 'OUTSIDE', since: at(20) });
  });

  it('live: a fix stamped a moment ahead of the server clock still sets the state', () => {
    // Phone clock 20 s fast: the newest fix is "after" now, pinned to now.
    const s = summarizeTrack({ ...base, to: at(4), rows: [fix(2, 'INSIDE'), { ...fix(4, 'OUTSIDE'), ts: new Date(at(4).getTime() + 20_000) }] });
    expect(s.current).toEqual({ state: 'OUTSIDE', since: at(4) });
    expect(s.last?.status).toBe('OUTSIDE');
  });

  it('ignores rows outside the window and keeps the last real fix', () => {
    const s = summarizeTrack({ ...base, to: at(10), rows: [fix(-5, 'OUTSIDE'), fix(4, 'INSIDE'), fix(30, 'OUTSIDE')] });
    expect(s.outsideMin).toBe(0);
    expect(s.last?.ts).toEqual(at(4));
  });

  it('the four totals add up to the window', () => {
    const rows = [
      ...every2(2, 30, 'INSIDE'), ev(31, 'GPS_OFF'), ev(47, 'GPS_ON'),
      ...every2(48, 70, 'OUTSIDE'), ...every2(100, 140, 'INSIDE'),
    ];
    const s = summarizeTrack({ ...base, to: at(150), rows });
    expect(Math.abs(sum(s) - 150)).toBeLessThanOrEqual(1);
  });
});

describe('classifyFix', () => {
  const branch = { geofenceLat: 11.4, geofenceLng: 77.6, geofenceRadius: 100 };
  // ~0.0018° of latitude ≈ 200 m.
  const far = { lat: 11.4018, lng: 77.6 };

  it('outside with a sharp fix', () => {
    expect(classifyFix({ ...far, accuracy: 10 }, branch).status).toBe('OUTSIDE');
  });

  it('borderline when the accuracy circle still reaches the fence', () => {
    expect(classifyFix({ ...far, accuracy: 120 }, branch).status).toBe('BORDERLINE');
  });

  it('a hopelessly blurry fix is not allowed to hide a long way away', () => {
    const veryFar = { lat: 11.409, lng: 77.6, accuracy: 5000 }; // ~1 km out
    expect(classifyFix(veryFar, branch).status).toBe('OUTSIDE');
  });

  it('inside is inside', () => {
    expect(classifyFix({ lat: 11.4, lng: 77.6, accuracy: 30 }, branch).status).toBe('INSIDE');
  });
});

describe('trackingWindow', () => {
  const date = new Date(2026, 9, 26);
  const checkIn = new Date(2026, 9, 26, 9, 0);
  const row = { date, checkIn, checkOut: null, trackingFrom: checkIn, trackingTo: null };

  it('is null for an untracked day', () => {
    expect(trackingWindow({ ...row, trackingFrom: null }, false)).toBeNull();
  });

  it('is open and runs to now while checked in', () => {
    const now = new Date(2026, 9, 26, 11, 0);
    const w = trackingWindow(row, false, now)!;
    expect(w.open).toBe(true);
    expect(w.to).toEqual(now);
  });

  it('closes at check-out', () => {
    const checkOut = new Date(2026, 9, 26, 18, 0);
    const w = trackingWindow({ ...row, checkOut }, false, new Date(2026, 9, 26, 20, 0))!;
    expect(w.open).toBe(false);
    expect(w.to).toEqual(checkOut);
  });

  it('closes where tracking was switched off', () => {
    const trackingTo = new Date(2026, 9, 26, 13, 0);
    const w = trackingWindow({ ...row, trackingTo }, false, new Date(2026, 9, 26, 15, 0))!;
    expect(w.open).toBe(false);
    expect(w.to).toEqual(trackingTo);
  });

  it('a forgotten day-shift check-out is not followed past the day', () => {
    const w = trackingWindow(row, false, new Date(2026, 9, 27, 8, 0))!;
    expect(w.open).toBe(false);
    expect(w.to.getTime()).toBeLessThan(new Date(2026, 9, 27, 8, 0).getTime());
  });

  it('a night shift runs past midnight, up to 16 hours', () => {
    const nightIn = new Date(2026, 9, 26, 22, 0);
    const night = { ...row, checkIn: nightIn, trackingFrom: nightIn };
    expect(trackingWindow(night, true, new Date(2026, 9, 27, 5, 0))!.open).toBe(true);
    expect(trackingWindow(night, true, new Date(2026, 9, 27, 15, 0))!.open).toBe(false);
  });
});
