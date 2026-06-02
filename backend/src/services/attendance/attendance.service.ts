import type { PrismaClient } from '@prisma/client';
import { promises as fs } from 'fs';
import path from 'path';
import { AppError } from '../../utils/AppError.js';
import { checkGeofence } from '../geofence/geofence.service.js';
import { verifyFace } from '../ai/face.service.js';
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

  const geo = checkGeofence({ lat, lng }, employee.branch, accuracy);
  // Strict branches block out-of-zone check-ins; soft branches allow but flag (CLAUDE.md).
  if (employee.branch.strictMode && geo.status === 'OUTSIDE') {
    throw new AppError(
      `Outside work zone — ${Math.round(geo.distance)}m from ${employee.branch.name}`,
      403,
    );
  }

  const today = startOfToday();
  const existing = await prisma.attendance.findUnique({
    where: { employeeId_date: { employeeId, date: today } },
  });
  if (existing?.checkIn) throw new AppError('Already checked in today', 409);

  const now = new Date();
  const lateAfter = shiftStartToday(employee.shift.startTime).getTime() + (employee.shift.gracePeriod ?? 0) * 60_000;
  const status = now.getTime() > lateAfter ? 'LATE' : 'PRESENT';

  const selfieUrl = selfie ? await saveSelfie(selfie, employeeId) : null;

  // AWS Rekognition face match (no-op + null score when AWS isn't configured).
  // Per CLAUDE.md a mismatch flags for HR review but never blocks attendance.
  let faceMatchScore: number | null = null;
  let faceFlagReason: string | null = null;
  if (selfie) {
    const fm = await verifyFace(selfie, employeeId);
    if (fm.enabled) {
      faceMatchScore = fm.score;
      if (!fm.matched) {
        faceFlagReason =
          fm.matchedEmployeeId && fm.matchedEmployeeId !== employeeId
            ? `Face mismatch — selfie matched a different employee (${fm.score}%)`
            : `Face not recognised (${fm.score}%)`;
      }
    }
  }

  const geoFlagged = geo.status !== 'INSIDE';
  const flagged = geoFlagged || faceFlagReason !== null;
  const flagReason =
    [geoFlagged ? `Geofence ${geo.status}` : null, faceFlagReason]
      .filter(Boolean)
      .join('; ') || null;

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
      isFlagged: flagged, flagReason,
    },
    create: {
      employeeId, date: today, checkIn: now, checkInLat: lat, checkInLng: lng, checkInSelfie: selfieUrl,
      geofenceStatus: geo.status, status, faceMatchScore,
      isFlagged: flagged, flagReason,
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
      now.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' }),
      employee.branch.name,
    ),
  });

  return toResult(record, geo.status, geo.distance, flagged, flagReason);
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

  const now = new Date();
  const workingMinutes = Math.round((now.getTime() - existing.checkIn.getTime()) / 60_000);
  const selfieUrl = selfie ? await saveSelfie(selfie, employeeId) : null;

  const record = await prisma.attendance.update({
    where: { id: existing.id },
    data: { checkOut: now, checkOutLat: lat, checkOutLng: lng, checkOutSelfie: selfieUrl, workingMinutes },
  });

  return toResult(record, record.geofenceStatus, 0, record.isFlagged, record.flagReason);
}

function toResult(
  r: { id: string; status: string; checkIn: Date | null; checkOut: Date | null; workingMinutes: number | null; faceMatchScore: number | null },
  geofence: string,
  distance: number,
  flagged: boolean,
  flagReason: string | null,
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
  };
}
