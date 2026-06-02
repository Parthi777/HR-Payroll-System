import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { requireRole } from '../middleware/auth.js';
import { AppError } from '../utils/AppError.js';
import { enrollFace, isFaceMatchEnabled } from '../services/ai/face.service.js';

const createEmployeeSchema = z.object({
  employeeCode: z.string(),
  name: z.string(),
  phone: z.string().min(10),
  email: z.string().email().optional(),
  branchId: z.string(),
  departmentId: z.string(),
  designationId: z.string(),
  shiftId: z.string(),
  joiningDate: z.coerce.date(),
  salary: z.number().positive(),
});

export async function employeeRoutes(app: FastifyInstance) {
  app.addHook('preHandler', requireRole('SUPER_ADMIN', 'HR_MANAGER', 'BRANCH_MANAGER'));

  app.get('/', async () => {
    const employees = await app.prisma.employee.findMany({ include: { branch: true } });
    return { employees };
  });

  app.post('/', async (req) => {
    const data = createEmployeeSchema.parse(req.body);
    const employee = await app.prisma.employee.create({ data });
    return { employee };
  });

  app.get('/:id', async (req) => {
    const { id } = req.params as { id: string };
    const employee = await app.prisma.employee.findUnique({ where: { id }, include: { branch: true, shift: true } });
    if (!employee) throw AppError.notFound('Employee');
    return { employee };
  });

  app.put('/:id', async (req) => {
    const { id } = req.params as { id: string };
    const data = createEmployeeSchema.partial().parse(req.body);
    const employee = await app.prisma.employee.update({ where: { id }, data });
    return { employee };
  });

  app.delete('/:id', async (req) => {
    const { id } = req.params as { id: string };
    await app.prisma.employee.update({ where: { id }, data: { status: 'INACTIVE' } });
    return { id, deactivated: true };
  });

  app.post('/:id/enroll-face', async (req) => {
    const { id } = req.params as { id: string };
    if (!isFaceMatchEnabled()) throw new AppError('Face recognition is not configured (set AWS keys)', 503);
    const data = await req.file();
    if (!data) throw new AppError('No image uploaded', 400);
    const buffer = await data.toBuffer();
    const { faceId } = await enrollFace(buffer, id);
    await app.prisma.employee.update({ where: { id }, data: { faceTemplateId: faceId } });
    return { id, faceId, enrolled: true };
  });

  app.post('/bulk-import', async () => {
    // TODO: parse Excel upload -> bulk create
    return { imported: 0, status: 'TODO' };
  });
}
