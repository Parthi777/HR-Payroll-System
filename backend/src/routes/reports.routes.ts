import type { FastifyInstance, FastifyReply } from 'fastify';
import { z } from 'zod';
import { requireRole } from '../middleware/auth.js';
import { AppError } from '../utils/AppError.js';
import { classifyDay, overtimeMinutes, type DayCode } from '../services/attendance/day-classify.js';
import { buildPayrollReport } from '../services/reports/payroll-report.service.js';
import { buildMusterReport, type MusterEmployee } from '../services/reports/muster-report.service.js';
import {
  musterReportPdf,
  musterReportXlsx,
  payrollReportPdf,
  payrollReportXlsx,
  tablePdf,
  tableXlsx,
  type TableExport,
} from '../services/reports/report-export.service.js';
import { COMPANY_TZ, dayKey } from '../utils/time.js';

const fmtTime = (d: Date | null) =>
  d ? d.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', timeZone: COMPANY_TZ }) : null;

/** Grid code → the status word the daily report and the web chips speak. */
const DAILY_STATUS: Record<DayCode, string> = {
  P: 'PRESENT',
  HD: 'HALF_DAY',
  A: 'ABSENT',
  WO: 'WEEKLY_OFF',
  'WO*': 'WEEKLY_OFF_WORKED',
  HL: 'HOLIDAY',
  'HL*': 'HOLIDAY_WORKED',
  LV: 'ON_LEAVE',
  LOP: 'LOP',
  PN: 'PENDING',
  '': 'NOT_JOINED',
};

/** Attendance counts only when it never needed approval or was approved. */
const counted = (a: { approvalStatus: string | null }) =>
  a.approvalStatus == null || a.approvalStatus === 'APPROVED';

/**
 * "Who is present / absent today?" — the daily report can be narrowed to one
 * group. Filtering happens server-side so the Excel and PDF downloads contain
 * exactly the rows on screen; the summary counts always cover everyone.
 */
const dailyFilterSchema = z
  .enum(['all', 'present', 'absent', 'late', 'leave', 'pending', 'off'])
  .default('all');
type DailyFilter = z.infer<typeof dailyFilterSchema>;

const DAILY_FILTER: Record<Exclude<DailyFilter, 'all'>, (r: { code: DayCode; late: boolean }) => boolean> = {
  present: (r) => ['P', 'HD', 'WO*', 'HL*'].includes(r.code),
  absent: (r) => r.code === 'A',
  // A late arrival that lands in the midday window reads HALF_DAY but is still
  // a late punch for the discipline policy — the muster counts it the same way.
  late: (r) => r.late,
  leave: (r) => r.code === 'LV' || r.code === 'LOP',
  pending: (r) => r.code === 'PN',
  off: (r) => r.code === 'WO' || r.code === 'HL',
};

