import type { PrismaClient } from '@prisma/client';
import { promises as fs } from 'fs';
import path from 'path';
import { AppError } from '../../utils/AppError.js';
import { checkGeofence } from '../geofence/geofence.service.js';
import { verifyFace, isFaceMatchEnabled } from '../ai/face.service.js';
import { dispatchWhatsApp, waTemplates } from '../whatsapp/whatsapp.service.js';
import { isS3Enabled, uploadImage } from '../storage/storage.service.js';
import { notifyAdmins, approverIds } from '../notification.service.js';
import { pushToEmployee } from '../push.service.js';
import { resolveAttendanceStatus, isLateArrival } from './attendance-policy.js';
import { atCompanyTime, startOfDay } from '../../utils/time.js';

const UPLOAD_DIR = path.resolve(process.cwd(), 'uploads');

// Late punches require reporting-manager/HR approval to be paid (else marked as leave).
// Toggle off with LATE_REQUIRES_APPROVAL=false.
const LATE_REQUIRES_APPROVAL = process.env.LATE_REQUIRES_APPROVAL !== 'false';

// How far back we look for a punch the employee left open (checked in, never
// checked out). Bounded so rows predating this rule can't lock someone out for
// good — only recent forgotten check-outs block the next check-in.
const OPEN_PUNCH_LOOKBACK_DAYS = Number(process.env.OPEN_PUNCH_LOOKBACK_DAYS ?? 7);

const COMPANY_TZ = process.env.COMPANY_TZ ?? 'Asia/Kolkata';

function startOfToday(): Date {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return d;
}

/**
 * Persist the selfie. Uses S3 (private object key) when configured; otherwise
 * falls back to local disk so dev works with zero setup.
 */
async function saveSelfie(buf: Buffer, employeeId: string): Promise<string> {
  if (isS3Enabled()) {
    return uploadImage(buf, `selfies/${employeeId}-${Date.now()}.jpg`);
  }
  await fs.mkdir(UPLOAD_DIR, { recursive: true });
  const name = `${employeeId}-${Date.now()}.jpg`;
  await fs.writeFile(path.join(UPLOAD_DIR, name), buf);
  return `/uploads/${name}`;
}

/**
 * Strict face gate: attendance requires an enrolled face, and the selfie must
 * match the logged-in employee at/above the configured threshold — otherwise
 * the request is rejected. Skipped only when AWS isn't configured (local dev),
 * so the app still runs with zero setup. Returns the match score to store.
 */
async function requireFaceMatch(
  faceTemplateId: string | null,
  selfie: Buffer | null,
  employeeId: string,
): Promise<number | null> {
  if (!isFaceMatchEnabled()) return null;
  if (!faceTemplateId) {
    throw new AppError('Your face is not enrolled yet. Ask your admin to enroll it before you can mark attendance.', 403);
  }
  if (!selfie) throw new AppError('A selfie is required to mark attendance', 400);
  const fm = await verifyFace(selfie, employeeId);
  if (!fm.matched) {
    throw new AppError(
      fm.matchedEmployeeId && fm.matchedEmployeeId !== employeeId
        ? 'This selfie matches a different employee — attendance must be marked with your own face.'
        : `Face not recognised (${fm.score}% match). Try again facing the camera in good light.`,
      403,
    );
  }
  return fm.score;
}

/** A past day the employee checked in on but never checked out of. */
export interface OpenPunchDay {
  attendanceId: string;
  /** yyyy-MM-dd — pre-fills the manual punch form. */
  date: string;
  /** "Mon, Aug 3" — for the message shown to the employee. */
  dateLabel: string;
  /** That day's check-in, e.g. "09:02 AM". */
  checkIn: string | null;
  /** The shift's closing time ("18:00"), a sane default for the time picker. */
  shiftEnd: string | null;
  /** How many days are still open in the lookback window. */
  openDays: number;
}

/**
 * Days the employee left open — checked in, never checked out — oldest first,
 * within the lookback window. Days an admin already settled (absent / leave /
 * holiday) don't need a check-out and are ignored.
 */
async function findOpenPunchRows(prisma: PrismaClient, employeeId: string) {
  const today = startOfToday();
  const from = new Date(today);
  from.setDate(from.getDate() - OPEN_PUNCH_LOOKBACK_DAYS);
  return prisma.attendance.findMany({
    where: {
      employeeId,
      date: { gte: from, lt: today },
      checkIn: { not: null },
      checkOut: null,
      status: { notIn: ['ABSENT', 'ON_LEAVE', 'HOLIDAY'] },
    },
    orderBy: { date: 'asc' },
    include: { employee: { include: { shift: true } } },
  });
}

