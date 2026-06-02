import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { requireRole } from '../middleware/auth.js';

/** Master data: branches, departments, designations. Powers the Add-Employee form. */
export async function masterRoutes(app: FastifyInstance) {
  app.addHook('preHandler', requireRole('SUPER_ADMIN', 'HR_MANAGER', 'BRANCH_MANAGER'));

  // Branches
  app.get('/admin/branches', async () => ({
    branches: await app.prisma.branch.findMany({ orderBy: { name: 'asc' } }),
  }));
  app.post('/admin/branches', async (req) => {
    const data = z
      .object({
        name: z.string().min(1),
        address: z.string().min(1),
        geofenceLat: z.number(),
        geofenceLng: z.number(),
        geofenceRadius: z.number().default(100),
        strictMode: z.boolean().default(false),
      })
      .parse(req.body);
    return { branch: await app.prisma.branch.create({ data }) };
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
