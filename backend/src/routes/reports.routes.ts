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
