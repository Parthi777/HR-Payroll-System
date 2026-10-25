/**
 * Live location tracking between check-in and check-out.
 *
 * The phone records a fix every two minutes while a tracked day is open and
 * uploads them in batches; this service stores them against the day and
 * answers "where is everyone, and how long has each been away from the fence?".
 * See docs/LIVE-TRACKING.md.
 *
 * A day is tracked when it was checked in from the employee's own phone while
 * the dealer had tracking on and the employee was not exempt — that moment is
 * `Attendance.trackingFrom`. Its window closes at check-out, or at
 * `trackingTo` when tracking was switched off mid-shift, or at a cut-off so a
 * forgotten check-out is not followed overnight.
 *
 * "No signal" is never stored. It is the gap between rows: anything longer
 * than three intervals without a fix is time nobody can account for, which is
 * exactly what a dead phone, a killed app or a refused permission looks like.
 */
import type { Prisma, PrismaClient } from '@prisma/client';
import { AppError } from '../../utils/AppError.js';
import type { JwtPayload } from '../../middleware/auth.js';
import { requireTenantId } from '../../context/tenant-context.js';
import { checkGeofence, type GeofenceConfig } from '../geofence/geofence.service.js';
import { atCompanyTime, startOfDay } from '../../utils/time.js';
import { getTenantPolicy } from '../settings/tenant-settings.service.js';

/** How often the phone records a fix. */
export const TRACK_INTERVAL_SEC = 120;
/** Longer than this between two rows is "no signal". Three missed fixes. */
export const GAP_MS = 3 * TRACK_INTERVAL_SEC * 1000;
/** A night shift with no check-out stops being followed after this long. */
const NIGHT_SHIFT_CAP_MS = 16 * 60 * 60_000;
/** How far either side of the window a fix may be stamped and still count. */
const CLOCK_SLACK_MS = 2 * 60_000;
/** An OUTSIDE fix this blurry is not evidence of anything either way. */
const MAX_TRUSTED_ACCURACY_M = 150;

export const MAX_BATCH_POINTS = 200;
export const MAX_BATCH_EVENTS = 50;
export const TRACK_EVENT_KINDS = ['GPS_OFF', 'GPS_ON', 'NO_PERMISSION', 'STOPPED'] as const;
export type TrackEventKind = (typeof TRACK_EVENT_KINDS)[number];

// ── Window ──

export interface WindowSource {
  date: Date;
  checkIn: Date | null;
  checkOut: Date | null;
  trackingFrom: Date | null;
  trackingTo: Date | null;
}

export interface TrackWindow {
  from: Date;
  /** Where the summary stops: the end of the window, or now if it is still open. */
  to: Date;
  /** Where the window ends (or will end, at the cut-off). */
  end: Date;
  /** Still collecting: no check-out, not cut short, cut-off not reached. */
  open: boolean;
}

/**
 * The stretch of a day that was tracked. Null when the day was not tracked.
 *
 * The cut-off is the end of the attendance date in company time for a day
 * shift, and 16 hours after check-in for a night shift — the same "today, else
 * yesterday" reach as a night-shift check-out.
 */
export function trackingWindow(att: WindowSource, isNightShift: boolean, now: Date = new Date()): TrackWindow | null {
  if (!att.trackingFrom) return null;
  const cutoff = isNightShift
    ? new Date((att.checkIn ?? att.trackingFrom).getTime() + NIGHT_SHIFT_CAP_MS)
    : new Date(atCompanyTime(att.date, '23:59').getTime() + 60_000);
  const end = att.checkOut ?? att.trackingTo ?? cutoff;
  const to = new Date(Math.max(att.trackingFrom.getTime(), Math.min(end.getTime(), now.getTime())));
  const open = !att.checkOut && !att.trackingTo && now < cutoff;
  return { from: att.trackingFrom, to, end, open };
}

// ── One fix ──

export interface FixClass {
  status: 'INSIDE' | 'OUTSIDE' | 'BORDERLINE';
  distance: number;
}

