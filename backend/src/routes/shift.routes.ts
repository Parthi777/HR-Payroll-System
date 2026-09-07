import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { authenticate, requireRole } from '../middleware/auth.js';
import { AppError } from '../utils/AppError.js';
import { requireTenantId } from '../context/tenant-context.js';
import { recordAudit } from '../services/audit/audit.service.js';

const shiftSchema = z.object({
  name: z.string(),
  startTime: z.string().regex(/^\d{2}:\d{2}$/),
  endTime: z.string().regex(/^\d{2}:\d{2}$/),
  gracePeriod: z.number().int().default(15),
  otAfterMinutes: z.number().int().min(0).max(720).default(0),
  isNightShift: z.boolean().default(false),
});

export async function shiftRoutes(app: FastifyInstance) {
  app.get('/shifts', { preHandler: authenticate }, async () => {
    const shifts = await app.prisma.shift.findMany();
    return { shifts };
  });

  app.post('/admin/shifts', { preHandler: requireRole('SUPER_ADMIN', 'HR_MANAGER') }, async (req) => {
    const data = shiftSchema.parse(req.body);
    const shift = await app.prisma.shift.create({ data: { ...data, tenantId: requireTenantId() } });
    await recordAudit(req, 'SHIFT_CREATED', 'Shift', {
      entityId: shift.id,
      metadata: { name: shift.name, hours: `${shift.startTime}–${shift.endTime}`, gracePeriod: shift.gracePeriod },
    });
    return { shift };
  });

  app.put('/admin/shifts/:id', { preHandler: requireRole('SUPER_ADMIN', 'HR_MANAGER') }, async (req) => {
    const { id } = req.params as { id: string };
    const data = shiftSchema.partial().parse(req.body);
    const shift = await app.prisma.shift.update({ where: { id }, data });
    // Grace period and OT threshold decide who is late and who is paid extra,
    // so what was submitted is worth keeping alongside the name.
    await recordAudit(req, 'SHIFT_UPDATED', 'Shift', {
      entityId: shift.id,
      metadata: { name: shift.name, ...data },
    });
    return { shift };
  });

  app.delete('/admin/shifts/:id', { preHandler: requireRole('SUPER_ADMIN', 'HR_MANAGER') }, async (req) => {
    const { id } = req.params as { id: string };
    const staff = await app.prisma.employee.count({ where: { shiftId: id } });
    if (staff > 0) {
      throw new AppError(`Cannot delete — ${staff} employee(s) are on this shift. Reassign them first.`, 409);
    }
    // Read the name before the row is gone: an entry naming only a deleted id
    // is unreadable, and the id can never be resolved again.
    const doomed = await app.prisma.shift.findUnique({ where: { id }, select: { name: true } });
    await app.prisma.shift.delete({ where: { id } });
    await recordAudit(req, 'SHIFT_DELETED', 'Shift', {
      entityId: id,
      metadata: { name: doomed?.name ?? null },
    });
    return { id, deleted: true };
  });

  app.post('/admin/shifts/assign', { preHandler: requireRole('SUPER_ADMIN', 'HR_MANAGER') }, async (req) => {
    const { shiftId, employeeIds } = z.object({ shiftId: z.string(), employeeIds: z.array(z.string()) }).parse(req.body);
    await app.prisma.employee.updateMany({ where: { id: { in: employeeIds } }, data: { shiftId } });
    const shift = await app.prisma.shift.findUnique({ where: { id: shiftId }, select: { name: true } });
    await recordAudit(req, 'SHIFT_ASSIGNED', 'Shift', {
      entityId: shiftId,
      metadata: { shift: shift?.name ?? null, employeeCount: employeeIds.length, employeeIds },
    });
    return { assigned: employeeIds.length };
  });

  app.get('/shifts/my-schedule', { preHandler: authenticate }, async (req) => {
    const employee = await app.prisma.employee.findUnique({
      where: { id: req.user.sub },
      include: { shift: true },
    });
    const shift = employee?.shift;
    // Next 7 days on the employee's assigned shift (Sundays marked as off).
    const schedule = Array.from({ length: 7 }, (_, i) => {
      const d = new Date();
      d.setHours(0, 0, 0, 0);
      d.setDate(d.getDate() + i);
      const isOff = d.getDay() === 0;
      return {
        date: d.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' }),
        shiftName: isOff ? 'Weekly Off' : (shift?.name ?? 'General Shift'),
        startTime: isOff ? null : (shift?.startTime ?? '09:00'),
        endTime: isOff ? null : (shift?.endTime ?? '18:00'),
        isOff,
      };
    });
    return { employeeId: req.user.sub, schedule };
  });
}
