import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import bcrypt from 'bcrypt';
import { requireRole } from '../middleware/auth.js';
import { AppError } from '../utils/AppError.js';

const ROLES = ['SUPER_ADMIN', 'HR_MANAGER', 'BRANCH_MANAGER', 'PAYROLL_ADMIN', 'CASHIER'] as const;

const createSchema = z.object({
  name: z.string().min(1),
  email: z.string().email(),
  role: z.enum(ROLES),
  password: z.string().min(8),
  branchId: z.string().nullable().optional(), // set = account only sees that branch's claims
});
const updateSchema = z.object({
  name: z.string().min(1).optional(),
  role: z.enum(ROLES).optional(),
  password: z.string().min(8).optional(),
  isActive: z.boolean().optional(),
  branchId: z.string().nullable().optional(),
});

const safeSelect = { id: true, name: true, email: true, role: true, branchId: true, isActive: true, createdAt: true };

/**
 * User-access management: admin/manager accounts that can sign in to the web app
 * and the mobile admin mode. SUPER_ADMIN only. Accounts are disabled, never hard-
 * deleted (audit logs reference them). Guards against locking yourself out.
 */
export async function adminUsersRoutes(app: FastifyInstance) {
  app.addHook('preHandler', requireRole('SUPER_ADMIN'));

  app.get('/admin/users', async () => ({
    admins: await app.prisma.adminUser.findMany({ select: safeSelect, orderBy: { createdAt: 'asc' } }),
  }));

  app.post('/admin/users', async (req) => {
    const { password, ...rest } = createSchema.parse(req.body);
    const passwordHash = await bcrypt.hash(password, 12);
    const admin = await app.prisma.adminUser.create({ data: { ...rest, passwordHash }, select: safeSelect });
    return { admin };
  });

  app.put('/admin/users/:id', async (req) => {
    const { id } = req.params as { id: string };
    const { password, ...rest } = updateSchema.parse(req.body);

    if (id === req.user.sub && rest.isActive === false) {
      throw new AppError('You cannot disable your own account', 400);
    }
    if (id === req.user.sub && rest.role && rest.role !== 'SUPER_ADMIN') {
      throw new AppError('You cannot demote your own account', 400);
    }
    // Never allow the last active SUPER_ADMIN to be disabled or demoted.
    if (rest.isActive === false || (rest.role && rest.role !== 'SUPER_ADMIN')) {
      const target = await app.prisma.adminUser.findUnique({ where: { id } });
      if (target?.role === 'SUPER_ADMIN' && target.isActive) {
        const supers = await app.prisma.adminUser.count({ where: { role: 'SUPER_ADMIN', isActive: true } });
        if (supers <= 1) throw new AppError('Cannot remove the last active Super Admin', 409);
      }
    }

    const data = { ...rest, ...(password ? { passwordHash: await bcrypt.hash(password, 12) } : {}) };
    const admin = await app.prisma.adminUser.update({ where: { id }, data, select: safeSelect });
    return { admin };
  });
}
