import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { requireRole } from '../middleware/auth.js';
import { AppError } from '../utils/AppError.js';

const branchSchema = z.object({
  name: z.string().min(1),
  address: z.string().min(1),
  geofenceLat: z.number(),
  geofenceLng: z.number(),
  geofenceRadius: z.number().default(100),
  strictMode: z.boolean().default(false),
});

/** Master data: branches, departments, designations. Powers the Add-Employee form. */
export async function masterRoutes(app: FastifyInstance) {
  app.addHook('preHandler', requireRole('SUPER_ADMIN', 'HR_MANAGER', 'BRANCH_MANAGER'));

  // Branches
  app.get('/admin/branches', async () => ({
    branches: await app.prisma.branch.findMany({ orderBy: { name: 'asc' } }),
  }));
  app.post('/admin/branches', async (req) => {
    const data = branchSchema.parse(req.body);
    return { branch: await app.prisma.branch.create({ data }) };
  });
  app.put('/admin/branches/:id', async (req) => {
    const { id } = req.params as { id: string };
    const data = branchSchema.partial().parse(req.body);
    return { branch: await app.prisma.branch.update({ where: { id }, data }) };
  });
  app.delete('/admin/branches/:id', async (req) => {
    const { id } = req.params as { id: string };
    const staff = await app.prisma.employee.count({ where: { branchId: id } });
    if (staff > 0) {
      throw new AppError(`Cannot delete — ${staff} employee(s) are assigned to this branch. Reassign them first.`, 409);
    }
    await app.prisma.geofenceViolation.deleteMany({ where: { branchId: id } });
    await app.prisma.branch.delete({ where: { id } });
    return { id, deleted: true };
  });

  // Departments
  app.get('/admin/departments', async () => ({
    departments: await app.prisma.department.findMany({ orderBy: { name: 'asc' } }),
  }));
  app.post('/admin/departments', async (req) => {
    const { name } = z.object({ name: z.string().min(1) }).parse(req.body);
    return { department: await app.prisma.department.create({ data: { name } }) };
  });

  // Designations
  app.get('/admin/designations', async () => ({
    designations: await app.prisma.designation.findMany({ orderBy: { name: 'asc' } }),
  }));
  app.post('/admin/designations', async (req) => {
    const { name } = z.object({ name: z.string().min(1) }).parse(req.body);
    return { designation: await app.prisma.designation.create({ data: { name } }) };
  });
}
