import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { authenticate, requireRole } from '../middleware/auth.js';
import { AppError } from '../utils/AppError.js';

const shiftSchema = z.object({
  name: z.string(),
  startTime: z.string().regex(/^\d{2}:\d{2}$/),
  endTime: z.string().regex(/^\d{2}:\d{2}$/),
  gracePeriod: z.number().int().default(15),
  otThresholdHours: z.number().min(0).max(24).default(10),
  isNightShift: z.boolean().default(false),
});

export async function shiftRoutes(app: FastifyInstance) {
  app.get('/shifts', { preHandler: authenticate }, async () => {
    const shifts = await app.prisma.shift.findMany();
    return { shifts };
  });

  app.post('/admin/shifts', { preHandler: requireRole('SUPER_ADMIN', 'HR_MANAGER') }, async (req) => {
    const data = shiftSchema.parse(req.body);
    const shift = await app.prisma.shift.create({ data });
    return { shift };
  });

  app.put('/admin/shifts/:id', { preHandler: requireRole('SUPER_ADMIN', 'HR_MANAGER') }, async (req) => {
    const { id } = req.params as { id: string };
    const data = shiftSchema.partial().parse(req.body);
    const shift = await app.prisma.shift.update({ where: { id }, data });
    return { shift };
  });

  app.delete('/admin/shifts/:id', { preHandler: requireRole('SUPER_ADMIN', 'HR_MANAGER') }, async (req) => {
    const { id } = req.params as { id: string };
    const staff = await app.prisma.employee.count({ where: { shiftId: id } });
    if (staff > 0) {
      throw new AppError(`Cannot delete — ${staff} employee(s) are on this shift. Reassign them first.`, 409);
    }
    await app.prisma.shift.delete({ where: { id } });
    return { id, deleted: true };
  });

  app.post('/admin/shifts/assign', { preHandler: requireRole('SUPER_ADMIN', 'HR_MANAGER') }, async (req) => {
    const { shiftId, employeeIds } = z.object({ shiftId: z.string(), employeeIds: z.array(z.string()) }).parse(req.body);
    await app.prisma.employee.updateMany({ where: { id: { in: employeeIds } }, data: { shiftId } });
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
