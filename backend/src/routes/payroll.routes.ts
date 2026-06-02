import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { authenticate, requireRole } from '../middleware/auth.js';

const runSchema = z.object({ month: z.number().int().min(1).max(12), year: z.number().int() });

export async function payrollRoutes(app: FastifyInstance) {
  app.post('/admin/payroll/run', { preHandler: requireRole('SUPER_ADMIN', 'PAYROLL_ADMIN') }, async (req) => {
    const { month, year } = runSchema.parse(req.body);
    // TODO: enqueue payroll job (BullMQ) -> PayrollService.runForMonth(month, year)
    return { queued: true, month, year };
  });

  app.get('/admin/payroll/preview/:month/:year', { preHandler: requireRole('SUPER_ADMIN', 'PAYROLL_ADMIN') }, async (req) => {
    const { month, year } = req.params as { month: string; year: string };
    return { month: Number(month), year: Number(year), preview: [] };
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
