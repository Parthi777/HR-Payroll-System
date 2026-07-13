import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { authenticate, requireRole } from '../middleware/auth.js';
import { checkGeofence } from '../services/geofence/geofence.service.js';

const checkSchema = z.object({
  lat: z.coerce.number(),
  lng: z.coerce.number(),
  branchId: z.string(),
});

export async function geofenceRoutes(app: FastifyInstance) {
  app.get('/geofence/check', { preHandler: authenticate }, async (req) => {
    const { lat, lng, branchId } = checkSchema.parse(req.query);
    const branch = await app.prisma.branch.findUnique({ where: { id: branchId } });
    if (!branch) return { inside: false, error: 'Branch not found' };
    return checkGeofence({ lat, lng }, branch);
  });

  app.get('/admin/geofence', { preHandler: requireRole('SUPER_ADMIN', 'HR_MANAGER', 'BRANCH_MANAGER') }, async () => {
    const branches = await app.prisma.branch.findMany();
    return { branches };
  });

  // Flexible geofence: admin can move the center, resize the radius, and switch
  // strict/soft mode per branch at any time.
  app.put('/admin/geofence/:branchId', { preHandler: requireRole('SUPER_ADMIN', 'HR_MANAGER') }, async (req) => {
    const { branchId } = req.params as { branchId: string };
    const data = z
      .object({
        geofenceLat: z.number().min(-90).max(90).optional(),
        geofenceLng: z.number().min(-180).max(180).optional(),
        geofenceRadius: z.number().min(20).max(10000).optional(), // meters
        strictMode: z.boolean().optional(),
      })
      .parse(req.body);
    const branch = await app.prisma.branch.update({ where: { id: branchId }, data });
    return { branch };
  });

  app.get('/admin/geofence/violations', { preHandler: requireRole('SUPER_ADMIN', 'HR_MANAGER', 'BRANCH_MANAGER') }, async () => {
    const violations = await app.prisma.geofenceViolation.findMany({ take: 100, orderBy: { timestamp: 'desc' } });
    return { violations };
  });
}
