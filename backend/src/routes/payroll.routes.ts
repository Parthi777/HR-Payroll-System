import type { FastifyInstance, FastifyReply } from 'fastify';
import { z } from 'zod';
import { authenticate, requireRole } from '../middleware/auth.js';
import { AppError } from '../utils/AppError.js';
import {
  runMonthlyPayroll,
  computeMonthlyPayroll,
  monthHolidaySet,
  loadPayrollMonth,
} from '../services/payroll/payroll-run.service.js';
import { getTenantPolicy } from '../services/settings/tenant-settings.service.js';
import { generatePayslipPdf } from '../services/payroll/payslip-pdf.service.js';
import { generateSalaryRegisterPdf } from '../services/payroll/salary-register-pdf.service.js';
import { getCompanyProfile } from '../services/settings/tenant-settings.service.js';
import { buildBankFile, bankFileCsv } from '../services/payroll/bank-file.service.js';

const round2 = (n: number) => Math.round(n * 100) / 100;
import { recordAudit } from '../services/audit/audit.service.js';

/** Company profile for PDF headers (empty object when unset). */
async function getCompany(app: FastifyInstance): Promise<{ name: string; address: string }> {
  return getCompanyProfile(app.prisma);
}

/** Fetch a payslip (with employee+branch) and stream it as a PDF. */
async function streamPayslipPdf(app: FastifyInstance, reply: FastifyReply, id: string) {
  const payslip = await app.prisma.payslip.findUnique({
    where: { id },
    include: { employee: { include: { branch: true } } },
  });
  if (!payslip) throw AppError.notFound('Payslip');
  const pdf = await generatePayslipPdf({ ...payslip, company: await getCompany(app) });
  reply.header('Content-Type', 'application/pdf');
  reply.header('Content-Disposition', `inline; filename="payslip-${payslip.month}-${payslip.year}.pdf"`);
  return reply.send(pdf);
}

const runSchema = z.object({ month: z.number().int().min(1).max(12), year: z.number().int() });