/**
 * Inside or outside the fence, the same rule check-in uses — with one
 * allowance: a fix whose accuracy circle still reaches the fence is
 * BORDERLINE, so a poor reading near the edge is never counted as time away.
 */
export function classifyFix(p: { lat: number; lng: number; accuracy?: number | null }, branch: GeofenceConfig): FixClass {
  const geo = checkGeofence(p, branch, p.accuracy ?? undefined);
  let status = geo.status;
  if (status === 'OUTSIDE' && p.accuracy && geo.distance > 0) {
    const blur = Math.min(p.accuracy, MAX_TRUSTED_ACCURACY_M);
    if (geo.distance - blur <= branch.geofenceRadius) status = 'BORDERLINE';
  }
  return { status, distance: geo.distance };
}

// ── The day, summarised ──

/** BORDERLINE counts as inside; GPS off, no permission and mock fixes are OFF. */
export type TrackState = 'INSIDE' | 'OUTSIDE' | 'OFF';
export type LiveState = TrackState | 'NO_SIGNAL';

export interface TrackRow {
  ts: Date;
  kind: string;
  status?: string | null;
  distance?: number | null;
  isMock?: boolean;
  lat?: number | null;
  lng?: number | null;
  accuracy?: number | null;
}

export interface SummaryInput {
  from: Date;
  to: Date;
  /** Geofence status of the check-in itself — the state before the first row. */
  seedStatus: string;
  /** Fence radius, to say how far beyond it an away fix was. */
  radius: number;
  rows: TrackRow[];
  gapMs?: number;
}

export interface AwayEpisode {
  from: Date;
  to: Date;
  minutes: number;
  /** Furthest any fix in the episode was beyond the fence edge, in metres. */
  maxBeyondM: number;
}

export interface TrackSummary {
  insideMin: number;
  outsideMin: number;
  offMin: number;
  noSignalMin: number;
  mockFixes: number;
  episodes: AwayEpisode[];
  current: { state: LiveState; since: Date };
  /** The latest real fix, for the map. */
  last: TrackRow | null;
}

const toState = (status: string | null | undefined): TrackState => (status === 'OUTSIDE' ? 'OUTSIDE' : 'INSIDE');

/**
 * Inside / away / GPS off / no signal for one tracked window.
 *
 * Walk the rows in time order, starting in the check-in's state. The time up
 * to each row belongs to the state before it, but a fix only vouches for the
 * next `gapMs` — past that the time is "no signal". After the phone reports
 * GPS off (or no permission) the time is "off" for as long as it lasts,
 * because the phone told us why. A mock-location fix counts as off too.
 *
 * Pure: the live page and the report both go through it, so they cannot
 * disagree about a day.
 */
