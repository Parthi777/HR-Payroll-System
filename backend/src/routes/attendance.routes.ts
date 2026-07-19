import type { FastifyInstance, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { promises as fs } from 'fs';
import path from 'path';
import { authenticate, requireRole } from '../middleware/auth.js';
import { AppError } from '../utils/AppError.js';
import { markCheckIn, markCheckOut, decideAttendanceApproval } from '../services/attendance/attendance.service.js';
import { getObjectBytes } from '../services/storage/storage.service.js';

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

// Format in company time — the server itself may run in UTC (Railway).
const COMPANY_TZ = process.env.COMPANY_TZ ?? 'Asia/Kolkata';
const fmtDate = (d: Date) =>
  d.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric', timeZone: COMPANY_TZ });
const fmtTime = (d: Date | null) =>
  d ? d.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', timeZone: COMPANY_TZ }) : null;

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
  // CASHIER included so the mobile admin landing tab works for cashier accounts.
  app.get(
    '/admin/dashboard/stats',
    { preHandler: requireRole('SUPER_ADMIN', 'HR_MANAGER', 'BRANCH_MANAGER', 'CASHIER') },
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

  // Employee: month-view calendar — one status per day (present/late/half/absent/
  // leave/off/pending), so staff can verify their own attendance and raise issues.
  app.get('/attendance/calendar', { preHandler: authenticate }, async (req) => {
    const { month, year } = z
      .object({ month: z.coerce.number().min(1).max(12), year: z.coerce.number() })
      .parse(req.query);
    const employeeId = req.user.sub;
    const start = new Date(year, month - 1, 1);
    const end = new Date(year, month, 1);
    const daysInMonth = new Date(year, month, 0).getDate();

    const [atts, leaves, holidays] = await Promise.all([
      app.prisma.attendance.findMany({ where: { employeeId, date: { gte: start, lt: end } } }),
      app.prisma.leave.findMany({
        where: { employeeId, status: 'APPROVED', fromDate: { lt: end }, toDate: { gte: start } },
      }),
      app.prisma.holiday.findMany({ where: { date: { gte: start, lt: end } } }),
    ]);
    const key = (d: Date) => `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
    const attByDay = new Map(atts.map((a) => [key(a.date), a]));
    const holidaySet = new Set(holidays.map((h) => key(h.date)));
    const now = new Date();

    const days = [];
    const summary = { present: 0, late: 0, half: 0, absent: 0, leave: 0 };
    for (let dn = 1; dn <= daysInMonth; dn++) {
      const d = new Date(year, month - 1, dn);
      const att = attByDay.get(key(d));
      const counted = att && att.checkIn && (att.approvalStatus == null || att.approvalStatus === 'APPROVED');
      const isOff = d.getDay() === 0 || holidaySet.has(key(d));
      let status: string;
      if (att?.approvalStatus === 'PENDING') {
        status = 'PENDING_APPROVAL';
      } else if (counted && (att!.status === 'PRESENT' || att!.status === 'LATE' || att!.status === 'HALF_DAY')) {
        status = att!.status;
        if (att!.status === 'PRESENT') summary.present += 1;
        else if (att!.status === 'LATE') { summary.late += 1; summary.present += 1; }
        else summary.half += 1;
      } else if (isOff) {
        status = 'OFF';
      } else if (
        leaves.some((lv) => lv.fromDate <= new Date(year, month - 1, dn, 23, 59, 59) && lv.toDate >= d)
      ) {
        status = 'LEAVE';
        summary.leave += 1;
      } else if (d > now) {
        status = 'FUTURE';
      } else {
        status = 'ABSENT';
        summary.absent += 1;
      }
      days.push({ day: dn, weekday: d.getDay(), status, checkIn: fmtTime(att?.checkIn ?? null), checkOut: fmtTime(att?.checkOut ?? null) });
    }
    return { month, year, days, summary };
  });

  // ── Out-of-geofence check-in approvals (HR / admin) ──
  const approvalGuard = requireRole('SUPER_ADMIN', 'HR_MANAGER', 'BRANCH_MANAGER');

  app.get('/admin/attendance/approvals', { preHandler: approvalGuard }, async (req) => {
    // Branch managers only see their own reports' pending check-ins.
    const where: { approvalStatus: string; employeeId?: { in: string[] } } = { approvalStatus: 'PENDING' };
    if (req.user.role === 'BRANCH_MANAGER') {
      const reports = await app.prisma.employee.findMany({
        where: { reportingManagerId: req.user.sub },
        select: { id: true },
      });
      where.employeeId = { in: reports.map((r) => r.id) };
    }
    const rows = await app.prisma.attendance.findMany({
      where,
      orderBy: { checkIn: 'desc' },
      include: { employee: { include: { branch: true } } },
    });
    return {
      approvals: rows.map((r) => ({
        id: r.id,
        name: r.employee.name,
        employeeCode: r.employee.employeeCode,
        branch: r.employee.branch.name,
        date: fmtDate(r.date),
        checkIn: fmtTime(r.checkIn),
        reason: r.flagReason,
        hasSelfie: !!r.checkInSelfie,
      })),
    };
  });

  app.patch('/admin/attendance/:id/approve', { preHandler: approvalGuard }, async (req) => {
    const { id } = req.params as { id: string };
    return { attendance: await decideAttendanceApproval(app.prisma, req.user.sub, id, true) };
  });

  app.patch('/admin/attendance/:id/reject', { preHandler: approvalGuard }, async (req) => {
    const { id } = req.params as { id: string };
    return { attendance: await decideAttendanceApproval(app.prisma, req.user.sub, id, false) };
  });

  // Check-in selfie (S3 signed redirect or local file) so HR can verify before approving.
  app.get('/admin/attendance/:id/selfie', { preHandler: approvalGuard }, async (req, reply) => {
    const { id } = req.params as { id: string };
    const att = await app.prisma.attendance.findUnique({ where: { id } });
    if (!att?.checkInSelfie) throw AppError.notFound('Selfie');
    if (att.checkInSelfie.startsWith('/uploads/')) {
      const abs = path.resolve(process.cwd(), att.checkInSelfie.replace(/^\//, ''));
      return reply.type('image/jpeg').send(await fs.readFile(abs));
    }
    // Stream through the API rather than redirecting to a signed S3 URL —
    // browser fetch() can't follow that redirect cross-origin (S3 has no CORS).
    return reply.type('image/jpeg').send(await getObjectBytes(att.checkInSelfie));
  });
}
