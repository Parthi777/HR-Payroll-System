import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { authenticate, requireRole } from '../middleware/auth.js';
import { runMonthlyPayroll } from '../services/payroll/payroll-run.service.js';

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

  app.get('/payroll/my-payslips/:id/pdf', { preHandler: authenticate }, async (req) => {
    const { id } = req.params as { id: string };
    // TODO: stream PDF from Cloudinary signed URL
    return { id, pdfUrl: 'TODO' };
  });

  app.post('/admin/payroll/send-slips', { preHandler: requireRole('SUPER_ADMIN', 'PAYROLL_ADMIN') }, async () => {
    // TODO: enqueue SALARY_SLIP WhatsApp jobs for all finalized payslips
    return { queued: 0, status: 'TODO' };
  });
}
