import type { FastifyInstance, FastifyRequest } from 'fastify';
import { authenticate, requireRole } from '../middleware/auth.js';
import { markCheckIn, markCheckOut } from '../services/attendance/attendance.service.js';

/** Parse the selfie file + lat/lng/accuracy fields from a multipart request (any part order). */
async function parseCheckinParts(req: FastifyRequest) {
  let selfie: Buffer | null = null;
  let lat = 0;
  let lng = 0;
  let accuracy: number | undefined;
  for await (const part of req.parts()) {
    if (part.type === 'file') {
      selfie = await part.toBuffer();
    } else if (part.fieldname === 'lat') {
      lat = parseFloat(String(part.value));
    } else if (part.fieldname === 'lng') {
      lng = parseFloat(String(part.value));
    } else if (part.fieldname === 'accuracy') {
      accuracy = parseFloat(String(part.value));
    }
  }
  return { selfie, lat, lng, accuracy };
}

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
  app.post('/attendance/checkin', { preHandler: authenticate }, async (req) => {
    const { selfie, lat, lng, accuracy } = await parseCheckinParts(req);
    // TODO: WhatsApp check-in confirmation via BullMQ queue.
    return markCheckIn(app.prisma, req.user.sub, selfie, lat, lng, accuracy);
  });

  app.post('/attendance/checkout', { preHandler: authenticate }, async (req) => {
    const { selfie, lat, lng } = await parseCheckinParts(req);
    // TODO: WhatsApp check-out summary via BullMQ queue.
    return markCheckOut(app.prisma, req.user.sub, selfie, lat, lng);
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

  // Per-employee performance/monitoring report for a month (admin, mobile + web).
  app.get(
    '/admin/reports/performance',
    { preHandler: requireRole('SUPER_ADMIN', 'HR_MANAGER', 'BRANCH_MANAGER') },
    async (req) => {
      const q = req.query as { month?: string; year?: string };
      const now = new Date();
      const month = q.month ? parseInt(q.month, 10) : now.getMonth() + 1; // 1-12
      const year = q.year ? parseInt(q.year, 10) : now.getFullYear();
      const start = new Date(year, month - 1, 1);
      const end = new Date(year, month, 1);

      const [employees, rows] = await Promise.all([
        app.prisma.employee.findMany({
          where: { status: 'ACTIVE' },
          include: { branch: true },
          orderBy: { name: 'asc' },
        }),
        app.prisma.attendance.findMany({ where: { date: { gte: start, lt: end } } }),
      ]);

      const byEmp = new Map<string, typeof rows>();
      for (const r of rows) {
        const list = byEmp.get(r.employeeId) ?? [];
        list.push(r);
        byEmp.set(r.employeeId, list);
      }

      return employees.map((e) => {
        const list = byEmp.get(e.id) ?? [];
        const present = list.filter((r) => r.status === 'PRESENT' || r.status === 'LATE').length;
        const late = list.filter((r) => r.status === 'LATE').length;
        const absent = list.filter((r) => r.status === 'ABSENT').length;
        const leave = list.filter((r) => r.status === 'ON_LEAVE').length;
        const flagged = list.filter((r) => r.isFlagged).length;
        const withCheckout = list.filter((r) => r.workingMinutes != null);
        const totalMin = withCheckout.reduce((s, r) => s + (r.workingMinutes ?? 0), 0);
        const avgHours = withCheckout.length
          ? Math.round((totalMin / withCheckout.length / 60) * 10) / 10
          : 0;
        const denom = present + absent;
        const attendanceRate = denom > 0 ? Math.round((present / denom) * 100) : 0;
        return {
          employeeId: e.id,
          employeeCode: e.employeeCode,
          name: e.name,
          branch: e.branch.name,
          presentDays: present,
          lateDays: late,
          absentDays: absent,
          leaveDays: leave,
          attendanceRate,
          avgHours,
          flaggedCount: flagged,
        };
      });
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