export function summarizeTrack(input: SummaryInput): TrackSummary {
  const gap = input.gapMs ?? GAP_MS;
  const from = input.from.getTime();
  const to = Math.max(input.to.getTime(), from);
  // A fix a little either side of the window — a phone clock a few seconds
  // ahead, a fix taken as the check-out landed — is one ingest accepted, so it
  // counts, pinned to the edge. Anything further out is not this window's.
  const slack = CLOCK_SLACK_MS;
  const rows = input.rows
    .filter((r) => r.ts.getTime() >= from - slack && r.ts.getTime() <= to + slack)
    .map((r) => {
      const ts = Math.min(Math.max(r.ts.getTime(), from), to);
      return ts === r.ts.getTime() ? r : { ...r, ts: new Date(ts) };
    })
    .sort((a, b) => a.ts.getTime() - b.ts.getTime());

  type Seg = { state: LiveState; from: number; to: number; beyond: number };
  const segs: Seg[] = [];
  const push = (state: LiveState, a: number, b: number, beyond = 0) => {
    if (b <= a) return;
    const prev = segs[segs.length - 1];
    if (prev && prev.state === state && prev.to === a) {
      prev.to = b;
      prev.beyond = Math.max(prev.beyond, beyond);
    } else {
      segs.push({ state, from: a, to: b, beyond });
    }
  };

  let state: TrackState = toState(input.seedStatus);
  let lastFixState: TrackState = state;
  let beyond = 0;
  let t = from;
  let mockFixes = 0;
  let last: TrackRow | null = null;

  const advance = (until: number) => {
    if (state === 'OFF') {
      push('OFF', t, until);
    } else {
      const vouched = Math.min(until, t + gap);
      push(state, t, vouched, beyond);
      push('NO_SIGNAL', vouched, until);
    }
    t = until;
  };

  for (const r of rows) {
    advance(r.ts.getTime());
    if (r.kind === 'FIX') {
      if (r.isMock) {
        mockFixes++;
        state = 'OFF';
        continue;
      }
      state = toState(r.status);
      lastFixState = state;
      beyond = r.distance != null ? Math.max(0, r.distance - input.radius) : 0;
      if (r.lat != null && r.lng != null) last = r;
    } else if (r.kind === 'GPS_ON') {
      // Back on: assume where it last was until the next fix says otherwise —
      // which, at a two-minute interval, is a couple of minutes away.
      if (state === 'OFF') state = lastFixState;
    } else {
      state = 'OFF';
    }
  }
  // Where things stand at `to`, decided before the tail is credited: a fix
  // landing exactly at the end changes the state without adding a segment.
  const lastRowAt = t;
  const endState: LiveState = state !== 'OFF' && to - lastRowAt > gap ? 'NO_SIGNAL' : state;
  advance(to);

  const total = (s: LiveState) => segs.filter((g) => g.state === s).reduce((n, g) => n + (g.to - g.from), 0);
  const min = (ms: number) => Math.round(ms / 60_000);
  const tail = segs[segs.length - 1];
  const current =
    tail && tail.state === endState
      ? { state: endState, since: new Date(tail.from) }
      : { state: endState, since: new Date(endState === 'NO_SIGNAL' ? lastRowAt + gap : lastRowAt) };

  return {
    insideMin: min(total('INSIDE')),
    outsideMin: min(total('OUTSIDE')),
    offMin: min(total('OFF')),
    noSignalMin: min(total('NO_SIGNAL')),
    mockFixes,
    episodes: segs
      .filter((g) => g.state === 'OUTSIDE')
      .map((g) => ({ from: new Date(g.from), to: new Date(g.to), minutes: min(g.to - g.from), maxBeyondM: Math.round(g.beyond) })),
    current,
    last,
  };
}

// ── Phone side ──

export interface IngestBody {
  attendanceId: string;
  points: { ts: string; lat: number; lng: number; accuracy?: number | null; mock?: boolean }[];
  events?: { ts: string; kind: TrackEventKind }[];
}

export interface IngestResult {
  /** False tells the phone to stop: checked out, switched off, or exempted. */
  tracking: boolean;
  intervalSec: number;
  accepted: number;
  dropped: number;
}

/**
 * Store a batch from the phone.
 *
 * Points outside the window are dropped (a wrong phone clock, or a fix taken
 * after check-out). Points that arrive late but belong inside it — a phone
 * that was offline and flushed after checking out — are still accepted. The
 * same batch re-sent lands once, on the (attendance, kind, timestamp) key.
 */
