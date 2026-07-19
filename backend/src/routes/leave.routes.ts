import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { authenticate, requireRole } from '../middleware/auth.js';
import { AppError } from '../utils/AppError.js';
import { pushToEmployee } from '../services/push.service.js';
import { dispatchWhatsApp, waTemplates } from '../services/whatsapp/whatsapp.service.js';

const fmtDate = (d: Date) => d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });

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

  // Admin. Branch managers only see requests from employees who report to them;
  // SUPER_ADMIN / HR_MANAGER see all.
  app.get('/admin/leaves/pending', { preHandler: requireRole('SUPER_ADMIN', 'HR_MANAGER', 'BRANCH_MANAGER') }, async (req) => {
    const where: { status: string; employeeId?: { in: string[] } } = { status: 'PENDING' };
    if (req.user.role === 'BRANCH_MANAGER') {
      const reports = await app.prisma.employee.findMany({
        where: { reportingManagerId: req.user.sub },
        select: { id: true },
      });
      where.employeeId = { in: reports.map((r) => r.id) };
    }
    const pending = await app.prisma.leave.findMany({ where, include: { employee: true } });
    return { pending };
  });

  app.patch('/admin/leaves/:id/approve', { preHandler: requireRole('SUPER_ADMIN', 'HR_MANAGER', 'BRANCH_MANAGER') }, async (req) => {
    const { id } = req.params as { id: string };
    const { note } = z.object({ note: z.string().optional() }).parse(req.body ?? {});
    const pending = await app.prisma.leave.findUnique({ where: { id } });
    if (!pending) throw AppError.notFound('Leave request');
    if (pending.status !== 'PENDING') throw new AppError('This leave request was already decided', 409);
    const leave = await app.prisma.leave.update({
      where: { id },
      data: { status: 'APPROVED', approvedBy: req.user.sub, approverNote: note },
      include: { employee: true },
    });
    // Deduct from the year's balance for balance-tracked types (CL — also SL/EL if ever used).
    if (['CL', 'SL', 'EL'].includes(leave.type)) {
      await app.prisma.leaveBalance.updateMany({
        where: { employeeId: leave.employeeId, type: leave.type, year: leave.fromDate.getFullYear() },
        data: { used: { increment: leave.days } },
      });
    }
    await pushToEmployee(app.prisma, leave.employeeId, 'Leave approved \u2713', `${leave.type} ${fmtDate(leave.fromDate)}\u2013${fmtDate(leave.toDate)} (${leave.days} day/s) approved.`);
    await dispatchWhatsApp(app.prisma, {
      phone: leave.employee.phone,
      employeeId: leave.employeeId,
      trigger: 'LEAVE_APPROVED',
      templateName: 'LEAVE_APPROVED',
      message: waTemplates.leaveApproved(leave.type, fmtDate(leave.fromDate), fmtDate(leave.toDate), leave.days),
    });
    return { leave };
  });

  // CL balance management (web admin). Company policy uses CL only — no SL/EL.
  app.get('/admin/leaves/balances', { preHandler: requireRole('SUPER_ADMIN', 'HR_MANAGER', 'BRANCH_MANAGER') }, async () => {
    const year = new Date().getFullYear();
    const employees = await app.prisma.employee.findMany({
      where: { status: 'ACTIVE' },
      select: { id: true, name: true, employeeCode: true },
      orderBy: { employeeCode: 'asc' },
    });
    const rows = await app.prisma.leaveBalance.findMany({ where: { year, type: 'CL' } });
    const byEmployee = new Map(rows.map((b) => [b.employeeId, b]));
    return {
      year,
      balances: employees.map((e) => {
        const b = byEmployee.get(e.id);
        return { employeeId: e.id, name: e.name, employeeCode: e.employeeCode, total: b?.total ?? 0, used: b?.used ?? 0 };
      }),
    };
  });

  app.put('/admin/leaves/balances/:employeeId', { preHandler: requireRole('SUPER_ADMIN', 'HR_MANAGER') }, async (req) => {
    const { employeeId } = req.params as { employeeId: string };
    const { total } = z.object({ total: z.number().min(0).max(365) }).parse(req.body);
    const year = new Date().getFullYear();
    const balance = await app.prisma.leaveBalance.upsert({
      where: { employeeId_type_year: { employeeId, type: 'CL', year } },
      update: { total },
      create: { employeeId, type: 'CL', year, total, used: 0 },
    });
    return { balance };
  });

  app.patch('/admin/leaves/:id/reject', { preHandler: requireRole('SUPER_ADMIN', 'HR_MANAGER', 'BRANCH_MANAGER') }, async (req) => {
    const { id } = req.params as { id: string };
    const { note } = z.object({ note: z.string() }).parse(req.body);
    const pending = await app.prisma.leave.findUnique({ where: { id } });
    if (!pending) throw AppError.notFound('Leave request');
    if (pending.status !== 'PENDING') throw new AppError('This leave request was already decided', 409);
    const leave = await app.prisma.leave.update({
      where: { id },
      data: { status: 'REJECTED', approvedBy: req.user.sub, approverNote: note },
      include: { employee: true },
    });
    await pushToEmployee(app.prisma, leave.employeeId, 'Leave rejected', `${fmtDate(leave.fromDate)}\u2013${fmtDate(leave.toDate)} \u2014 ${note}`);
    await dispatchWhatsApp(app.prisma, {
      phone: leave.employee.phone,
      employeeId: leave.employeeId,
      trigger: 'LEAVE_REJECTED',
      templateName: 'LEAVE_REJECTED',
      message: waTemplates.leaveRejected(fmtDate(leave.fromDate), fmtDate(leave.toDate), note),
    });
    return { leave };
  });
}
