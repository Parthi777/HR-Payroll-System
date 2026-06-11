import type { FastifyInstance } from 'fastify';
import { authenticate } from '../middleware/auth.js';
import { AppError } from '../utils/AppError.js';

/** Logged-in employee's own profile (for the app home/dashboard header). */
export async function profileRoutes(app: FastifyInstance) {
  app.get('/me', { preHandler: authenticate }, async (req) => {
    const e = await app.prisma.employee.findUnique({
      where: { id: req.user.sub },
      include: { branch: true, designation: true, department: true, shift: true },
    });
    if (!e) throw AppError.notFound('Employee');
    return {
      id: e.id,
      name: e.name,
      employeeCode: e.employeeCode,
      phone: e.phone,
      designation: e.designation.name,
      department: e.department.name,
      branch: e.branch.name,
      shift: e.shift.name,
    };
  });
}
