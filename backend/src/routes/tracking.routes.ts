import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { assertManages, authenticate, requireRole } from '../middleware/auth.js';
import { AppError } from '../utils/AppError.js';
import {
  MAX_BATCH_EVENTS,
  MAX_BATCH_POINTS,
  TRACK_EVENT_KINDS,
  currentTracking,
  ingestTrack,
  liveTracking,
  trackDetail,
  watchableWhere,
} from '../services/tracking/tracking.service.js';

const gpsBatchSchema = z.object({
  attendanceId: z.string().min(1),
  points: z
    .array(
      z.object({
        ts: z.string().datetime({ offset: true }),
        lat: z.number().min(-90).max(90),
        lng: z.number().min(-180).max(180),
        accuracy: z.number().min(0).max(100_000).nullish(),
        mock: z.boolean().optional(),
      }),
    )
    .max(MAX_BATCH_POINTS),
  events: z
    .array(z.object({ ts: z.string().datetime({ offset: true }), kind: z.enum(TRACK_EVENT_KINDS) }))
    .max(MAX_BATCH_EVENTS)
    .optional(),
});

/** Only an employee's own phone uploads a track or asks whether to keep one. */
function requireEmployee(role: string) {
  if (role !== 'EMPLOYEE') throw AppError.forbidden('Only the employee app records location');
}

/**
 * Live tracking. The phone uploads fixes between check-in and check-out; the
 * Live Tracking page reads where everyone is. See docs/LIVE-TRACKING.md.
 *
 * The admin side is for the roles that watch attendance — not PAYROLL_ADMIN,
 * whose job does not need to know where anyone is standing.
 */
export async function trackingRoutes(app: FastifyInstance) {
  const watchers = requireRole('SUPER_ADMIN', 'HR_MANAGER', 'BRANCH_MANAGER');

  // A two-minute interval means one batch every two minutes per phone; the
  // ceiling is for a phone draining an offline backlog, keyed per IP because
  // the limiter runs before authentication.
  app.post(
    '/attendance/gps-log',
    { preHandler: authenticate, config: { rateLimit: { max: 60, timeWindow: '1 minute' } } },
    async (req) => {
      requireEmployee(req.user.role);
      const body = gpsBatchSchema.parse(req.body);
      return ingestTrack(app.prisma, req.user.sub, body);
    },
  );

  app.get('/attendance/tracking', { preHandler: authenticate }, async (req) => {
    requireEmployee(req.user.role);
    return currentTracking(app.prisma, req.user.sub);
  });

  app.get('/admin/tracking/live', { preHandler: watchers }, async (req) => {
    const { branchId } = z.object({ branchId: z.string().optional() }).parse(req.query);
    return liveTracking(app.prisma, { branchId, watchable: watchableWhere(req.user) });
  });

  app.get('/admin/tracking/:attendanceId/track', { preHandler: watchers }, async (req) => {
    const { attendanceId } = z.object({ attendanceId: z.string().min(1) }).parse(req.params);
    const att = await app.prisma.attendance.findUnique({ where: { id: attendanceId }, select: { employeeId: true } });
    if (!att) throw AppError.notFound('Tracked attendance');
    await assertManages(app.prisma, req.user, att.employeeId);
    return trackDetail(app.prisma, attendanceId);
  });
}
