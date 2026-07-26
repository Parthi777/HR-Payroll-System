import type { FastifyInstance, FastifyReply } from 'fastify';
import { z } from 'zod';
import { requireRole } from '../middleware/auth.js';
import { AppError } from '../utils/AppError.js';
import { effectiveStatus } from '../services/attendance/attendance-policy.js';
import { buildPayrollReport } from '../services/reports/payroll-report.service.js';
import { buildMusterReport } from '../services/reports/muster-report.service.js';
import {
  musterReportPdf,
  musterReportXlsx,
  payrollReportPdf,
  payrollReportXlsx,
  tablePdf,
  tableXlsx,
  type TableExport,
} from '../services/reports/report-export.service.js';
import { COMPANY_TZ } from '../utils/time.js';

const fmtTime = (d: Date | null) =>
  d ? d.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', timeZone: COMPANY_TZ }) : null;

/** Attendance counts only when it never needed approval or was approved. */
const counted = (a: { approvalStatus: string | null }) =>
  a.approvalStatus == null || a.approvalStatus === 'APPROVED';

const formatSchema = z.enum(['json', 'xlsx', 'pdf']).default('json');
const monthSchema = z.object({
  month: z.coerce.number().min(1).max(12),
  year: z.coerce.number(),
  branchId: z.string().optional(),
  format: formatSchema,
});

const CONTENT_TYPE = {
  xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  pdf: 'application/pdf',
} as const;

/** Stream a generated report file back as a download. */
function sendFile(reply: FastifyReply, buf: Buffer, filename: string, format: 'xlsx' | 'pdf') {
  reply.header('Content-Type', CONTENT_TYPE[format]);
  reply.header('Content-Disposition', `attachment; filename="${filename}.${format}"`);
  return reply.send(buf);
}

/** Render a simple report as json / xlsx / pdf from one table definition. */
async function respondTable(
  reply: FastifyReply,
  format: 'json' | 'xlsx' | 'pdf',
  filename: string,
  table: TableExport,
  json: unknown,
) {
  if (format === 'json') return json;
  const buf = format === 'xlsx' ? await tableXlsx(table) : await tablePdf(table);
  return sendFile(reply, buf, filename, format);
}

/**
 * Reporting endpoints for the web Reports page. Every report answers in JSON by
 * default and can render itself as .xlsx or .pdf with `?format=`:
 *  - daily:               every employee's status/times for one date
 *  - monthly:             per-employee aggregates for a month (+ branch rollup)
 *  - payroll-summary:     the owner's salary sheet (days, OT, deductions, payable)
 *  - monthly-performance: the day-by-day muster grid (IN/OUT/WORK/OT/Status)
 *  - late:                late-punch detail (dates + counts) for a month
 *
 * Inactive employees are excluded from every report.
 */
