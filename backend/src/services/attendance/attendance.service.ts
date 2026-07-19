import type { PrismaClient } from '@prisma/client';
import { promises as fs } from 'fs';
import path from 'path';
import { AppError } from '../../utils/AppError.js';
import { checkGeofence } from '../geofence/geofence.service.js';
import { verifyFace, isFaceMatchEnabled } from '../ai/face.service.js';
import { dispatchWhatsApp, waTemplates } from '../whatsapp/whatsapp.service.js';
import { isS3Enabled, uploadImage } from '../storage/storage.service.js';

const UPLOAD_DIR = path.resolve(process.cwd(), 'uploads');

function startOfToday(): Date {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return d;
}

/** Build today's Date at the shift's HH:MM start time. */
function shiftStartToday(startTime: string): Date {
  const [h, m] = startTime.split(':').map(Number);
  const d = new Date();
  d.setHours(h || 0, m || 0, 0, 0);
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

  // (0,0) means the phone had no GPS fix — reject with a human message instead
  // of computing an absurd distance to Null Island.
  if (lat === 0 && lng === 0) {
    throw new AppError('Your phone did not send a location. Switch ON Location/GPS, wait a few seconds, and try again.', 400);
  }

  const geo = checkGeofence({ lat, lng }, employee.branch, accuracy);
  // Strict-mode branches hard-block outside check-ins. Soft-mode branches accept
  // them but hold for HR/admin approval — unpaid until approved (rejected → absent).
  if (geo.status === 'OUTSIDE' && employee.branch.strictMode) {
    throw new AppError(
      `You are ${Math.round(geo.distance)}m away from ${employee.branch.name}. Move inside the branch area to check in.`,
      403,
    );
  }
  const approvalStatus = geo.status === 'OUTSIDE' ? 'PENDING' : null;

  const today = startOfToday();
  const existing = await prisma.attendance.findUnique({
    where: { employeeId_date: { employeeId, date: today } },
  });
  if (existing?.checkIn) throw new AppError('Already checked in today', 409);

  const now = new Date();
  const lateAfter = shiftStartToday(employee.shift.startTime).getTime() + (employee.shift.gracePeriod ?? 0) * 60_000;
  const status = now.getTime() > lateAfter ? 'LATE' : 'PRESENT';

  // Identity gate before any side effects: enrolled face + selfie must match
  // the logged-in employee, or the check-in is rejected outright.
  const faceMatchScore = await requireFaceMatch(employee.faceTemplateId, selfie, employeeId);

  const selfieUrl = selfie ? await saveSelfie(selfie, employeeId) : null;

  const geoFlagged = geo.status !== 'INSIDE';
  const flagged = geoFlagged;
  const flagReason = geoFlagged
    ? `Geofence ${geo.status} — ${Math.round(geo.distance)}m from ${employee.branch.name}${approvalStatus ? ' (awaiting HR approval)' : ''}`
    : null;

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
  const today = startOfToday();
  const existing = await prisma.attendance.findUnique({
    where: { employeeId_date: { employeeId, date: today } },
  });
  if (!existing?.checkIn) throw new AppError('No check-in found for today', 409);
  if (existing.checkOut) throw new AppError('Already checked out today', 409);

  // Same identity gate as check-in — nobody can check out on a colleague's behalf.
  const employee = await prisma.employee.findUnique({
    where: { id: employeeId },
    include: { branch: true },
  });
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

  const record = await prisma.attendance.update({
    where: { id: existing.id },
    data: { checkOut: now, checkOutLat: lat, checkOutLng: lng, checkOutSelfie: selfieUrl, workingMinutes },
  });

  return toResult(record, record.geofenceStatus, 0, record.isFlagged, record.flagReason, record.approvalStatus);
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
  return prisma.attendance.update({
    where: { id: attendanceId },
    data: {
      approvalStatus: approve ? 'APPROVED' : 'REJECTED',
      approvedBy: adminId,
      approvedAt: new Date(),
      ...(approve ? {} : { status: 'ABSENT' }),
    },
  });
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
