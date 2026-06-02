import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { authenticate, requireRole } from '../middleware/auth.js';

const applyLeaveSchema = z.object({
  type: z.enum(['CL', 'SL', 'EL', 'LOP', 'HALF_DAY']),
  fromDate: z.coerce.date(),
  toDate: z.coerce.date(),
  days: z.number().positive(),
  reason: z.string().min(1),
  documentUrl: z.string().url().optional(),
});

export async function leaveRoutes(app: FastifyInstance) {
  app.post('/leaves/apply', { preHandler: authenticate }, async (req) => {
    const data = applyLeaveSchema.parse(req.body);
    const leave = await app.prisma.leave.create({ data: { ...data, employeeId: req.user.sub } });
    return { leave };
  });

  app.get('/leaves/my-leaves', { preHandler: authenticate }, async (req) => {
    const leaves = await app.prisma.leave.findMany({ where: { employeeId: req.user.sub }, orderBy: { createdAt: 'desc' } });
    return { leaves };
  });

  app.get('/leaves/balance', { preHandler: authenticate }, async (req) => {
    const balances = await app.prisma.leaveBalance.findMany({ where: { employeeId: req.user.sub } });
    return { balances };
  });

  // Admin
  app.get('/admin/leaves/pending', { preHandler: requireRole('SUPER_ADMIN', 'HR_MANAGER', 'BRANCH_MANAGER') }, async () => {
    const pending = await app.prisma.leave.findMany({ where: { status: 'PENDING' }, include: { employee: true } });
    return { pending };
  });

  app.patch('/admin/leaves/:id/approve', { preHandler: requireRole('SUPER_ADMIN', 'HR_MANAGER', 'BRANCH_MANAGER') }, async (req) => {
    const { id } = req.params as { id: string };
    const { note } = z.object({ note: z.string().optional() }).parse(req.body ?? {});
    const leave = await app.prisma.leave.update({ where: { id }, data: { status: 'APPROVED', approvedBy: req.user.sub, approverNote: note } });
    // TODO: queue LEAVE_APPROVED WhatsApp notification
    return { leave };
  });

  app.patch('/admin/leaves/:id/reject', { preHandler: requireRole('SUPER_ADMIN', 'HR_MANAGER', 'BRANCH_MANAGER') }, async (req) => {
    const { id } = req.params as { id: string };
    const { note } = z.object({ note: z.string() }).parse(req.body);
    const leave = await app.prisma.leave.update({ where: { id }, data: { status: 'REJECTED', approvedBy: req.user.sub, approverNote: note } });
    // TODO: queue LEAVE_REJECTED WhatsApp notification
    return { leave };
  });
}