/** The oldest day still waiting for a check-out, or null when there is none. */
export async function findOpenPunch(
  prisma: PrismaClient,
  employeeId: string,
): Promise<OpenPunchDay | null> {
  const rows = await findOpenPunchRows(prisma, employeeId);
  if (!rows.length) return null;
  const r = rows[0];
  return {
    attendanceId: r.id,
    date: `${r.date.getFullYear()}-${String(r.date.getMonth() + 1).padStart(2, '0')}-${String(r.date.getDate()).padStart(2, '0')}`,
    dateLabel: r.date.toLocaleDateString('en-US', {
      weekday: 'short',
      month: 'short',
      day: 'numeric',
      timeZone: COMPANY_TZ,
    }),
    checkIn: r.checkIn
      ? r.checkIn.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', timeZone: COMPANY_TZ })
      : null,
    shiftEnd: r.employee.shift?.endTime ?? null,
    openDays: rows.length,
  };
}

/**
 * The block an employee hits when an earlier day is still open. Carries the day
 * itself in `details` so the app can jump straight into a pre-filled manual
 * punch instead of making the employee work out what is wrong.
 */
function missingCheckOutError(open: OpenPunchDay): AppError {
  const more = open.openDays > 1 ? ` (${open.openDays} days are still open)` : '';
  return new AppError(
    `Please enter your check-out time for ${open.dateLabel} — you checked in at ${open.checkIn ?? '—'} but never checked out${more}. ` +
      'Send that day for approval and you can check in again.',
    409,
    { code: 'MISSING_CHECKOUT', ...open },
  );
}

export interface MarkResult {
  id: string;
  status: string;
  checkIn: Date | null;
  checkOut: Date | null;
  workingMinutes: number | null;
  faceMatchScore: number | null;
  flagged: boolean;
  flagReason: string | null;
  geofence: string;
  distance: number;
  /** PENDING when the check-in was outside the geofence and awaits HR approval. */
  approvalStatus: string | null;
}