export async function ingestTrack(
  prisma: PrismaClient,
  employeeId: string,
  body: IngestBody,
  now: Date = new Date(),
): Promise<IngestResult> {
  const att = await prisma.attendance.findUnique({
    where: { id: body.attendanceId },
    include: { employee: { include: { branch: true, shift: true } } },
  });
  // Someone else's day and an untracked day look the same: not found.
  if (!att || att.employeeId !== employeeId || !att.trackingFrom) throw AppError.notFound('Tracked attendance');

  const win = trackingWindow(att, att.employee.shift.isNightShift, now)!;
  const lo = win.from.getTime() - 60_000;
  const hi = Math.min(win.end.getTime() + 60_000, now.getTime() + 120_000);
  const fits = (d: Date) => !Number.isNaN(d.getTime()) && d.getTime() >= lo && d.getTime() <= hi;

  const tenantId = requireTenantId();
  const data: Prisma.GPSLogCreateManyInput[] = [];
  let dropped = 0;
  for (const p of body.points) {
    const ts = new Date(p.ts);
    if (!fits(ts)) { dropped++; continue; }
    const c = classifyFix(p, att.employee.branch);
    data.push({
      tenantId, attendanceId: att.id, employeeId, kind: 'FIX',
      lat: p.lat, lng: p.lng, accuracy: p.accuracy ?? null,
      geofenceStatus: c.status, distance: c.distance, isMock: !!p.mock, timestamp: ts,
    });
  }
  for (const e of body.events ?? []) {
    const ts = new Date(e.ts);
    if (!fits(ts)) { dropped++; continue; }
    data.push({ tenantId, attendanceId: att.id, employeeId, kind: e.kind, timestamp: ts });
  }
  const { count } = data.length ? await prisma.gPSLog.createMany({ data, skipDuplicates: true }) : { count: 0 };

  const { attendance: policy } = await getTenantPolicy(prisma);
  const tracking = win.open && policy.liveTrackingOn && !att.employee.trackingExempt && att.employee.status === 'ACTIVE';
  // Still open but no longer wanted: close it here, so the report ends the
  // window now instead of counting the rest of the shift as no signal.
  if (win.open && !tracking) {
    await prisma.attendance.update({ where: { id: att.id }, data: { trackingTo: now } });
  }
  return { tracking, intervalSec: TRACK_INTERVAL_SEC, accepted: count, dropped };
}

/**
 * The day the phone should be tracking right now, if any. The app asks on
 * open, so tracking resumes after a restart — including a night shift past
 * midnight, which `/attendance/today` would not find.
 */
export async function currentTracking(prisma: PrismaClient, employeeId: string, now: Date = new Date()) {
  const off = { enabled: false, intervalSec: TRACK_INTERVAL_SEC, attendanceId: null as string | null };
  const employee = await prisma.employee.findUnique({ where: { id: employeeId }, include: { shift: true } });
  if (!employee) return off;
  const today = startOfDay(now);
  const dates = [today];
  if (employee.shift.isNightShift) dates.push(new Date(today.getTime() - 86_400_000));
  const att = await prisma.attendance.findFirst({
    where: { employeeId, date: { in: dates }, trackingFrom: { not: null }, trackingTo: null, checkOut: null },
    orderBy: { date: 'desc' },
  });
  if (!att) return off;
  const { attendance: policy } = await getTenantPolicy(prisma);
  const win = trackingWindow(att, employee.shift.isNightShift, now)!;
  const enabled = win.open && policy.liveTrackingOn && !employee.trackingExempt;
  return enabled ? { ...off, enabled, attendanceId: att.id } : off;
}

/**
 * End every open tracked window now — the dealer switched tracking off, or
 * exempted one employee. Without this the rest of the shift would read as
 * "no signal" in the report.
 */
export async function closeOpenTracking(prisma: PrismaClient, where: { employeeId?: string }, now: Date = new Date()) {
  await prisma.attendance.updateMany({
    where: { ...where, trackingFrom: { not: null }, trackingTo: null, checkOut: null },
    data: { trackingTo: now },
  });
}

// ── Admin side ──

/**
 * Which employees a caller may watch. A branch manager sees their own branch
 * and their direct reports — the same reach as `assertManages`.
 */
export function watchableWhere(user: Pick<JwtPayload, 'role' | 'sub' | 'branchId'>): Prisma.EmployeeWhereInput {
  if (user.role !== 'BRANCH_MANAGER') return {};
  return { OR: [{ reportingManagerId: user.sub }, ...(user.branchId ? [{ branchId: user.branchId }] : [])] };
}

const LOG_SELECT = {
  attendanceId: true, kind: true, lat: true, lng: true, accuracy: true,
  geofenceStatus: true, distance: true, isMock: true, timestamp: true,
} as const;
type LogRow = Prisma.GPSLogGetPayload<{ select: typeof LOG_SELECT }>;

