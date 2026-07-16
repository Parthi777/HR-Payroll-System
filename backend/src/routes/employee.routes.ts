import type { FastifyInstance } from 'fastify';
import { promises as fs } from 'fs';
import path from 'path';
import { z } from 'zod';
import bcrypt from 'bcrypt';
import { requireRole } from '../middleware/auth.js';
import { AppError } from '../utils/AppError.js';
import { enrollFace, removeFace, verifyFace, isFaceMatchEnabled } from '../services/ai/face.service.js';
import { env } from '../config/env.js';
import { isS3Enabled, uploadImage } from '../services/storage/storage.service.js';
import { normalizePhone } from '../utils/phone.js';

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
  reportingManagerId: z.string().nullable().optional(), // AdminUser id — approvals route to this manager
  password: z.string().min(4).optional(), // employee's app login password (phone + password)
  status: z.enum(['ACTIVE', 'INACTIVE', 'SUSPENDED']).optional(), // app-access control
});

/** Never return the password hash to clients. */
function safeEmployee<T extends { passwordHash?: string | null }>(e: T) {
  const { passwordHash: _omit, ...rest } = e;
  return rest;
}

export async function employeeRoutes(app: FastifyInstance) {
  app.addHook('preHandler', requireRole('SUPER_ADMIN', 'HR_MANAGER', 'BRANCH_MANAGER'));

  app.get('/', async () => {
    const employees = await app.prisma.employee.findMany({ include: { branch: true } });
    return { employees: employees.map(safeEmployee) };
  });

  // Managers dropdown (Add/Edit Employee) — active admins who can approve requests.
  // Static path registered alongside '/:id'; Fastify matches static segments first.
  app.get('/managers', async () => {
    const managers = await app.prisma.adminUser.findMany({
      where: { isActive: true, role: { in: ['SUPER_ADMIN', 'HR_MANAGER', 'BRANCH_MANAGER'] } },
      select: { id: true, name: true, role: true },
      orderBy: { name: 'asc' },
    });
    return { managers };
  });

  app.post('/', async (req) => {
    const { password, ...rest } = createEmployeeSchema.parse(req.body);
    rest.phone = normalizePhone(rest.phone);

    // Friendly duplicate checks — show the existing ID series and next free number.
    const codeDup = await app.prisma.employee.findUnique({ where: { employeeCode: rest.employeeCode } });
    if (codeDup) {
      const prefix = rest.employeeCode.replace(/\d+$/, '') || rest.employeeCode;
      const series = await app.prisma.employee.findMany({
        where: { employeeCode: { startsWith: prefix } },
        select: { employeeCode: true },
        orderBy: { employeeCode: 'asc' },
      });
      const codes = series.map((s) => s.employeeCode);
      const nums = codes.map((c) => parseInt(c.slice(prefix.length), 10)).filter(Number.isFinite);
      const width = Math.max(...codes.map((c) => c.length - prefix.length), 3);
      const next = `${prefix}${String((nums.length ? Math.max(...nums) : 0) + 1).padStart(width, '0')}`;
      throw new AppError(
        `Employee ID ${rest.employeeCode} already exists. Current series: ${codes.join(', ')}. Next available: ${next}`,
        409,
      );
    }
    const phoneDup = await app.prisma.employee.findUnique({ where: { phone: rest.phone } });
    if (phoneDup) {
      throw new AppError(`Phone ${rest.phone} is already registered to ${phoneDup.name} (${phoneDup.employeeCode})`, 409);
    }

    const data = { ...rest, ...(password ? { passwordHash: await bcrypt.hash(password, 10) } : {}) };
    const employee = await app.prisma.employee.create({ data });
    return { employee: safeEmployee(employee) };
  });

  app.get('/:id', async (req) => {
    const { id } = req.params as { id: string };
    const employee = await app.prisma.employee.findUnique({ where: { id }, include: { branch: true, shift: true } });
    if (!employee) throw AppError.notFound('Employee');
    return { employee: safeEmployee(employee) };
  });

  app.put('/:id', async (req) => {
    const { id } = req.params as { id: string };
    const { password, ...rest } = createEmployeeSchema.partial().parse(req.body);
    if (rest.phone) rest.phone = normalizePhone(rest.phone);
    const data = { ...rest, ...(password ? { passwordHash: await bcrypt.hash(password, 10) } : {}) };
    const employee = await app.prisma.employee.update({ where: { id }, data });
    return { employee: safeEmployee(employee) };
  });

  app.delete('/:id', async (req) => {
    const { id } = req.params as { id: string };
    await app.prisma.employee.update({ where: { id }, data: { status: 'INACTIVE' } });
    return { id, deactivated: true };
  });

  app.post('/:id/enroll-face', async (req) => {
    const { id } = req.params as { id: string };
    if (!isFaceMatchEnabled()) throw new AppError('Face recognition is not configured (set AWS keys)', 503);
    const existing = await app.prisma.employee.findUnique({ where: { id }, select: { faceTemplateId: true } });
    if (!existing) throw AppError.notFound('Employee');
    const data = await req.file();
    if (!data) throw new AppError('No image uploaded', 400);
    const buffer = await data.toBuffer();

    // Wrong-photo guard: if this face already belongs to a DIFFERENT enrolled
    // employee, refuse — otherwise one person's photo silently becomes two identities.
    const dup = await verifyFace(buffer, id);
    if (dup.enabled && dup.matchedEmployeeId && dup.matchedEmployeeId !== id && dup.score >= env.FACE_MATCH_THRESHOLD) {
      const other = await app.prisma.employee.findUnique({
        where: { id: dup.matchedEmployeeId },
        select: { name: true, employeeCode: true },
      });
      throw new AppError(
        `This photo matches ${other ? `${other.name} (${other.employeeCode})` : 'another employee'} who is already enrolled (${dup.score}% match). Use the correct person's photo.`,
        409,
      );
    }

    const { faceId } = await enrollFace(buffer, id);

    // Re-enrollment: drop the previous face so the collection doesn't accumulate
    // stale templates. Best-effort — the new face is already indexed.
    if (existing.faceTemplateId && existing.faceTemplateId !== faceId) {
      try {
        await removeFace(existing.faceTemplateId);
      } catch (err) {
        req.log.warn({ err, faceId: existing.faceTemplateId }, 'Failed to remove old face template');
      }
    }

    // Keep the enrolled photo — it doubles as the employee's profile picture (/me/photo).
    let faceTemplateUrl: string;
    if (isS3Enabled()) {
      faceTemplateUrl = await uploadImage(buffer, `faces/${id}-${Date.now()}.jpg`);
    } else {
      const dir = path.resolve(process.cwd(), 'uploads', 'faces');
      await fs.mkdir(dir, { recursive: true });
      const name = `${id}-${Date.now()}.jpg`;
      await fs.writeFile(path.join(dir, name), buffer);
      faceTemplateUrl = `/uploads/faces/${name}`;
    }

    await app.prisma.employee.update({ where: { id }, data: { faceTemplateId: faceId, faceTemplateUrl } });
    return { id, faceId, enrolled: true };
  });

  app.post('/bulk-import', async () => {
    // TODO: parse Excel upload -> bulk create
    return { imported: 0, status: 'TODO' };
  });
}
