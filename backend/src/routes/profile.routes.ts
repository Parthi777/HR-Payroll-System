import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { promises as fs } from 'fs';
import path from 'path';
import { authenticate } from '../middleware/auth.js';
import { AppError } from '../utils/AppError.js';
import { resolveUploadPath } from '../utils/upload-path.js';
import { getSignedSelfieUrl } from '../services/storage/storage.service.js';
import { TRACK_INTERVAL_SEC } from '../services/tracking/tracking.service.js';

/** Logged-in employee's own profile (for the app home/dashboard header). */
export async function profileRoutes(app: FastifyInstance) {
  app.get('/me', { preHandler: authenticate }, async (req) => {
    const e = await app.prisma.employee.findUnique({
      where: { id: req.user.sub },
      include: { branch: true, designation: true, department: true, shift: true },
    });
    if (!e) throw AppError.notFound('Employee');

    // Who to ring about attendance or salary. The dealer's settings screen is
    // admin-only, so this is the one slice of it an employee may read — a name
    // and a number, nothing else from the company profile.
    //
    // A name with no HR number falls back to the company's own, because a
    // dealership that filled in one field meant to be reachable. Both empty
    // returns null, and the app hides the button rather than dialling nothing.
    const settings = await app.prisma.tenantSettings.findFirst({
      select: {
        hrContactName: true, hrContactPhone: true, phone: true, payrollVisibleToEmployees: true, liveTrackingOn: true,
      },
    });
    const hrPhone = settings?.hrContactPhone?.trim() || settings?.phone?.trim() || '';
    const hrName = settings?.hrContactName?.trim() || '';

    return {
      id: e.id,
      name: e.name,
      employeeCode: e.employeeCode,
      phone: e.phone,
      designation: e.designation.name,
      department: e.department.name,
      branch: e.branch.name,
      shift: e.shift.name,
      hr: hrPhone ? { name: hrName || 'HR', phone: hrPhone } : null,
      // Whether the dealer shares payroll with staff — the app shows the
      // Payroll tab only when it does. The payroll routes enforce it too.
      payrollVisible: settings?.payrollVisibleToEmployees ?? false,
      // Whether this employee's check-ins are live-tracked. The app says so in
      // the check-in dialog; the check-in response is what actually starts it.
      tracking: {
        enabled: (settings?.liveTrackingOn ?? false) && !e.trackingExempt,
        intervalSec: TRACK_INTERVAL_SEC,
      },
      // The branch's pin — where the weather card looks when the phone has no fix.
      branchLocation:
        e.branch.geofenceLat || e.branch.geofenceLng ? { lat: e.branch.geofenceLat, lng: e.branch.geofenceLng } : null,
    };
  });

  // The app's consent screen was agreed to — terms, privacy, and location used
  // for geofenced attendance and live tracking. The phone asks before anyone
  // signs in, then reports it here once there is a session, so HR can show who
  // agreed to which wording and when.
  app.post('/me/consent', { preHandler: authenticate }, async (req) => {
    if (req.user.role !== 'EMPLOYEE') throw AppError.forbidden('Only the employee app records consent');
    const { version, acceptedAt } = z
      .object({ version: z.number().int().min(1).max(1000), acceptedAt: z.string().datetime({ offset: true }).optional() })
      .parse(req.body);
    const e = await app.prisma.employee.findUnique({ where: { id: req.user.sub }, select: { consentVersion: true } });
    if (!e) throw AppError.notFound('Employee');
    // The same version again (a reinstall) keeps the first agreement's time.
    if (e.consentVersion != null && e.consentVersion >= version) return { consentVersion: e.consentVersion };
    // The phone's time of agreement, unless it is implausible — in the future,
    // or older than this app could have been showing the screen.
    const now = Date.now();
    const at = acceptedAt ? new Date(acceptedAt).getTime() : now;
    const consentAt = new Date(at > now || now - at > 90 * 86_400_000 ? now : at);
    await app.prisma.employee.update({ where: { id: req.user.sub }, data: { consentVersion: version, consentAt } });
    return { consentVersion: version, consentAt };
  });

  // Profile photo: the enrolled face photo when available, else the most recent
  // check-in selfie. Streams local files, redirects to a signed URL for S3 keys.
  app.get('/me/photo', { preHandler: authenticate }, async (req, reply) => {
    const e = await app.prisma.employee.findUnique({ where: { id: req.user.sub } });
    let src = e?.faceTemplateUrl ?? null;
    if (!src) {
      const att = await app.prisma.attendance.findFirst({
        where: { employeeId: req.user.sub, checkInSelfie: { not: null } },
        orderBy: { date: 'desc' },
      });
      src = att?.checkInSelfie ?? null;
    }
    if (!src) throw AppError.notFound('Photo');
    if (src.startsWith('/uploads/')) {
      const abs = resolveUploadPath(src);
      return reply.type('image/jpeg').send(await fs.readFile(abs));
    }
    return reply.redirect(await getSignedSelfieUrl(src));
  });
}