/** Selfie check-in: geofence gate, late/present calc, persist attendance. */
export async function markCheckIn(
  prisma: PrismaClient,
  employeeId: string,
  selfie: Buffer | null,
  lat: number,
  lng: number,
  accuracy?: number,
): Promise<MarkResult> {
  const employee = await prisma.employee.findUnique({
    where: { id: employeeId },
    include: { branch: true, shift: true },
  });
  if (!employee) throw AppError.notFound('Employee not found');

  // A day left open (checked in, never checked out) has to be settled first —
  // otherwise it silently stays unpaid. The employee raises the missing
  // check-out as a manual punch; once it is in for approval this clears and
  // the check-in goes through (approval is not required to check in again).
  const open = await findOpenPunch(prisma, employeeId);
  if (open) throw missingCheckOutError(open);

  // (0,0) means the phone had no GPS fix — reject with a human message instead
  // of computing an absurd distance to Null Island.
  if (lat === 0 && lng === 0) {
    throw new AppError('Your phone did not send a location. Switch ON Location/GPS, wait a few seconds, and try again.', 400);
  }

  const geo = checkGeofence({ lat, lng }, employee.branch, accuracy);
  // Strict-mode branches hard-block outside check-ins.
  if (geo.status === 'OUTSIDE' && employee.branch.strictMode) {
    throw new AppError(
      `You are ${Math.round(geo.distance)}m away from ${employee.branch.name}. Move inside the branch area to check in.`,
      403,
    );
  }

  const today = startOfToday();
  const existing = await prisma.attendance.findUnique({
    where: { employeeId_date: { employeeId, date: today } },
  });
  if (existing?.checkIn) throw new AppError('Already checked in today', 409);

  const now = new Date();
  // Half-day window (12:30–14:00) takes precedence over LATE — see attendance-policy.
  const status = resolveAttendanceStatus({ checkIn: now, checkOut: null, shift: employee.shift });
  const late = isLateArrival(now, employee.shift);

  // A late punch, or an out-of-zone (soft-mode) punch, is held for approval —
  // it isn't paid until the reporting manager / HR approves it.
  const lateNeedsApproval = late && LATE_REQUIRES_APPROVAL;
  const approvalStatus = geo.status === 'OUTSIDE' || lateNeedsApproval ? 'PENDING' : null;

  // Identity gate before any side effects: enrolled face + selfie must match
  // the logged-in employee, or the check-in is rejected outright.
  const faceMatchScore = await requireFaceMatch(employee.faceTemplateId, selfie, employeeId);

  const selfieUrl = selfie ? await saveSelfie(selfie, employeeId) : null;

  const geoFlagged = geo.status !== 'INSIDE';
  const flagged = geoFlagged || lateNeedsApproval;
  const reasons: string[] = [];
  if (geoFlagged) reasons.push(`Geofence ${geo.status} — ${Math.round(geo.distance)}m from ${employee.branch.name}`);
  if (lateNeedsApproval) reasons.push('Late arrival');
  const flagReason = reasons.length ? `${reasons.join('; ')}${approvalStatus ? ' — awaiting approval' : ''}` : null;

  // Log a geofence violation row when the check-in is outside/borderline the zone.
  if (geoFlagged) {
    await prisma.geofenceViolation.create({
      data: { employeeId, branchId: employee.branchId, lat, lng, distance: geo.distance },
    });
  }

  const record = await prisma.attendance.upsert({
    where: { employeeId_date: { employeeId, date: today } },
    update: {
      checkIn: now, checkInLat: lat, checkInLng: lng, checkInSelfie: selfieUrl,
      geofenceStatus: geo.status, status, faceMatchScore,
      isFlagged: flagged, flagReason, approvalStatus,
    },
    create: {
      employeeId, date: today, checkIn: now, checkInLat: lat, checkInLng: lng, checkInSelfie: selfieUrl,
      geofenceStatus: geo.status, status, faceMatchScore,
      isFlagged: flagged, flagReason, approvalStatus,
    },
  });

  // Pending punch → notify the reporting manager / branch approver(s) to decide.
  if (approvalStatus === 'PENDING') {
    const reason = lateNeedsApproval ? 'late arrival' : 'out-of-zone check-in';
    await notifyAdmins(prisma, await approverIds(prisma, employee), {
      type: 'CLAIM_SUBMITTED',
      title: 'Attendance needs approval',
      body: `${employee.name} — ${reason} today. Approve to pay, or reject.`,
    });
  }

  // Check-in confirmation (logged always; delivered when a provider is configured).
  await dispatchWhatsApp(prisma, {
    phone: employee.phone,
    employeeId: employee.id,
    trigger: 'CHECK_IN',
    templateName: 'CHECK_IN_CONFIRMATION',
    message: waTemplates.checkIn(
      employee.name,
      now.toLocaleTimeString('en-US', {
        hour: '2-digit',
        minute: '2-digit',
        timeZone: process.env.COMPANY_TZ ?? 'Asia/Kolkata',
      }),
      employee.branch.name,
    ),
  });

  return toResult(record, geo.status, geo.distance, flagged, flagReason, approvalStatus);
}

/** Selfie check-out: compute working minutes, persist. */
export async function markCheckOut(
  prisma: PrismaClient,
  employeeId: string,
  selfie: Buffer | null,
  lat: number,
  lng: number,
): Promise<MarkResult> {
  // Same identity gate as check-in — nobody can check out on a colleague's behalf.
  const employee = await prisma.employee.findUnique({
    where: { id: employeeId },
    include: { branch: true, shift: true },
  });

  const today = startOfToday();
  let existing = await prisma.attendance.findUnique({
    where: { employeeId_date: { employeeId, date: today } },
  });
  // A night shift starts on one calendar day and closes on the next, so when
  // there is nothing open today, fall back to yesterday's still-open punch.
  if (!existing?.checkIn && employee?.shift?.isNightShift) {
    const yesterday = new Date(today);
    yesterday.setDate(yesterday.getDate() - 1);
    existing = await prisma.attendance.findUnique({
      where: { employeeId_date: { employeeId, date: yesterday } },
    });
    if (existing?.checkOut) existing = null; // already closed — nothing to do
  }
  if (!existing?.checkIn) throw new AppError('No check-in found for today', 409);
  if (existing.checkOut) throw new AppError('Already checked out today', 409);

  await requireFaceMatch(employee?.faceTemplateId ?? null, selfie, employeeId);

  if (lat === 0 && lng === 0) {
    throw new AppError('Your phone did not send a location. Switch ON Location/GPS, wait a few seconds, and try again.', 400);
  }

  // Strict-mode branches also block outside check-outs (same rule as check-in).
  if (employee?.branch.strictMode) {
    const geo = checkGeofence({ lat, lng }, employee.branch);
    if (geo.status === 'OUTSIDE') {
      throw new AppError(
        `You are ${Math.round(geo.distance)}m away from ${employee.branch.name}. Move inside the branch area to check out.`,
        403,
      );
    }
  }

  const now = new Date();
  const workingMinutes = Math.round((now.getTime() - existing.checkIn.getTime()) / 60_000);
  const selfieUrl = selfie ? await saveSelfie(selfie, employeeId) : null;

  // Leaving inside the midday window turns the day into a half day — re-derive
  // the status now that both punch times are known.
  const status = employee?.shift
    ? resolveAttendanceStatus({ checkIn: existing.checkIn, checkOut: now, shift: employee.shift })
    : existing.status;

  const record = await prisma.attendance.update({
    where: { id: existing.id },
    data: { checkOut: now, checkOutLat: lat, checkOutLng: lng, checkOutSelfie: selfieUrl, workingMinutes, status },
  });

  return toResult(record, record.geofenceStatus, 0, record.isFlagged, record.flagReason, record.approvalStatus);
}

