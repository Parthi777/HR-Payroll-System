import type { FastifyInstance, FastifyReply } from 'fastify';
import { z } from 'zod';
import { authenticate, requireRole } from '../middleware/auth.js';
import { AppError } from '../utils/AppError.js';
import { runMonthlyPayroll } from '../services/payroll/payroll-run.service.js';
import { generatePayslipPdf } from '../services/payroll/payslip-pdf.service.js';

/** Fetch a payslip (with employee+branch) and stream it as a PDF. */
async function streamPayslipPdf(app: FastifyInstance, reply: FastifyReply, id: string) {
  const payslip = await app.prisma.payslip.findUnique({
    where: { id },
    include: { employee: { include: { branch: true } } },
  });
  if (!payslip) throw AppError.notFound('Payslip');
  const pdf = await generatePayslipPdf(payslip);
  reply.header('Content-Type', 'application/pdf');
  reply.header('Content-Disposition', `inline; filename="payslip-${payslip.month}-${payslip.year}.pdf"`);
  return reply.send(pdf);
}

const runSchema = z.object({ month: z.number().int().min(1).max(12), year: z.number().int() });

export async function payrollRoutes(app: FastifyInstance) {
  app.post('/admin/payroll/run', { preHandler: requireRole('SUPER_ADMIN', 'PAYROLL_ADMIN') }, async (req) => {
    const { month, year } = runSchema.parse(req.body);
    // Synchronous run for now. TODO: enqueue via BullMQ for large companies.
    return runMonthlyPayroll(app.prisma, month, year);
  });

  // Admin: list all payslips for a month with employee names (web Payroll page).
  app.get('/admin/payroll/payslips/:month/:year', { preHandler: requireRole('SUPER_ADMIN', 'PAYROLL_ADMIN', 'HR_MANAGER') }, async (req) => {
    const { month, year } = req.params as { month: string; year: string };
    const payslips = await app.prisma.payslip.findMany({
      where: { month: Number(month), year: Number(year) },
      include: { employee: { select: { name: true, employeeCode: true } } },
      orderBy: { netSalary: 'desc' },
    });
    return { payslips };
  });

  app.get('/admin/payroll/preview/:month/:year', { preHandler: requireRole('SUPER_ADMIN', 'PAYROLL_ADMIN') }, async (req) => {
    const { month, year } = req.params as { month: string; year: string };
    const payslips = await app.prisma.payslip.findMany({ where: { month: Number(month), year: Number(year) } });
    return { month: Number(month), year: Number(year), preview: payslips };
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
    }
    if (payslip.status === 'WITHHELD') {
      throw new AppError(
        `Salary slip withheld — ${payslip.lateDays} late punches this month. Please contact HR.`,
        403,
      );
    }
    return streamPayslipPdf(app, reply, id);
  });

  // Admin: download any employee's payslip PDF.
  app.get('/admin/payroll/payslips/:id/pdf', { preHandler: requireRole('SUPER_ADMIN', 'PAYROLL_ADMIN', 'HR_MANAGER') }, async (req, reply) => {
    const { id } = req.params as { id: string };
    return streamPayslipPdf(app, reply, id);
  });

  app.post('/admin/payroll/send-slips', { preHandler: requireRole('SUPER_ADMIN', 'PAYROLL_ADMIN') }, async () => {
    // TODO: enqueue SALARY_SLIP WhatsApp jobs for all finalized payslips
    return { queued: 0, status: 'TODO' };
  });
}
