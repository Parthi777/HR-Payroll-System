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

const companySchema = z.object({
  name: z.string().default(''),
  address: z.string().default(''),
  phone: z.string().default(''),
  email: z.string().default(''),
  gstin: z.string().default(''),
});

/** Master data: branches, departments, designations. Powers the Add-Employee form. */
export async function masterRoutes(app: FastifyInstance) {
  app.addHook('preHandler', requireRole('SUPER_ADMIN', 'HR_MANAGER', 'BRANCH_MANAGER'));

  // Company profile — shown on salary slips / register. Singleton row id="company".
  app.get('/admin/company', async () => {
    const company = await app.prisma.companySettings.findUnique({ where: { id: 'company' } });
    return { company: company ?? { id: 'company', name: '', address: '', phone: '', email: '', gstin: '' } };
  });

  app.put('/admin/company', { preHandler: requireRole('SUPER_ADMIN', 'HR_MANAGER') }, async (req) => {
    const data = companySchema.parse(req.body);
    const company = await app.prisma.companySettings.upsert({
      where: { id: 'company' },
      update: data,
      create: { id: 'company', ...data },
    });
    return { company };
  });

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
  app.put('/admin/departments/:id', async (req) => {
    const { id } = req.params as { id: string };
    const { name } = z.object({ name: z.string().min(1) }).parse(req.body);
    return { department: await app.prisma.department.update({ where: { id }, data: { name } }) };
  });
  app.delete('/admin/departments/:id', async (req) => {
    const { id } = req.params as { id: string };
    const staff = await app.prisma.employee.count({ where: { departmentId: id } });
    if (staff > 0) {
      throw new AppError(`Cannot delete — ${staff} employee(s) are in this department. Reassign them first.`, 409);
    }
    await app.prisma.department.delete({ where: { id } });
    return { id, deleted: true };
  });

  // Designations
  app.get('/admin/designations', async () => ({
    designations: await app.prisma.designation.findMany({ orderBy: { name: 'asc' } }),
  }));
  app.post('/admin/designations', async (req) => {
    const { name } = z.object({ name: z.string().min(1) }).parse(req.body);
    return { designation: await app.prisma.designation.create({ data: { name } }) };
  });
  app.put('/admin/designations/:id', async (req) => {
    const { id } = req.params as { id: string };
    const { name } = z.object({ name: z.string().min(1) }).parse(req.body);
    return { designation: await app.prisma.designation.update({ where: { id }, data: { name } }) };
  });
  app.delete('/admin/designations/:id', async (req) => {
    const { id } = req.params as { id: string };
    const staff = await app.prisma.employee.count({ where: { designationId: id } });
    if (staff > 0) {
      throw new AppError(`Cannot delete — ${staff} employee(s) hold this designation. Reassign them first.`, 409);
    }
    await app.prisma.designation.delete({ where: { id } });
    return { id, deleted: true };
  });
}
