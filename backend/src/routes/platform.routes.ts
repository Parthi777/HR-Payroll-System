import type { FastifyInstance, FastifyRequest } from 'fastify';
import { z } from 'zod';
import bcrypt from 'bcrypt';
import { requirePlatform, type JwtRole } from '../middleware/auth.js';
import { AppError } from '../utils/AppError.js';
import {
  addTenantAdmin,
  provisionTenant,
  tenantLoginUrl,
} from '../services/platform/tenant-provisioning.service.js';

const PLATFORM_TOKEN_TTL = '8h'; // this account can create and suspend dealers

const loginSchema = z.object({ email: z.string().email(), password: z.string().min(1) });

const createTenantSchema = z.object({
  slug: z.string().min(2).max(31),
  name: z.string().min(1),
  branchName: z.string().optional(),
  admin: z.object({
    name: z.string().min(1),
    email: z.string().email(),
    password: z.string().min(12),
  }),
});

const addAdminSchema = z.object({
  name: z.string().min(1),
  email: z.string().email(),
  password: z.string().min(12),
  role: z.enum(['SUPER_ADMIN', 'HR_MANAGER', 'BRANCH_MANAGER', 'PAYROLL_ADMIN', 'CASHIER']).optional(),
});

/**
 * The platform API — where dealers are onboarded.
 *
 * This is a separate surface from the tenant API, not a role within it. Platform
 * staff belong to no tenant, so there is no tenant context for these routes and
 * nothing here can be reached with a dealer's own sign-in (`requirePlatform`
 * rejects a tenant token, and `authenticate` rejects a platform one).
 *
 * Every action is written to PlatformAuditLog. That is the whole point of having
 * a platform layer: it is the only place where one account can affect every
 * customer, so it needs to be the best-recorded part of the system.
 */