export async function payrollRoutes(app: FastifyInstance) {
  app.post('/admin/payroll/run', { preHandler: requireRole('SUPER_ADMIN', 'PAYROLL_ADMIN') }, async (req) => {
    const { month, year } = runSchema.parse(req.body);
    // Synchronous run for now. TODO: enqueue via BullMQ for large companies.
    const summary = await runMonthlyPayroll(app.prisma, month, year);
    // A payroll run rewrites the month's payslips. Recording the totals means a
    // later re-run can be told apart from the first one, and by whom.
    await recordAudit(req, 'PAYROLL_RUN', 'Payroll', {
      metadata: { month, year, employees: summary.employees, totalNet: summary.totalNet },
    });
    return summary;
  });

  // Admin: list all payslips for a month with employee names (web Payroll page).
  app.get('/admin/payroll/payslips/:month/:year', { preHandler: requireRole('SUPER_ADMIN', 'PAYROLL_ADMIN', 'HR_MANAGER') }, async (req) => {
    const { month, year } = req.params as { month: string; year: string };
    const payslips = await app.prisma.payslip.findMany({
      // Reports and registers cover active employees only.
      where: { month: Number(month), year: Number(year), employee: { status: 'ACTIVE' } },
      include: { employee: { select: { name: true, employeeCode: true } } },
      orderBy: { netSalary: 'desc' },
    });
    return { payslips };
  });

  // Full-month salary register PDF (all employees, earnings + deductions + OT + totals).
  app.get('/admin/payroll/register/:month/:year/pdf', { preHandler: requireRole('SUPER_ADMIN', 'PAYROLL_ADMIN', 'HR_MANAGER') }, async (req, reply) => {
    const { month, year } = req.params as { month: string; year: string };
    const payslips = await app.prisma.payslip.findMany({
      where: { month: Number(month), year: Number(year), employee: { status: 'ACTIVE' } },
      include: { employee: { select: { name: true, employeeCode: true, branch: { select: { name: true } } } } },
      orderBy: { employee: { employeeCode: 'asc' } },
    });
    if (payslips.length === 0) throw AppError.notFound('No payslips for that month — run payroll first');
    const company = await getCompany(app);
    const pdf = await generateSalaryRegisterPdf(
      Number(month),
      Number(year),
      payslips.map((p) => ({
        employeeCode: p.employee.employeeCode,
        name: p.employee.name,
        branch: p.employee.branch?.name ?? '-',
        presentDays: p.presentDays,
        lateDays: p.lateDays,
        otHours: p.otHours,
        otPay: p.otPay,
        sundayPay: p.sundayPay,
        basicSalary: p.basicSalary,
        hra: p.hra,
        da: p.da,
        otherAllowances: p.otherAllowances,
        grossSalary: p.grossSalary,
        pfDeduction: p.pfDeduction,
        esiDeduction: p.esiDeduction,
        netSalary: p.netSalary,
        payDate: p.payDate,
        status: p.status,
      })),
      company,
    );
    reply.header('Content-Type', 'application/pdf');
    reply.header('Content-Disposition', `attachment; filename="salary-register-${month}-${year}.pdf"`);
    return reply.send(pdf);
  });

  /**
   * What a payroll run would write, next to what is stored today.
   *
   * This endpoint used to read the stored payslips back and return them under
   * the name `preview`, which is the opposite of a preview: it showed the
   * figures a previous run produced, so an administrator checking before
   * re-running a month saw exactly what they already had and learned nothing.
   *
   * It now computes the month with `computeMonthlyPayroll` — the same function
   * the run itself persists and the payroll report renders — and diffs it
   * against the stored rows. Nothing is written.
   *
   * This matters most when re-running a month that has already been paid out.
   * A payroll run upserts in place and there is no history table, so the stored
   * row is the only record of what an employee was actually paid; once it is
   * overwritten, the previous figure is gone. Seeing the deltas first is the
   * difference between a correction and a surprise.
   */
  app.get('/admin/payroll/preview/:month/:year', { preHandler: requireRole('SUPER_ADMIN', 'PAYROLL_ADMIN') }, async (req) => {
    const month = Number((req.params as { month: string }).month);
    const year = Number((req.params as { year: string }).year);

    const { payroll: policy, attendance } = await getTenantPolicy(app.prisma);
    const halfDayWindow = { start: attendance.halfDayWindowStart, end: attendance.halfDayWindowEnd };
    // Exactly the population the run covers — ACTIVE only. Anyone since
    // deactivated is reported separately below rather than silently omitted.
    const employees = await app.prisma.employee.findMany({
      where: { status: 'ACTIVE' },
      include: { shift: true },
    });
    const holidaySet = await monthHolidaySet(app.prisma, month, year);
    const preloaded = await loadPayrollMonth(app.prisma, employees.map((e) => e.id), month, year);

    const stored = await app.prisma.payslip.findMany({
      where: { month, year },
      include: { employee: { select: { name: true, employeeCode: true, status: true } } },
    });
    const storedByEmployee = new Map(stored.map((p) => [p.employeeId, p]));

    const rows = [];
    for (const emp of employees) {
      const r = await computeMonthlyPayroll(app.prisma, emp, month, year, holidaySet, policy, halfDayWindow, preloaded.get(emp.id));
      const was = storedByEmployee.get(emp.id);
      storedByEmployee.delete(emp.id);
      rows.push({
        employeeId: emp.id,
        name: emp.name,
        employeeCode: emp.employeeCode,
        // Absent when this employee has no slip for the month yet — the run
        // would create one rather than change anything.
        isNew: !was,
        storedNet: was?.netSalary ?? null,
        storedOtHours: was?.otHours ?? null,
        storedOtPay: was ? (was.otPay ?? 0) + (was.sundayPay ?? 0) : null,
        storedPresentDays: was?.presentDays ?? null,
        storedAbsentDays: was?.absentDays ?? null,
        storedPayDate: was?.payDate ?? null,
        net: r.netSalary,
        otHours: r.otHours,
        otPay: round2(r.otPay + r.sundayPay),
        presentDays: r.presentDays,
        absentDays: r.absentDays,
        pendingDays: r.pendingDays,
        payDate: r.payDate,
        delta: was ? round2(r.netSalary - was.netSalary) : null,
      });
    }

    /**
     * Stored slips with no ACTIVE employee behind them.
     *
     * A run only covers ACTIVE staff, so these rows are left exactly as they
     * are — including any error they already carry. Silently omitting them
     * would make the preview's totals look like the whole month when they are
     * not, so they are named.
     */
    const skipped = [...storedByEmployee.values()].map((p) => ({
      employeeId: p.employeeId,
      name: p.employee.name,
      employeeCode: p.employee.employeeCode,
      status: p.employee.status,
      storedNet: p.netSalary,
      storedOtHours: p.otHours,
    }));

    const changed = rows.filter((r) => r.delta !== null && Math.abs(r.delta) >= 0.01);
    return {
      month,
      year,
      rows,
      skipped,
      summary: {
        employees: rows.length,
        newSlips: rows.filter((r) => r.isNew).length,
        changedSlips: changed.length,
        skippedSlips: skipped.length,
        storedNetTotal: round2(rows.reduce((s, r) => s + (r.storedNet ?? 0), 0)),
        netTotal: round2(rows.reduce((s, r) => s + r.net, 0)),
        netDelta: round2(changed.reduce((s, r) => s + (r.delta ?? 0), 0)),
        storedOtPayTotal: round2(rows.reduce((s, r) => s + (r.storedOtPay ?? 0), 0)),
        otPayTotal: round2(rows.reduce((s, r) => s + r.otPay, 0)),
        payDateMoves: rows.filter(
          (r) => r.storedPayDate && r.payDate && new Date(r.storedPayDate).getTime() !== r.payDate.getTime(),
        ).length,
      },
    };
  });

  app.get('/payroll/my-payslips', { preHandler: authenticate }, async (req) => {
    const payslips = await app.prisma.payslip.findMany({ where: { employeeId: req.user.sub }, orderBy: [{ year: 'desc' }, { month: 'desc' }] });
    return { payslips };
  });

  app.get('/payroll/my-payslips/:id/pdf', { preHandler: authenticate }, async (req, reply) => {
    const { id } = req.params as { id: string };
    const payslip = await app.prisma.payslip.findUnique({ where: { id } });
    if (!payslip) throw AppError.notFound('Payslip');
    if (req.user.role === 'EMPLOYEE' && payslip.employeeId !== req.user.sub) {
      throw AppError.forbidden('Not your payslip');
    }    return streamPayslipPdf(app, reply, id);
  });

  // Admin: download any employee's payslip PDF.
  app.get('/admin/payroll/payslips/:id/pdf', { preHandler: requireRole('SUPER_ADMIN', 'PAYROLL_ADMIN', 'HR_MANAGER') }, async (req, reply) => {
    const { id } = req.params as { id: string };
    return streamPayslipPdf(app, reply, id);
  });

  /**
   * The bulk transfer file for a month's salaries.
   *
   * SUPER_ADMIN / PAYROLL_ADMIN only, and audited: this is the one response in
   * the system that carries every employee's bank account number in clear, and
   * downloading it is worth a line in the trail.
   *
   * `preview=1` returns the same split as JSON without the file, so the screen
   * can show what will and will not be paid before anything is downloaded.
   */
  app.get('/admin/payroll/bank-file/:month/:year', { preHandler: requireRole('SUPER_ADMIN', 'PAYROLL_ADMIN') }, async (req, reply) => {
    const month = Number((req.params as { month: string }).month);
    const year = Number((req.params as { year: string }).year);
    const preview = (req.query as { preview?: string }).preview === '1';

    const payslips = await app.prisma.payslip.findMany({
      where: { month, year, employee: { status: 'ACTIVE' } },
      include: {
        employee: {
          select: { name: true, employeeCode: true, bankAccountName: true, bankAccountNo: true, bankIfsc: true },
        },
      },
      orderBy: { employee: { employeeCode: 'asc' } },
    });
    if (payslips.length === 0) throw AppError.notFound('No payslips for that month — run payroll first');

    const result = buildBankFile(
      payslips.map((p) => ({
        employeeCode: p.employee.employeeCode,
        name: p.employee.name,
        bankAccountName: p.employee.bankAccountName,
        bankAccountNo: p.employee.bankAccountNo,
        bankIfsc: p.employee.bankIfsc,
        netSalary: p.netSalary,
      })),
    );

    if (preview) {
      // Account numbers are not needed to decide whether to download, so the
      // preview does not carry them — only the count, the total and who is
      // being left out and why.
      return {
        month,
        year,
        payable: result.rows.length,
        total: result.total,
        excluded: result.excluded,
      };
    }

    await recordAudit(req, 'BANK_FILE_DOWNLOADED', 'Payroll', {
      metadata: { month, year, payable: result.rows.length, total: result.total, excluded: result.excluded.length },
    });

    const csv = bankFileCsv(result, month, year);
    reply.header('Content-Type', 'text/csv; charset=utf-8');
    reply.header('Content-Disposition', `attachment; filename="salary-transfer-${year}-${String(month).padStart(2, '0')}.csv"`);
    return reply.send(csv);
  });

  app.post('/admin/payroll/send-slips', { preHandler: requireRole('SUPER_ADMIN', 'PAYROLL_ADMIN') }, async () => {
    // TODO: enqueue SALARY_SLIP WhatsApp jobs for all finalized payslips
    return { queued: 0, status: 'TODO' };
  });
}