export interface ManualPunchInput {
  employeeId: string;
  /** MANUAL = typed times, no photo. SELFIE = photo attached, no geofence/face gate. */
  mode: 'MANUAL' | 'SELFIE';
  /** Wall-clock "HH:MM" in company time. At least one of the two is required. */
  checkIn?: string | null;
  checkOut?: string | null;
  /** Calendar day the punch belongs to. Defaults to today. */
  date?: Date;
  reason: string;
  selfie?: Buffer | null;
  /** Set when HR raised the punch on the employee's behalf. */
  raisedByAdminId?: string | null;
}

/**
 * Manual / selfie punch — the escape hatch for a punch that can't go through
 * the normal gate (face verification failing, or the employee working away
 * from the branch geofence).
 *
 * Deliberately skips geofence, face matching and the shift-time gate: the
 * punch is recorded as typed and always lands as PENDING, so it pays only
 * once the reporting manager approves it. Filling in a missing half of an
 * already-recorded day (e.g. a check-out that never went through) sends the
 * whole day back for approval, since the times are now partly unverified.
 */
export async function markManualPunch(
  prisma: PrismaClient,
  input: ManualPunchInput,
): Promise<MarkResult> {
  const { employeeId, mode, reason } = input;
  if (!input.checkIn && !input.checkOut) {
    throw new AppError('Enter a check-in time, a check-out time, or both', 400);
  }
  if (!reason?.trim()) throw new AppError('A reason is required for a manual punch', 400);
  if (mode === 'SELFIE' && !input.selfie) throw new AppError('A selfie is required for a selfie punch', 400);

  const employee = await prisma.employee.findUnique({
    where: { id: employeeId },
    include: { branch: true, shift: true },
  });
  if (!employee) throw AppError.notFound('Employee not found');
  if (employee.status !== 'ACTIVE') throw new AppError('This employee is not active', 403);

  const day = input.date ? startOfDay(input.date) : startOfToday();
  if (day.getTime() > startOfToday().getTime()) {
    throw new AppError('You cannot punch for a future date', 400);
  }

  // Same gate as check-in, so a manual punch can't hop over a day left open —
  // but the punch that settles that day (or an earlier one) always goes through,
  // and HR raising a punch on someone's behalf is never blocked.
  if (!input.raisedByAdminId) {
    const open = await findOpenPunch(prisma, employeeId);
    if (open && day.getTime() > startOfDay(new Date(`${open.date}T00:00:00`)).getTime()) {
      throw missingCheckOutError(open);
    }
  }

  const existing = await prisma.attendance.findUnique({
    where: { employeeId_date: { employeeId, date: day } },
  });

  const checkIn = input.checkIn ? atCompanyTime(day, input.checkIn) : (existing?.checkIn ?? null);
  const checkOut = input.checkOut ? atCompanyTime(day, input.checkOut) : (existing?.checkOut ?? null);
  if (!checkIn) throw new AppError('There is no check-in for this day — enter a check-in time too', 400);
  if (checkOut && checkOut.getTime() <= checkIn.getTime()) {
    // Night shifts legitimately close the next morning; roll the clock forward.
    if (employee.shift?.isNightShift) checkOut.setDate(checkOut.getDate() + 1);
    else throw new AppError('Check-out time must be after the check-in time', 400);
  }

  const status = resolveAttendanceStatus({ checkIn, checkOut, shift: employee.shift });
  const workingMinutes = checkOut ? Math.round((checkOut.getTime() - checkIn.getTime()) / 60_000) : null;
  const selfieUrl = input.selfie ? await saveSelfie(input.selfie, employeeId) : null;

  const label = mode === 'SELFIE' ? 'Selfie punch' : 'Manual punch';
  const raisedNote = input.raisedByAdminId ? ' (raised by HR)' : '';
  const flagReason = `${label}${raisedNote} — ${reason.trim()} — awaiting approval`;

  const data = {
    checkIn,
    ...(checkOut ? { checkOut } : {}),
    ...(workingMinutes != null ? { workingMinutes } : {}),
    // A manual/selfie punch carries no verified location or face score.
    ...(selfieUrl ? (input.checkOut && !input.checkIn ? { checkOutSelfie: selfieUrl } : { checkInSelfie: selfieUrl }) : {}),
    status,
    punchMode: mode,
    punchReason: reason.trim(),
    raisedBy: input.raisedByAdminId ?? null,
    approvalStatus: 'PENDING',
    approvedBy: null,
    approvedAt: null,
    isFlagged: true,
    flagReason,
  };

  const record = await prisma.attendance.upsert({
    where: { employeeId_date: { employeeId, date: day } },
    update: data,
    create: { employeeId, date: day, geofenceStatus: 'OUTSIDE', ...data },
  });

  await notifyAdmins(prisma, await approverIds(prisma, employee), {
    type: 'CLAIM_SUBMITTED',
    title: `${label} needs approval`,
    body: `${employee.name} — ${reason.trim()}. Approve to pay, or reject.`,
  });

  return toResult(record, record.geofenceStatus, 0, true, flagReason, 'PENDING');
}

