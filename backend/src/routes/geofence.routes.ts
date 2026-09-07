import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { authenticate, requireRole } from '../middleware/auth.js';
import { checkGeofence } from '../services/geofence/geofence.service.js';
import { changed, recordAudit } from '../services/audit/audit.service.js';
import { AppError } from '../utils/AppError.js';

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
        geofenceRadius: z.number().min(0.5).max(10000).optional(), // meters (0.5m ≈ 1.6ft — owner wants very tight fences)
        strictMode: z.boolean().optional(),
      })
      .parse(req.body);
    const before = await app.prisma.branch.findUnique({ where: { id: branchId } });
    if (!before) throw new AppError('Branch not found', 404);
    const branch = await app.prisma.branch.update({ where: { id: branchId }, data });

    // A fence that quietly grew, or strict mode switched off, is what someone
    // investigating attendance from the wrong place will be looking for — so
    // both sides of the move are recorded, not just the new value.
    await recordAudit(req, 'GEOFENCE_UPDATED', 'Branch', {
      entityId: branch.id,
      metadata: {
        branch: branch.name,
        ...changed('lat', before.geofenceLat, branch.geofenceLat),
        ...changed('lng', before.geofenceLng, branch.geofenceLng),
        ...changed('radiusMetres', before.geofenceRadius, branch.geofenceRadius),
        ...changed('strictMode', before.strictMode, branch.strictMode),
      },
    });
    return { branch };
  });

  app.get('/admin/geofence/violations', { preHandler: requireRole('SUPER_ADMIN', 'HR_MANAGER', 'BRANCH_MANAGER') }, async () => {
    const violations = await app.prisma.geofenceViolation.findMany({
      take: 100,
      orderBy: { timestamp: 'desc' },
      include: { branch: { select: { name: true } } },
    });
    // GeofenceViolation has no employee relation — resolve names in one query.
    const emps = await app.prisma.employee.findMany({
      where: { id: { in: [...new Set(violations.map((v) => v.employeeId))] } },
      select: { id: true, name: true, employeeCode: true },
    });
    const byId = new Map(emps.map((e) => [e.id, e]));
    return {
      violations: violations.map((v) => ({
        ...v,
        employeeName: byId.get(v.employeeId)?.name ?? 'Unknown',
        employeeCode: byId.get(v.employeeId)?.employeeCode ?? '',
        branchName: v.branch?.name ?? '',
      })),
    };
  });
}
