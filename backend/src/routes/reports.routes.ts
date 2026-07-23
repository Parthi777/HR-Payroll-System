import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { requireRole } from '../middleware/auth.js';

const COMPANY_TZ = process.env.COMPANY_TZ ?? 'Asia/Kolkata';
const fmtTime = (d: Date | null) =>
  d ? d.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', timeZone: COMPANY_TZ }) : null;

/** Attendance counts only when it never needed approval or was approved. */
const counted = (a: { approvalStatus: string | null }) =>
  a.approvalStatus == null || a.approvalStatus === 'APPROVED';

/**
 * Reporting endpoints for the web Reports page:
 *  - daily:   every employee's status/times for one date
 *  - monthly: per-employee aggregates for a month (also groupable by branch)
 *  - late:    late-punch detail (dates + counts) for a month
 */
export async function reportsRoutes(app: FastifyInstance) {
  const guard = requireRole('SUPER_ADMIN', 'HR_MANAGER', 'BRANCH_MANAGER', 'PAYROLL_ADMIN');

  // ── Daily attendance report ──
  app.get('/admin/reports/daily', { preHandler: guard }, async (req) => {
    const { date } = z.object({ date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/) }).parse(req.query);
    const dayStart = new Date(`${date}T00:00:00`);
    const dayEnd = new Date(dayStart);
    dayEnd.setDate(dayEnd.getDate() + 1);

    const employees = await app.prisma.employee.findMany({
      where: { status: 'ACTIVE' },
      include: { branch: { select: { name: true } } },
      orderBy: { employeeCode: 'asc' },
    });
    const atts = await app.prisma.attendance.findMany({
      where: { date: { gte: dayStart, lt: dayEnd } },
    });
    const byEmp = new Map(atts.map((a) => [a.employeeId, a]));

    const rows = employees.map((e) => {
      const a = byEmp.get(e.id);
      return {
        employeeCode: e.employeeCode,
        name: e.name,
        branch: e.branch.name,
        status: a ? (counted(a) ? a.status : `${a.status} (awaiting approval)`) : 'ABSENT',
        checkIn: fmtTime(a?.checkIn ?? null),
        checkOut: fmtTime(a?.checkOut ?? null),
        workedHours: a?.workingMinutes ? Math.round((a.workingMinutes / 60) * 10) / 10 : null,
        geofence: a?.geofenceStatus ?? null,
        flagged: a?.isFlagged ?? false,
      };
    });
    const present = rows.filter((r) => r.status === 'PRESENT' || r.status === 'LATE' || r.status === 'HALF_DAY').length;
    return { date, summary: { total: rows.length, present, late: rows.filter((r) => r.status === 'LATE').length, absent: rows.filter((r) => r.status === 'ABSENT').length }, rows };
  });

  // ── Monthly per-employee report (employee-wise + branch-wise) ──
  app.get('/admin/reports/monthly', { preHandler: guard }, async (req) => {
    const { month, year } = z
      .object({ month: z.coerce.number().min(1).max(12), year: z.coerce.number() })
      .parse(req.query);
    const start = new Date(year, month - 1, 1);
    const end = new Date(year, month, 1);

    const employees = await app.prisma.employee.findMany({
      where: { status: 'ACTIVE' },
      include: { branch: { select: { name: true } } },
      orderBy: { employeeCode: 'asc' },
    });
    const atts = await app.prisma.attendance.findMany({ where: { date: { gte: start, lt: end } } });
    const payslips = await app.prisma.payslip.findMany({ where: { month, year } });
    const slipByEmp = new Map(payslips.map((p) => [p.employeeId, p]));

    const rows = employees.map((e) => {
      const mine = atts.filter((a) => a.employeeId === e.id && counted(a) && a.checkIn);
      const workedMin = mine.reduce((s, a) => s + (a.workingMinutes ?? 0), 0);
      const slip = slipByEmp.get(e.id);
      return {
        employeeCode: e.employeeCode,
        name: e.name,
        branch: e.branch.name,
        presentDays: mine.filter((a) => a.status === 'PRESENT').length,
        lateDays: mine.filter((a) => a.status === 'LATE').length,
        halfDays: mine.filter((a) => a.status === 'HALF_DAY').length,
        workedHours: Math.round((workedMin / 60) * 10) / 10,
        otHours: slip?.otHours ?? null,
        netSalary: slip?.netSalary ?? null,
        payslipStatus: slip?.status ?? null,
      };
    });

    // Branch-wise rollup of the same data.
    const branches = new Map<string, { branch: string; employees: number; presentDays: number; lateDays: number; workedHours: number }>();
    for (const r of rows) {
      const b = branches.get(r.branch) ?? { branch: r.branch, employees: 0, presentDays: 0, lateDays: 0, workedHours: 0 };
      b.employees += 1;
      b.presentDays += r.presentDays + r.lateDays + r.halfDays;
      b.lateDays += r.lateDays;
      b.workedHours = Math.round((b.workedHours + r.workedHours) * 10) / 10;
      branches.set(r.branch, b);
    }
    return { month, year, rows, branches: [...branches.values()] };
  });

  // ── Per-employee monthly report: day-by-day attendance for one employee ──
  app.get('/admin/reports/employee/:id', { preHandler: guard }, async (req) => {
    const { id } = req.params as { id: string };
    const { month, year } = z
      .object({ month: z.coerce.number().min(1).max(12), year: z.coerce.number() })
      .parse(req.query);
    const employee = await app.prisma.employee.findUnique({
      where: { id },
      include: { branch: { select: { name: true } }, shift: { select: { name: true } } },
    });
    if (!employee) throw new Error('Employee not found');

    const start = new Date(year, month - 1, 1);
    const end = new Date(year, month, 1);
    const daysInMonth = new Date(year, month, 0).getDate();
    const [atts, holidays] = await Promise.all([
      app.prisma.attendance.findMany({ where: { employeeId: id, date: { gte: start, lt: end } } }),
      app.prisma.holiday.findMany({ where: { date: { gte: start, lt: end } } }),
    ]);
    const key = (d: Date) => `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
    const byDay = new Map(atts.map((a) => [key(a.date), a]));
    const holidaySet = new Set(holidays.map((h) => key(h.date)));
    const now = new Date();

    const days = [];
    const summary = { present: 0, late: 0, half: 0, absent: 0, off: 0, worked: 0 };
    for (let dn = 1; dn <= daysInMonth; dn++) {
      const d = new Date(year, month - 1, dn);
      const a = byDay.get(key(d));
      const counted = a && a.checkIn && (a.approvalStatus == null || a.approvalStatus === 'APPROVED');
      const isOff = d.getDay() === 0 || holidaySet.has(key(d));
      let status = 'ABSENT';
      if (a?.approvalStatus === 'PENDING') status = 'PENDING';
      else if (counted && (a!.status === 'PRESENT' || a!.status === 'LATE' || a!.status === 'HALF_DAY')) status = a!.status;
      else if (isOff) status = 'OFF';
      else if (d > now) status = 'FUTURE';
      if (status === 'PRESENT') summary.present += 1;
      else if (status === 'LATE') { summary.late += 1; summary.present += 1; }
      else if (status === 'HALF_DAY') summary.half += 1;
      else if (status === 'OFF') summary.off += 1;
      else if (status === 'ABSENT') summary.absent += 1;
      if (a?.workingMinutes) summary.worked += a.workingMinutes;
      days.push({
        day: dn, weekday: d.getDay(), status,
        checkIn: fmtTime(a?.checkIn ?? null), checkOut: fmtTime(a?.checkOut ?? null),
        workedHours: a?.workingMinutes ? Math.round((a.workingMinutes / 60) * 10) / 10 : null,
      });
    }
    return {
      employee: { name: employee.name, employeeCode: employee.employeeCode, branch: employee.branch.name, shift: employee.shift.name },
      month, year, days,
      summary: { ...summary, workedHours: Math.round((summary.worked / 60) * 10) / 10 },
    };
  });

  // ── Late-punch report: who was late, when, how often ──
  app.get('/admin/reports/late', { preHandler: guard }, async (req) => {
    const { month, year } = z
      .object({ month: z.coerce.number().min(1).max(12), year: z.coerce.number() })
      .parse(req.query);
    const start = new Date(year, month - 1, 1);
    const end = new Date(year, month, 1);

    const lates = await app.prisma.attendance.findMany({
      where: { date: { gte: start, lt: end }, status: 'LATE' },
      include: { employee: { select: { name: true, employeeCode: true, branch: { select: { name: true } } } } },
      orderBy: { date: 'asc' },
    });

    const byEmp = new Map<string, { employeeCode: string; name: string; branch: string; dates: string[]; checkIns: (string | null)[] }>();
    for (const a of lates) {
      if (!counted(a)) continue;
      const key = a.employee.employeeCode;
      const e = byEmp.get(key) ?? { employeeCode: key, name: a.employee.name, branch: a.employee.branch.name, dates: [], checkIns: [] };
      e.dates.push(a.date.toISOString().slice(0, 10));
      e.checkIns.push(fmtTime(a.checkIn));
      byEmp.set(key, e);
    }
    const rows = [...byEmp.values()]
      .map((e) => ({ ...e, count: e.dates.length }))
      .sort((a, b) => b.count - a.count);
    return { month, year, rows };
  });
}