const toRow = (l: LogRow): TrackRow => ({
  ts: l.timestamp, kind: l.kind, status: l.geofenceStatus, distance: l.distance,
  isMock: l.isMock, lat: l.lat, lng: l.lng, accuracy: l.accuracy,
});

async function logsByAttendance(prisma: PrismaClient, ids: string[]): Promise<Map<string, TrackRow[]>> {
  const out = new Map<string, TrackRow[]>();
  if (ids.length === 0) return out;
  const logs = await prisma.gPSLog.findMany({
    where: { attendanceId: { in: ids } },
    orderBy: { timestamp: 'asc' },
    select: LOG_SELECT,
  });
  for (const l of logs) {
    const list = out.get(l.attendanceId) ?? [];
    list.push(toRow(l));
    out.set(l.attendanceId, list);
  }
  return out;
}

const BRANCH_SELECT = {
  id: true, name: true, geofenceLat: true, geofenceLng: true, geofenceRadius: true, strictMode: true,
} as const;

/** Everyone checked in right now who is being tracked, with where they are. */
export async function liveTracking(
  prisma: PrismaClient,
  opts: { branchId?: string; watchable: Prisma.EmployeeWhereInput },
  now: Date = new Date(),
) {
  const { attendance: policy } = await getTenantPolicy(prisma);
  const branches = await prisma.branch.findMany({
    where: opts.branchId ? { id: opts.branchId } : {},
    orderBy: { name: 'asc' },
    select: BRANCH_SELECT,
  });
  if (!policy.liveTrackingOn) return { enabled: false as const, intervalSec: TRACK_INTERVAL_SEC, branches };

  const today = startOfDay(now);
  const yesterday = new Date(today.getTime() - 86_400_000);
  const rows = await prisma.attendance.findMany({
    where: {
      date: { in: [yesterday, today] },
      checkIn: { not: null },
      checkOut: null,
      employee: { status: 'ACTIVE', ...(opts.branchId ? { branchId: opts.branchId } : {}), AND: [opts.watchable] },
    },
    include: {
      employee: {
        include: {
          branch: true, shift: true,
          department: { select: { name: true } }, designation: { select: { name: true } },
        },
      },
    },
  });
  // Yesterday's row is still "now" only for a night shift.
  const current = rows.filter((r) => r.date.getTime() === today.getTime() || r.employee.shift.isNightShift);
  const tracked = current.filter((r) => r.trackingFrom && !r.trackingTo && trackingWindow(r, r.employee.shift.isNightShift, now)?.open);
  const logs = await logsByAttendance(prisma, tracked.map((r) => r.id));

  const employees = tracked.map((r) => {
    const win = trackingWindow(r, r.employee.shift.isNightShift, now)!;
    const s = summarizeTrack({
      from: win.from, to: win.to, seedStatus: r.geofenceStatus,
      radius: r.employee.branch.geofenceRadius, rows: logs.get(r.id) ?? [],
    });
    return {
      attendanceId: r.id,
      employeeId: r.employeeId,
      name: r.employee.name,
      employeeCode: r.employee.employeeCode,
      branchId: r.employee.branchId,
      branch: r.employee.branch.name,
      department: r.employee.department.name,
      designation: r.employee.designation.name,
      checkIn: r.checkIn,
      state: s.current.state,
      since: s.current.since,
      last: s.last
        ? { lat: s.last.lat, lng: s.last.lng, accuracy: s.last.accuracy, ts: s.last.ts, distance: s.last.distance, status: s.last.status }
        : null,
      insideMin: s.insideMin,
      outsideMin: s.outsideMin,
      offMin: s.offMin,
      noSignalMin: s.noSignalMin,
      episodes: s.episodes.length,
      mockFixes: s.mockFixes,
    };
  });

  return {
    enabled: true as const,
    intervalSec: TRACK_INTERVAL_SEC,
    generatedAt: now,
    branches,
    // Checked in but not followed (exempt, kiosk, manual, or switched off) —
    // so the count reconciles with Live Attendance.
    untrackedCheckedIn: current.length - tracked.length,
    employees,
  };
}