/** HR/admin decision on an out-of-geofence check-in. Reject marks the day absent. */
export async function decideAttendanceApproval(
  prisma: PrismaClient,
  adminId: string,
  attendanceId: string,
  approve: boolean,
) {
  const att = await prisma.attendance.findUnique({ where: { id: attendanceId } });
  if (!att) throw AppError.notFound('Attendance record');
  if (att.approvalStatus !== 'PENDING') {
    throw new AppError('This attendance is not awaiting approval', 409);
  }
  // Rejecting a late punch marks the day as leave; rejecting an out-of-zone or
  // manual/selfie punch marks it absent. (Neither counts for pay.)
  const rejectStatus = att.status === 'LATE' && att.punchMode === 'GEO' ? 'ON_LEAVE' : 'ABSENT';
  const updated = await prisma.attendance.update({
    where: { id: attendanceId },
    data: {
      approvalStatus: approve ? 'APPROVED' : 'REJECTED',
      approvedBy: adminId,
      approvedAt: new Date(),
      ...(approve ? {} : { status: rejectStatus }),
    },
  });

  // Tell the employee the outcome (push + in-app).
  await pushToEmployee(
    prisma,
    updated.employeeId,
    approve ? 'Attendance approved ✓' : 'Attendance not approved',
    approve
      ? 'Your attendance was approved — it will be paid.'
      : att.punchMode !== 'GEO'
        ? `Your ${att.punchMode === 'SELFIE' ? 'selfie' : 'manual'} punch was not approved — the day is marked absent.`
        : att.status === 'LATE'
          ? 'Your late punch was not approved — that day is marked as leave.'
          : 'Your check-in was not approved — marked absent.',
  );
  return updated;
}

function toResult(
  r: { id: string; status: string; checkIn: Date | null; checkOut: Date | null; workingMinutes: number | null; faceMatchScore: number | null },
  geofence: string,
  distance: number,
  flagged: boolean,
  flagReason: string | null,
  approvalStatus: string | null,
): MarkResult {
  return {
    id: r.id,
    status: r.status,
    checkIn: r.checkIn,
    checkOut: r.checkOut,
    workingMinutes: r.workingMinutes,
    faceMatchScore: r.faceMatchScore,
    flagged,
    flagReason,
    geofence,
    distance,
    approvalStatus,
  };
}
