import type { FastifyInstance } from 'fastify';
import { promises as fs } from 'fs';
import path from 'path';
import { authenticate } from '../middleware/auth.js';
import { AppError } from '../utils/AppError.js';
import { getSignedSelfieUrl } from '../services/storage/storage.service.js';

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

  // Profile photo: the enrolled face photo when available, else the most recent
  // check-in selfie. Streams local files, redirects to a signed URL for S3 keys.
  app.get('/me/photo', { preHandler: authenticate }, async (req, reply) => {
    const e = await app.prisma.employee.findUnique({ where: { id: req.user.sub } });
    let src = e?.faceTemplateUrl ?? null;
    if (!src) {
      const att = await app.prisma.attendance.findFirst({
        where: { employeeId: req.user.sub, checkInSelfie: { not: null } },
        orderBy: { date: 'desc' },
      });
      src = att?.checkInSelfie ?? null;
    }
    if (!src) throw AppError.notFound('Photo');
    if (src.startsWith('/uploads/')) {
      const abs = path.resolve(process.cwd(), src.replace(/^\//, ''));
      return reply.type('image/jpeg').send(await fs.readFile(abs));
    }
    return reply.redirect(await getSignedSelfieUrl(src));
  });
}
