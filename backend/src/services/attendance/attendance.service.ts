import type { PrismaClient } from '@prisma/client';
import { promises as fs } from 'fs';
import path from 'path';
import { AppError } from '../../utils/AppError.js';
import { checkGeofence } from '../geofence/geofence.service.js';

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
 * Persist the selfie. Dev: writes to backend/uploads and returns a relative path.
 * TODO (CLAUDE.md): upload to Cloudinary with a 24h signed URL instead.
 */
async function saveSelfie(buf: Buffer, employeeId: string): Promise<string> {
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
  // TODO: AWS Rekognition face match -> score. Per CLAUDE.md, a low score flags but never blocks.
  const faceMatchScore: number | null = null;
  const flagged = geo.status !== 'INSIDE';

  const record = await prisma.attendance.upsert({
    where: { employeeId_date: { employeeId, date: today } },
    update: {
      checkIn: now, checkInLat: lat, checkInLng: lng, checkInSelfie: selfieUrl,
      geofenceStatus: geo.status, status, faceMatchScore,
      isFlagged: flagged, flagReason: flagged ? `Geofence ${geo.status}` : null,
    },
    create: {
      employeeId, date: today, checkIn: now, checkInLat: lat, checkInLng: lng, checkInSelfie: selfieUrl,
      geofenceStatus: geo.status, status, faceMatchScore,
      isFlagged: flagged, flagReason: flagged ? `Geofence ${geo.status}` : null,
    },
  });

  return toResult(record, geo.status, geo.distance);
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

  return toResult(record, record.geofenceStatus, 0);
}

function toResult(
  r: { id: string; status: string; checkIn: Date | null; checkOut: Date | null; workingMinutes: number | null; faceMatchScore: number | null },
  geofence: string,
  distance: number,
): MarkResult {
  return {
    id: r.id,
    status: r.status,
    checkIn: r.checkIn,
    checkOut: r.checkOut,
    workingMinutes: r.workingMinutes,
    faceMatchScore: r.faceMatchScore,
    geofence,
    distance,
  };
}
