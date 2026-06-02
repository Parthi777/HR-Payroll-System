import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { authenticate, requireRole } from '../middleware/auth.js';

const shiftSchema = z.object({
  name: z.string(),
  startTime: z.string().regex(/^\d{2}:\d{2}$/),
  endTime: z.string().regex(/^\d{2}:\d{2}$/),
  gracePeriod: z.number().int().default(15),
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

  app.post('/admin/shifts/assign', { preHandler: requireRole('SUPER_ADMIN', 'HR_MANAGER') }, async (req) => {
    const { shiftId, employeeIds } = z.object({ shiftId: z.string(), employeeIds: z.array(z.string()) }).parse(req.body);
    await app.prisma.employee.updateMany({ where: { id: { in: employeeIds } }, data: { shiftId } });
    return { assigned: employeeIds.length };
  });

  app.get('/shifts/my-schedule', { preHandler: authenticate }, async (req) => {
    // TODO: build 7-day schedule from shift + rotation rules
    return { employeeId: req.user.sub, schedule: [] };
  });
}