export async function platformRoutes(app: FastifyInstance) {
  /** Record a platform action. Best-effort: it must never fail the action. */
  async function audit(
    req: FastifyRequest,
    action: string,
    detail: { targetTenantId?: string; targetId?: string; metadata?: unknown },
  ) {
    try {
      await app.prisma.platformAuditLog.create({
        data: {
          platformUserId: req.user.sub,
          action,
          targetTenantId: detail.targetTenantId ?? null,
          targetId: detail.targetId ?? null,
          metadata: detail.metadata ? JSON.stringify(detail.metadata) : null,
          ipAddress: req.ip,
        },
      });
    } catch (err) {
      req.log.error({ err, action }, 'failed to write platform audit log');
    }
  }

  // ── Sign in ──
  app.post('/platform/auth/login', { config: { rateLimit: { max: 5, timeWindow: '10 minutes' } } }, async (req) => {
    const { email, password } = loginSchema.parse(req.body);

    // No tenant context exists yet and none is needed: PlatformUser is a global
    // model, so this reads without any scoping at all.
    const staff = await app.prisma.platformUser.findUnique({
      where: { email: email.trim().toLowerCase() },
    });
    // Same message either way, so the response never confirms an account exists.
    if (!staff || !staff.isActive) throw AppError.unauthorized('Invalid email or password');
    if (!(await bcrypt.compare(password, staff.passwordHash))) {
      throw AppError.unauthorized('Invalid email or password');
    }

    const token = app.jwt.sign(
      { sub: staff.id, role: 'PLATFORM_ADMIN' as JwtRole, scope: 'PLATFORM' as const },
      { expiresIn: PLATFORM_TOKEN_TTL },
    );
    return { token, name: staff.name, email: staff.email };
  });

  app.get('/platform/me', { preHandler: requirePlatform }, async (req) => {
    const staff = await app.prisma.platformUser.findUnique({
      where: { id: req.user.sub },
      select: { id: true, name: true, email: true },
    });
    if (!staff) throw AppError.notFound('Account');
    return staff;
  });

  // ── Dealers ──
  app.get('/platform/tenants', { preHandler: requirePlatform }, async () => {
    const tenants = await app.prisma.tenant.findMany({ orderBy: { createdAt: 'asc' } });

    // Headcount per dealer, in one grouped query rather than one per tenant.
    // Reads across tenants on purpose. requirePlatform put this request in a
    // PLATFORM context, which the Prisma extension passes through unscoped —
    // the only place in the codebase where that is intended.
    const counts = await app.prisma.employee.groupBy({
      by: ['tenantId'],
      where: { status: 'ACTIVE' },
      _count: { _all: true },
    });
    const byTenant = new Map(counts.map((c) => [c.tenantId, c._count._all]));

    return {
      tenants: tenants.map((t) => ({
        id: t.id,
        slug: t.slug,
        name: t.name,
        status: t.status,
        createdAt: t.createdAt,
        employees: byTenant.get(t.id) ?? 0,
        loginUrl: tenantLoginUrl(t.slug),
      })),
    };
  });

  app.get('/platform/tenants/:id', { preHandler: requirePlatform }, async (req) => {
    const { id } = req.params as { id: string };
    const tenant = await app.prisma.tenant.findUnique({ where: { id } });
    if (!tenant) throw AppError.notFound('Dealer');

    // Admin accounts only — never any employee's data. Platform staff onboard
    // dealers; they have no business reading a dealer's payroll.
    const admins = await app.prisma.adminUser.findMany({
      where: { tenantId: id },
      select: { id: true, name: true, email: true, role: true, isActive: true, createdAt: true },
      orderBy: { createdAt: 'asc' },
    });
    const employees = await app.prisma.employee.count({ where: { tenantId: id, status: 'ACTIVE' } });

    return {
      tenant: { ...tenant, loginUrl: tenantLoginUrl(tenant.slug) },
      admins,
      employees,
    };
  });

  /**
   * Onboard a dealer: creates the workspace, its default org data and the first
   * administrator's credentials in one step, and returns the sign-in URL to
   * hand over.
   */
  app.post('/platform/tenants', { preHandler: requirePlatform }, async (req, reply) => {
    const input = createTenantSchema.parse(req.body);
    const created = await provisionTenant(app.prisma, input);

    await audit(req, 'TENANT_CREATED', {
      targetTenantId: created.id,
      targetId: created.adminId,
      // The password is never recorded — only that an account was made for this address.
      metadata: { slug: created.slug, name: created.name, adminEmail: created.adminEmail },
    });

    return reply.code(201).send({ tenant: created });
  });

  /** Add a further login to an existing dealer. */
  app.post('/platform/tenants/:id/admins', { preHandler: requirePlatform }, async (req, reply) => {
    const { id } = req.params as { id: string };
    const input = addAdminSchema.parse(req.body);

    const tenant = await app.prisma.tenant.findUnique({ where: { id } });
    if (!tenant) throw AppError.notFound('Dealer');

    const admin = await addTenantAdmin(app.prisma, id, input);
    await audit(req, 'TENANT_ADMIN_CREATED', {
      targetTenantId: id,
      targetId: admin.id,
      metadata: { email: admin.email, role: admin.role },
    });

    return reply.code(201).send({ admin, loginUrl: tenantLoginUrl(tenant.slug) });
  });

  /**
   * Suspend or resume a dealer. Suspension is immediate: `authenticate()` checks
   * tenant status on every request, so existing sessions stop working rather
   * than lingering until their tokens expire.
   */
  app.patch('/platform/tenants/:id/status', { preHandler: requirePlatform }, async (req) => {
    const { id } = req.params as { id: string };
    const { status } = z.object({ status: z.enum(['ACTIVE', 'SUSPENDED']) }).parse(req.body);

    const tenant = await app.prisma.tenant.findUnique({ where: { id } });
    if (!tenant) throw AppError.notFound('Dealer');
    if (tenant.status === status) return { tenant };

    const updated = await app.prisma.tenant.update({ where: { id }, data: { status } });
    await audit(req, status === 'ACTIVE' ? 'TENANT_RESUMED' : 'TENANT_SUSPENDED', {
      targetTenantId: id,
      metadata: { from: tenant.status, to: status },
    });
    return { tenant: updated };
  });

  /** Rename a dealer. The slug is immutable — it is in their URL and S3 paths. */
  app.patch('/platform/tenants/:id', { preHandler: requirePlatform }, async (req) => {
    const { id } = req.params as { id: string };
    const { name } = z.object({ name: z.string().min(1) }).parse(req.body);

    const tenant = await app.prisma.tenant.findUnique({ where: { id } });
    if (!tenant) throw AppError.notFound('Dealer');

    const updated = await app.prisma.tenant.update({ where: { id }, data: { name: name.trim() } });
    await audit(req, 'TENANT_RENAMED', { targetTenantId: id, metadata: { from: tenant.name, to: updated.name } });
    return { tenant: updated };
  });

  app.get('/platform/audit', { preHandler: requirePlatform }, async (req) => {
    const { tenantId } = req.query as { tenantId?: string };
    const entries = await app.prisma.platformAuditLog.findMany({
      where: tenantId ? { targetTenantId: tenantId } : undefined,
      orderBy: { timestamp: 'desc' },
      take: 200,
    });
    return { entries };
  });
}
