import type { FastifyInstance } from 'fastify';
import { authenticate, requireRole } from '../middleware/auth.js';

/** Start/end of the current day (local) for "today" attendance queries. */
function todayRange() {
  const start = new Date();
  start.setHours(0, 0, 0, 0);
  const end = new Date(start);
  end.setDate(end.getDate() + 1);
  return { start, end };
}

const fmtDate = (d: Date) =>
  d.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' });
const fmtTime = (d: Date | null) =>
  d ? d.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' }) : null;

/** Map the stored AttendanceStatus to the display labels the clients expect. */
const displayStatus: Record<string, string> = {
  PRESENT: 'Present',
  LATE: 'Late',
  ABSENT: 'Absent',
  HALF_DAY: 'Half Day',
  ON_LEAVE: 'On Leave',
  HOLIDAY: 'Off Day',
};

/**
 * Attendance routes. Check-in/out accept multipart (selfie) + GPS coords.
 * TODO: wire check-in/out to AttendanceService (face match, geofence, WhatsApp trigger).
 */
export async function attendanceRoutes(app: FastifyInstance) {
  app.post('/attendance/checkin', { preHandler: authenticate }, async () => {
    // TODO: upload selfie -> Cloudinary, AWS Rekognition face match, geofence check, mark
    return { status: 'TODO', message: 'check-in not yet implemented' };
  });

  app.post('/attendance/checkout', { preHandler: authenticate }, async () => {
    // TODO: upload selfie, mark checkout, compute workingMinutes, WhatsApp summary
    return { status: 'TODO', message: 'check-out not yet implemented' };
  });

  app.get('/attendance/today', { preHandler: authenticate }, async (req) => {
    const { start, end } = todayRange();
    const today = await app.prisma.attendance.findFirst({
      where: { employeeId: req.user.sub, date: { gte: start, lt: end } },
    });
    return today ?? { employeeId: req.user.sub, today: null };
  });

  // Flat array (matches the Android AttendanceHistoryDto[] contract).
  app.get('/attendance/history', { preHandler: authenticate }, async (req) => {
    const records = await app.prisma.attendance.findMany({
      where: { employeeId: req.user.sub },
      orderBy: { date: 'desc' },
      take: 30,
    });
    return records.map((r) => ({
      id: r.id,
      date: fmtDate(r.date),
      checkIn: fmtTime(r.checkIn),
      checkOut: fmtTime(r.checkOut),
      status: displayStatus[r.status] ?? r.status,
    }));
  });

  // Admin — flat array (matches the web LiveAttendanceRow[] contract).
  app.get(
    '/admin/attendance/live',
    { preHandler: requireRole('SUPER_ADMIN', 'HR_MANAGER', 'BRANCH_MANAGER') },
    async () => {
      const { start, end } = todayRange();
      const rows = await app.prisma.attendance.findMany({
        where: { date: { gte: start, lt: end } },
        orderBy: { checkIn: 'desc' },
        include: { employee: { include: { branch: true } } },
      });
      return rows.map((r) => ({
        id: r.id,
        name: r.employee.name,
        branch: r.employee.branch.name,
        checkIn: fmtTime(r.checkIn),
        checkOut: fmtTime(r.checkOut),
        status: displayStatus[r.status] ?? r.status,
      }));
    },
  );

  // Dashboard overview cards (matches the web DashboardStats contract).
  app.get(
    '/admin/dashboard/stats',
    { preHandler: requireRole('SUPER_ADMIN', 'HR_MANAGER', 'BRANCH_MANAGER') },
    async () => {
      const { start, end } = todayRange();
      const where = { date: { gte: start, lt: end } };

      const [totalStaff, branches, todays, lateArrivals, onLeave, pendingApprovals] = await Promise.all([
        app.prisma.employee.count({ where: { status: 'ACTIVE' } }),
        app.prisma.branch.count(),
        app.prisma.attendance.findMany({ where }),
        app.prisma.attendance.count({ where: { ...where, status: 'LATE' } }),
        app.prisma.attendance.count({ where: { ...where, status: 'ON_LEAVE' } }),
        app.prisma.leave.count({ where: { status: 'PENDING' } }),
      ]);

      const checkedIn = todays.filter((a) => a.checkIn).length;
      const presentNow = todays.filter((a) => a.checkIn && !a.checkOut).length;
      const absent = Math.max(totalStaff - checkedIn - onLeave, 0);
      const attendanceRate = totalStaff > 0 ? Math.round((checkedIn / totalStaff) * 100) : 0;

      return {
        presentNow,
        absent,
        lateArrivals,
        onLeave,
        pendingApprovals,
        totalStaff,
        branches,
        checkedIn,
        attendanceRate,
      };
    },
  );

  app.patch(
    '/admin/attendance/:id/override',
    { preHandler: requireRole('SUPER_ADMIN', 'HR_MANAGER') },
    async (req) => {
      const { id } = req.params as { id: string };
      return { id, overridden: true };
    },
  );
}