const DAILY_FILTER_LABEL: Record<DailyFilter, string> = {
  all: 'all employees',
  present: 'present only',
  absent: 'absent only',
  late: 'late arrivals only',
  leave: 'on leave only',
  pending: 'awaiting approval only',
  off: 'weekly off / holiday only',
};

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
    const { date, branchId, format, status: want } = z
      .object({
        date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
        branchId: z.string().optional(),
        format: formatSchema,
        status: dailyFilterSchema,
      })
      .parse(req.query);
    const dayStart = new Date(`${date}T00:00:00`);
    const dayEnd = new Date(dayStart);
    dayEnd.setDate(dayEnd.getDate() + 1);

    const [employees, atts, holidays, leaves] = await Promise.all([
      app.prisma.employee.findMany({
        where: { status: 'ACTIVE', ...(branchId ? { branchId } : {}) },
        include: { branch: { select: { name: true } }, shift: true },
        orderBy: { employeeCode: 'asc' },
      }),
      app.prisma.attendance.findMany({ where: { date: { gte: dayStart, lt: dayEnd } } }),
      app.prisma.holiday.findMany({ where: { date: { gte: dayStart, lt: dayEnd } } }),
      app.prisma.leave.findMany({
        where: { status: 'APPROVED', fromDate: { lt: dayEnd }, toDate: { gte: dayStart } },
      }),
    ]);
    const byEmp = new Map(atts.map((a) => [a.employeeId, a]));
    const holidaySet = new Set(holidays.map((h) => dayKey(h.date)));

    // Sundays, holidays, approved leave and not-yet-joined staff are not
    // absences — the same classifier the muster grid and payroll use decides.
    const rows = employees.map((e) => {
      const a = byEmp.get(e.id);
      const day = classifyDay({
        date: dayStart,
        att: a,
        shift: e.shift,
        leaves: leaves.filter((l) => l.employeeId === e.id),
        holidays: holidaySet,
        joiningDate: e.joiningDate,
      });
      const otMin = day.worked ? overtimeMinutes(a?.checkOut, e.shift) : 0;
      return {
        employeeCode: e.employeeCode,
        name: e.name,
        branch: e.branch.name,
        shift: e.shift.name,
        status: day.late && day.code === 'P' ? 'LATE' : DAILY_STATUS[day.code],
        code: day.code,
        late: day.late,
        checkIn: fmtTime(a?.checkIn ?? null),
        checkOut: fmtTime(a?.checkOut ?? null),
        workedHours: day.worked && a?.workingMinutes ? Math.round((a.workingMinutes / 60) * 10) / 10 : null,
        otHours: otMin ? Math.round((otMin / 60) * 10) / 10 : 0,
        stillIn: !!a?.checkIn && !a.checkOut, // on duty right now — no check-out yet
        geofence: a?.geofenceStatus ?? null,
        punchMode: a?.punchMode ?? null,
        flagged: a?.isFlagged ?? false,
      };
    });
    const count = (...codes: string[]) => rows.filter((r) => codes.includes(r.code)).length;
    // The cards always describe the whole workforce, whatever the table shows.
    const summary = {
      total: rows.length,
      present: count('P', 'HD', 'WO*', 'HL*'),
      late: rows.filter((r) => r.late).length,
      absent: count('A'),
      pending: count('PN'),
      leave: count('LV', 'LOP'),
      weeklyOff: count('WO', 'WO*', 'HL', 'HL*'),
      notJoined: count(''),
    };
    // The day's performance: hours on the floor, overtime and who is still in.
    const round1 = (n: number) => Math.round(n * 10) / 10;
    const performance = {
      workedHours: round1(rows.reduce((s, r) => s + (r.workedHours ?? 0), 0)),
      otHours: round1(rows.reduce((s, r) => s + r.otHours, 0)),
      avgHours: summary.present ? round1(rows.reduce((s, r) => s + (r.workedHours ?? 0), 0) / summary.present) : 0,
      onDuty: rows.filter((r) => r.stillIn).length,
      onTime: summary.present - summary.late,
      attendanceRate: summary.present + summary.absent
        ? Math.round((summary.present / (summary.present + summary.absent)) * 100)
        : 0,
    };
    const shown = want === 'all' ? rows : rows.filter(DAILY_FILTER[want]);

    return respondTable(
      reply,
      format,
      want === 'all' ? `daily-attendance-${date}` : `daily-attendance-${want}-${date}`,
      {
        title: 'Daily Attendance',
        subtitle:
          want === 'all'
            ? `${date} · ${rows.length} active employee(s)`
            : `${date} · ${DAILY_FILTER_LABEL[want]} · ${shown.length} of ${rows.length} employee(s)`,
        company: await company(),
        columns: [
          { header: 'Code', width: 12 },
          { header: 'Employee', width: 24 },
          { header: 'Branch', width: 16 },
          { header: 'Shift', width: 14 },
          { header: 'Status', width: 16 },
          { header: 'Check-In', width: 12, align: 'right' },
          { header: 'Check-Out', width: 12, align: 'right' },
          { header: 'Hours', width: 9, align: 'right' },
          { header: 'OT h', width: 9, align: 'right' },
          { header: 'Geofence', width: 12 },
          { header: 'Punch', width: 10 },
        ],
        rows: shown.map((r) => [
          r.employeeCode, r.name, r.branch, r.shift, r.status, r.checkIn, r.checkOut,
          r.workedHours, r.otHours || null, r.geofence, r.punchMode,
        ]),
        note:
          `Present ${summary.present} · Absent ${summary.absent} · Late ${summary.late} · On leave ${summary.leave} · ` +
          `Weekly off/holiday ${summary.weeklyOff}${summary.pending ? ` · Awaiting approval ${summary.pending}` : ''}.   ` +
          `Hours worked ${performance.workedHours} (avg ${performance.avgHours}/head) · OT ${performance.otHours} · ` +
          `attendance ${performance.attendanceRate}%${performance.onDuty ? ` · ${performance.onDuty} still on duty` : ''}.`,
      },
      { date, filter: want, summary, performance, rows: shown },
    );
  });

  // ── Monthly per-employee report (employee-wise + branch-wise) ──
  // Built on the muster grid so the summary numbers on this page and the
  // day-by-day performance grid can never disagree.
  app.get('/admin/reports/monthly', { preHandler: guard }, async (req, reply) => {
    const { month, year, branchId, format } = monthSchema.parse(req.query);
    const tag = `${year}-${String(month).padStart(2, '0')}`;

    const [muster, payslips] = await Promise.all([
      buildMusterReport(app.prisma, month, year, { branchId }),
      app.prisma.payslip.findMany({ where: { month, year } }),
    ]);
    const slipByEmp = new Map(payslips.map((p) => [p.employeeId, p]));

    const rows = [...muster.employees]
      .sort((a, b) => a.employeeCode.localeCompare(b.employeeCode))
      .map((e: MusterEmployee) => {
        const slip = slipByEmp.get(e.id);
        return {
          employeeCode: e.employeeCode,
          name: e.name,
          branch: e.branch,
          // Working days actually worked, a half day as 0.5. Late days are
          // present days too — broken out separately below, never subtracted.
          // Duty on a Sunday/holiday is reported in its own column, exactly as
          // the payroll sheet and the muster grid do it.
          presentDays: e.present,
          offDutyDays: e.sundayDuty + e.holidayDuty,
          lateDays: e.lateDays,
          halfDays: e.days.filter((d) => d.status === 'HD').length,
          absentDays: e.absent,
          pendingDays: e.pending,
          leaveDays: e.leave,
          lopDays: e.lop,
          weeklyOffDays: e.weeklyOff + e.holidays,
          workedHours: Math.round((e.workMinutes / 60) * 10) / 10,
          otHours: Math.round((e.otMinutes / 60) * 10) / 10,
          netSalary: slip?.netSalary ?? null,
          payslipStatus: slip?.status ?? null,
        };
      });

    // Branch-wise rollup of the same data.
    const branches = new Map<string, { branch: string; employees: number; presentDays: number; absentDays: number; lateDays: number; workedHours: number }>();
    for (const r of rows) {
      const b = branches.get(r.branch) ?? { branch: r.branch, employees: 0, presentDays: 0, absentDays: 0, lateDays: 0, workedHours: 0 };
      b.employees += 1;
      b.presentDays = Math.round((b.presentDays + r.presentDays) * 10) / 10;
      b.absentDays = Math.round((b.absentDays + r.absentDays) * 10) / 10;
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
          { header: 'Absent', width: 9, align: 'right' },
          { header: 'Leave', width: 8, align: 'right' },
          { header: 'W/Off', width: 8, align: 'right' },
          { header: 'Off Duty', width: 9, align: 'right' },
          { header: 'Worked h', width: 11, align: 'right' },
          { header: 'OT h', width: 9, align: 'right' },
          { header: 'Net Salary', width: 14, align: 'right' },
          { header: 'Slip', width: 11 },
        ],
        rows: rows.map((r) => [
          r.employeeCode, r.name, r.branch, r.presentDays, r.lateDays, r.halfDays,
          r.absentDays, r.leaveDays + r.lopDays, r.weeklyOffDays, r.offDutyDays,
          r.workedHours, r.otHours, r.netSalary, r.payslipStatus,
        ]),
        note: 'Present counts working days worked (half day = 0.5); late days are present days. Off Duty = Sundays/holidays worked, which stay paid weekly-offs and pay extra. Absent includes punches awaiting approval. Days before joining count as neither.',
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

    const tag = `${year}-${String(month).padStart(2, '0')}`;

    // Same builder as the muster grid, filtered to one employee — the day
    // statuses and the summary here match that report cell for cell.
    const muster = await buildMusterReport(app.prisma, month, year, { employeeId: id });
    const me = muster.employees[0];
    if (!me) throw AppError.notFound('Employee');

    const days = me.days.map((d) => ({
      day: d.day,
      weekday: ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].indexOf(d.weekday),
      status: d.late && d.status === 'P' ? 'LATE' : DAILY_STATUS[d.status],
      checkIn: d.inTime === '--:--' ? null : d.inTime,
      checkOut: d.outTime === '--:--' ? null : d.outTime,
      workedHours: d.workMinutes ? Math.round((d.workMinutes / 60) * 10) / 10 : null,
      punchMode: d.punchMode,
    }));
    const summary = {
      present: me.present,
      offDuty: me.sundayDuty + me.holidayDuty,
      late: me.lateDays,
      half: me.days.filter((d) => d.status === 'HD').length,
      absent: me.absent,
      pending: me.pending,
      leave: me.leave,
      lop: me.lop,
      off: me.weeklyOff + me.holidays,
      worked: me.workMinutes,
    };

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