/** One tracked day's path and summary, for drawing it on the map. */
export async function trackDetail(prisma: PrismaClient, attendanceId: string, now: Date = new Date()) {
  const att = await prisma.attendance.findUnique({
    where: { id: attendanceId },
    include: { employee: { include: { branch: { select: BRANCH_SELECT }, shift: true } } },
  });
  if (!att || !att.trackingFrom) throw AppError.notFound('Tracked attendance');
  const win = trackingWindow(att, att.employee.shift.isNightShift, now)!;
  const rows = (await logsByAttendance(prisma, [att.id])).get(att.id) ?? [];
  const summary = summarizeTrack({
    from: win.from, to: win.to, seedStatus: att.geofenceStatus,
    radius: att.employee.branch.geofenceRadius, rows,
  });
  return {
    employee: { id: att.employeeId, name: att.employee.name, employeeCode: att.employee.employeeCode },
    branch: att.employee.branch,
    window: { from: win.from, to: win.to, open: win.open },
    checkIn: { lat: att.checkInLat, lng: att.checkInLng, at: att.checkIn },
    points: rows
      .filter((r) => r.kind === 'FIX' && r.lat != null && r.lng != null)
      .map((r) => ({ ts: r.ts, lat: r.lat, lng: r.lng, accuracy: r.accuracy, status: r.status, distance: r.distance, mock: !!r.isMock })),
    events: rows.filter((r) => r.kind !== 'FIX').map((r) => ({ ts: r.ts, kind: r.kind })),
    summary,
  };
}

export interface TrackingReportRow {
  attendanceId: string;
  date: Date;
  employeeCode: string;
  name: string;
  branch: string;
  department: string;
  designation: string;
  checkIn: Date | null;
  checkOut: Date | null;
  trackedMin: number;
  summary: TrackSummary;
}

/**
 * Every tracked day in a date range, summarised. Logs are read a slice of days
 * at a time — a month of two-minute fixes for a whole dealership is too many
 * rows to hold at once.
 */
export async function trackingReportRows(
  prisma: PrismaClient,
  opts: { from: Date; to: Date; employee: Prisma.EmployeeWhereInput },
  now: Date = new Date(),
): Promise<TrackingReportRow[]> {
  const days = await prisma.attendance.findMany({
    where: {
      date: { gte: startOfDay(opts.from), lte: startOfDay(opts.to) },
      trackingFrom: { not: null },
      employee: { status: 'ACTIVE', ...opts.employee },
    },
    orderBy: [{ date: 'asc' }, { checkIn: 'asc' }],
    include: {
      employee: {
        include: {
          branch: true, shift: true,
          department: { select: { name: true } }, designation: { select: { name: true } },
        },
      },
    },
  });

  const out: TrackingReportRow[] = [];
  const SLICE = 50;
  for (let i = 0; i < days.length; i += SLICE) {
    const slice = days.slice(i, i + SLICE);
    const logs = await logsByAttendance(prisma, slice.map((d) => d.id));
    for (const d of slice) {
      const win = trackingWindow(d, d.employee.shift.isNightShift, now)!;
      const summary = summarizeTrack({
        from: win.from, to: win.to, seedStatus: d.geofenceStatus,
        radius: d.employee.branch.geofenceRadius, rows: logs.get(d.id) ?? [],
      });
      out.push({
        attendanceId: d.id,
        date: d.date,
        employeeCode: d.employee.employeeCode,
        name: d.employee.name,
        branch: d.employee.branch.name,
        department: d.employee.department.name,
        designation: d.employee.designation.name,
        checkIn: d.checkIn,
        checkOut: d.checkOut,
        trackedMin: Math.round((win.to.getTime() - win.from.getTime()) / 60_000),
        summary,
      });
    }
  }
  return out;
}