export async function reportsRoutes(app: FastifyInstance) {
  const guard = requireRole('SUPER_ADMIN', 'HR_MANAGER', 'BRANCH_MANAGER', 'PAYROLL_ADMIN');

  const company = async () => {
    const c = await app.prisma.companySettings.findUnique({ where: { id: 'company' } });
    return { name: c?.name || process.env.COMPANY_NAME || 'AI HR Payroll', address: c?.address ?? '' };
  };

  // ── Daily attendance report ──
  app.get('/admin/reports/daily', { preHandler: guard }, async (req, reply) => {
    const { date, branchId, format } = z
      .object({
        date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
        branchId: z.string().optional(),
        format: formatSchema,
      })
      .parse(req.query);
    const dayStart = new Date(`${date}T00:00:00`);
    const dayEnd = new Date(dayStart);
    dayEnd.setDate(dayEnd.getDate() + 1);

    const employees = await app.prisma.employee.findMany({
      where: { status: 'ACTIVE', ...(branchId ? { branchId } : {}) },
      include: { branch: { select: { name: true } }, shift: true },
      orderBy: { employeeCode: 'asc' },
    });
    const atts = await app.prisma.attendance.findMany({
      where: { date: { gte: dayStart, lt: dayEnd } },
    });
    const byEmp = new Map(atts.map((a) => [a.employeeId, a]));

    const rows = employees.map((e) => {
      const a = byEmp.get(e.id);
      const status = a ? effectiveStatus(a, e.shift) : 'ABSENT';
      return {
        employeeCode: e.employeeCode,
        name: e.name,
        branch: e.branch.name,
        status: a ? (counted(a) ? status : `${status} (awaiting approval)`) : 'ABSENT',
        checkIn: fmtTime(a?.checkIn ?? null),
        checkOut: fmtTime(a?.checkOut ?? null),
        workedHours: a?.workingMinutes ? Math.round((a.workingMinutes / 60) * 10) / 10 : null,
        geofence: a?.geofenceStatus ?? null,
        punchMode: a?.punchMode ?? null,
        flagged: a?.isFlagged ?? false,
      };
    });
    const summary = {
      total: rows.length,
      present: rows.filter((r) => r.status === 'PRESENT' || r.status === 'LATE' || r.status === 'HALF_DAY').length,
      late: rows.filter((r) => r.status === 'LATE').length,
      absent: rows.filter((r) => r.status === 'ABSENT').length,
    };

    return respondTable(
      reply,
      format,
      `daily-attendance-${date}`,
      {
        title: 'Daily Attendance',
        subtitle: `${date} · ${rows.length} active employee(s)`,
        company: await company(),
        columns: [
          { header: 'Code', width: 12 },
          { header: 'Employee', width: 24 },
          { header: 'Branch', width: 18 },
          { header: 'Status', width: 16 },
          { header: 'Check-In', width: 12, align: 'right' },
          { header: 'Check-Out', width: 12, align: 'right' },
          { header: 'Hours', width: 9, align: 'right' },
          { header: 'Geofence', width: 12 },
          { header: 'Punch', width: 10 },
        ],
        rows: rows.map((r) => [
          r.employeeCode, r.name, r.branch, r.status, r.checkIn, r.checkOut, r.workedHours, r.geofence, r.punchMode,
        ]),
      },
      { date, summary, rows },
    );
  });

  // ── Monthly per-employee report (employee-wise + branch-wise) ──
  app.get('/admin/reports/monthly', { preHandler: guard }, async (req, reply) => {
    const { month, year, branchId, format } = monthSchema.parse(req.query);
    const start = new Date(year, month - 1, 1);
    const end = new Date(year, month, 1);
    const tag = `${year}-${String(month).padStart(2, '0')}`;

    const employees = await app.prisma.employee.findMany({
      where: { status: 'ACTIVE', ...(branchId ? { branchId } : {}) },
      include: { branch: { select: { name: true } }, shift: true },
      orderBy: { employeeCode: 'asc' },
    });
    const atts = await app.prisma.attendance.findMany({ where: { date: { gte: start, lt: end } } });
    const payslips = await app.prisma.payslip.findMany({ where: { month, year } });
    const slipByEmp = new Map(payslips.map((p) => [p.employeeId, p]));

    const rows = employees.map((e) => {
      const mine = atts.filter((a) => a.employeeId === e.id && counted(a) && a.checkIn);
      const statuses = mine.map((a) => effectiveStatus(a, e.shift));
      const workedMin = mine.reduce((s, a) => s + (a.workingMinutes ?? 0), 0);
      const slip = slipByEmp.get(e.id);
      return {
        employeeCode: e.employeeCode,
        name: e.name,
        branch: e.branch.name,
        presentDays: statuses.filter((s) => s === 'PRESENT').length,
        lateDays: statuses.filter((s) => s === 'LATE').length,
        halfDays: statuses.filter((s) => s === 'HALF_DAY').length,
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
      b.presentDays += r.presentDays + r.lateDays + r.halfDays * 0.5;
      b.lateDays += r.lateDays;
      b.workedHours = Math.round((b.workedHours + r.workedHours) * 10) / 10;
      branches.set(r.branch, b);
    }

    return respondTable(
      reply,
      format,
      `monthly-attendance-${tag}`,
      {
        title: 'Monthly Attendance',
        subtitle: `${tag} · ${rows.length} active employee(s)`,
        company: await company(),
        columns: [
          { header: 'Code', width: 12 },
          { header: 'Employee', width: 24 },
          { header: 'Branch', width: 18 },
          { header: 'Present', width: 10, align: 'right' },
          { header: 'Late', width: 8, align: 'right' },
          { header: 'Half', width: 8, align: 'right' },
          { header: 'Worked h', width: 11, align: 'right' },
          { header: 'OT h', width: 9, align: 'right' },
          { header: 'Net Salary', width: 14, align: 'right' },
          { header: 'Slip', width: 11 },
        ],
        rows: rows.map((r) => [
          r.employeeCode, r.name, r.branch, r.presentDays, r.lateDays, r.halfDays,
          r.workedHours, r.otHours, r.netSalary, r.payslipStatus,
        ]),
      },
      { month, year, rows, branches: [...branches.values()] },
    );
  });

  // ── Payroll summary: the owner's salary sheet for the month ──
  app.get('/admin/reports/payroll-summary', { preHandler: guard }, async (req, reply) => {
    const { month, year, branchId, format } = monthSchema.parse(req.query);
    const report = await buildPayrollReport(app.prisma, month, year, { branchId });
    const filename = `payroll-summary-${year}-${String(month).padStart(2, '0')}`;
    if (format === 'json') return report;
    const buf = format === 'xlsx' ? await payrollReportXlsx(report) : await payrollReportPdf(report);
    return sendFile(reply, buf, filename, format);
  });

  // ── Monthly performance: the day-by-day muster grid ──
  app.get('/admin/reports/monthly-performance', { preHandler: guard }, async (req, reply) => {
    const { month, year, branchId, format, employeeId } = monthSchema
      .extend({ employeeId: z.string().optional() })
      .parse(req.query);
    const report = await buildMusterReport(app.prisma, month, year, { branchId, employeeId });
    const filename = `monthly-performance-${year}-${String(month).padStart(2, '0')}`;
    if (format === 'json') return report;
    const buf = format === 'xlsx' ? await musterReportXlsx(report) : await musterReportPdf(report);
    return sendFile(reply, buf, filename, format);
  });

  // ── Per-employee monthly report: day-by-day attendance for one employee ──
  app.get('/admin/reports/employee/:id', { preHandler: guard }, async (req, reply) => {
    const { id } = req.params as { id: string };
    const { month, year, format } = z
      .object({ month: z.coerce.number().min(1).max(12), year: z.coerce.number(), format: formatSchema })
      .parse(req.query);
    const employee = await app.prisma.employee.findUnique({
      where: { id },
      include: { branch: { select: { name: true } }, shift: true },
    });
    if (!employee) throw AppError.notFound('Employee');
    if (employee.status !== 'ACTIVE') throw new AppError('Reports cover active employees only', 400);

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
    const tag = `${year}-${String(month).padStart(2, '0')}`;

    const days = [];
    const summary = { present: 0, late: 0, half: 0, absent: 0, off: 0, worked: 0 };
    for (let dn = 1; dn <= daysInMonth; dn++) {
      const d = new Date(year, month - 1, dn);
      const a = byDay.get(key(d));
      const isCounted = a && a.checkIn && (a.approvalStatus == null || a.approvalStatus === 'APPROVED');
      const isOff = d.getDay() === 0 || holidaySet.has(key(d));
      const derived = a ? effectiveStatus(a, employee.shift) : null;
      let status = 'ABSENT';
      if (a?.approvalStatus === 'PENDING') status = 'PENDING';
      else if (isCounted && (derived === 'PRESENT' || derived === 'LATE' || derived === 'HALF_DAY')) status = derived!;
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
        punchMode: a?.punchMode ?? null,
      });
    }

    return respondTable(
      reply,
      format,
      `employee-${employee.employeeCode}-${tag}`,
      {
        title: `${employee.name} (${employee.employeeCode}) — Attendance`,
        subtitle: `${tag} · ${employee.branch.name} · ${employee.shift.name}`,
        company: await company(),
        columns: [
          { header: 'Date', width: 14 },
          { header: 'Day', width: 8 },
          { header: 'Status', width: 12 },
          { header: 'Check-In', width: 12, align: 'right' },
          { header: 'Check-Out', width: 12, align: 'right' },
          { header: 'Hours', width: 9, align: 'right' },
          { header: 'Punch', width: 10 },
        ],
        rows: days.map((d) => [
          `${tag}-${String(d.day).padStart(2, '0')}`,
          ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'][d.weekday],
          d.status, d.checkIn, d.checkOut, d.workedHours, d.punchMode,
        ]),
      },
      {
        employee: {
          name: employee.name, employeeCode: employee.employeeCode,
          branch: employee.branch.name, shift: employee.shift.name,
        },
        month, year, days,
        summary: { ...summary, workedHours: Math.round((summary.worked / 60) * 10) / 10 },
      },
    );
  });

  // ── Late-punch report: who was late, when, how often ──
  app.get('/admin/reports/late', { preHandler: guard }, async (req, reply) => {
    const { month, year, branchId, format } = monthSchema.parse(req.query);
    const start = new Date(year, month - 1, 1);
    const end = new Date(year, month, 1);
    const tag = `${year}-${String(month).padStart(2, '0')}`;

    const lates = await app.prisma.attendance.findMany({
      where: {
        date: { gte: start, lt: end },
        status: 'LATE',
        // Inactive employees never appear in a report.
        employee: { status: 'ACTIVE', ...(branchId ? { branchId } : {}) },
      },
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

    return respondTable(
      reply,
      format,
      `late-punches-${tag}`,
      {
        title: 'Late Punches',
        subtitle: `${tag} · ${rows.length} employee(s) with late arrivals`,
        company: await company(),
        columns: [
          { header: 'Code', width: 12 },
          { header: 'Employee', width: 24 },
          { header: 'Branch', width: 18 },
          { header: 'Late Days', width: 10, align: 'right' },
          { header: 'Dates (check-in time)', width: 60 },
        ],
        rows: rows.map((r) => [
          r.employeeCode, r.name, r.branch, r.count,
          r.dates.map((d, i) => `${d.slice(8)}${r.checkIns[i] ? ` (${r.checkIns[i]})` : ''}`).join(', '),
        ]),
        note: 'Pay date moves to the 8th at 5 or more late punches; more than 8 withholds the payslip until HR releases it.',
      },
      { month, year, rows },
    );
  });
}
