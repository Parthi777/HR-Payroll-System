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

const changePasswordSchema = z.object({
  currentPassword: z.string().min(1),
  newPassword: z.string().min(12, 'Use at least 12 characters'),
});

const newStaffSchema = z.object({
  name: z.string().min(1),
  email: z.string().email(),
  password: z.string().min(12, 'Use at least 12 characters'),
});

const updateStaffSchema = z.object({
  name: z.string().min(1).optional(),
  isActive: z.boolean().optional(),
  password: z.string().min(12, 'Use at least 12 characters').optional(),
});

const auditQuerySchema = z.object({
  tenantId: z.string().optional(),
  actorId: z.string().optional(),
  action: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(200).default(50),
  cursor: z.string().optional(),
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

  /**
   * Change your own password.
   *
   * Requires the current one. A platform token is enough to reach this route,
   * so without that check anyone holding a stolen token could lock the real
   * owner out of the account that manages every dealer.
   *
   * Rate-limited like a sign-in, because it verifies a password and is
   * therefore something worth guessing at.
   */
  app.patch(
    '/platform/me/password',
    { preHandler: requirePlatform, config: { rateLimit: { max: 5, timeWindow: '10 minutes' } } },
    async (req) => {
      const { currentPassword, newPassword } = changePasswordSchema.parse(req.body);

      const staff = await app.prisma.platformUser.findUnique({ where: { id: req.user.sub } });
      if (!staff) throw AppError.notFound('Account');
      if (!(await bcrypt.compare(currentPassword, staff.passwordHash))) {
        throw AppError.unauthorized('That is not your current password');
      }
      if (await bcrypt.compare(newPassword, staff.passwordHash)) {
        throw new AppError('The new password must be different from the current one', 400);
      }

      await app.prisma.platformUser.update({
        where: { id: staff.id },
        data: { passwordHash: await bcrypt.hash(newPassword, 12) },
      });

      // Recorded as an event; the passwords themselves never reach the log.
      await audit(req, 'PLATFORM_PASSWORD_CHANGED', {});

      return { ok: true };
    },
  );

  // ── Platform team ──
  //
  // The people who can onboard dealers. Accounts are deactivated, never
  // deleted, because the audit log references them and a log that points at a
  // vanished actor is worse than no log.

  app.get('/platform/users', { preHandler: requirePlatform }, async () => {
    const staff = await app.prisma.platformUser.findMany({
      select: { id: true, name: true, email: true, isActive: true, createdAt: true },
      orderBy: { createdAt: 'asc' },
    });
    return { staff };
  });

  app.post('/platform/users', { preHandler: requirePlatform }, async (req, reply) => {
    const input = newStaffSchema.parse(req.body);
    const email = input.email.trim().toLowerCase();

    const clash = await app.prisma.platformUser.findUnique({ where: { email } });
    if (clash) throw new AppError(`${email} already has a platform account`, 409);

    const created = await app.prisma.platformUser.create({
      data: { name: input.name.trim(), email, passwordHash: await bcrypt.hash(input.password, 12) },
      select: { id: true, name: true, email: true, isActive: true, createdAt: true },
    });
    await audit(req, 'PLATFORM_USER_CREATED', { targetId: created.id, metadata: { email: created.email } });

    return reply.code(201).send({ staff: created });
  });

  app.patch('/platform/users/:id', { preHandler: requirePlatform }, async (req) => {
    const { id } = req.params as { id: string };
    const input = updateStaffSchema.parse(req.body);

    const target = await app.prisma.platformUser.findUnique({ where: { id } });
    if (!target) throw AppError.notFound('Account');

    // Nobody may lock the whole platform out of dealer onboarding. The self
    // check is the one that fires in practice; the count below cannot be
    // reached while requirePlatform rejects an inactive caller (an active
    // caller means the count is at least two), and is kept so the invariant
    // survives a change to either guard.
    if (input.isActive === false) {
      if (id === req.user.sub) throw new AppError('You cannot deactivate your own account', 400);
      const active = await app.prisma.platformUser.count({ where: { isActive: true } });
      if (active <= 1) throw new AppError('Cannot deactivate the last active administrator', 409);
    }

    const updated = await app.prisma.platformUser.update({
      where: { id },
      data: {
        ...(input.name ? { name: input.name.trim() } : {}),
        ...(input.isActive !== undefined ? { isActive: input.isActive } : {}),
        ...(input.password ? { passwordHash: await bcrypt.hash(input.password, 12) } : {}),
      },
      select: { id: true, name: true, email: true, isActive: true, createdAt: true },
    });

    if (input.isActive !== undefined) {
      await audit(req, input.isActive ? 'PLATFORM_USER_REACTIVATED' : 'PLATFORM_USER_DEACTIVATED', {
        targetId: id, metadata: { email: target.email },
      });
    }
    if (input.password) {
      await audit(req, 'PLATFORM_USER_PASSWORD_RESET', { targetId: id, metadata: { email: target.email } });
    }

    return { staff: updated };
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

  /**
   * The activity log.
   *
   * Stored rows name their actor and their dealer by id, because ids are what
   * stay true — a renamed dealer or a renamed administrator must not rewrite
   * history. Nobody can read ids, so they are resolved to names here, on the
   * way out, and a row whose dealer has since been deleted still renders.
   *
   * Paged by cursor rather than offset: entries arrive while someone is
   * reading, and an offset would show them a row twice or skip one.
   */
  app.get('/platform/audit', { preHandler: requirePlatform }, async (req) => {
    const q = auditQuerySchema.parse(req.query);

    const where = {
      ...(q.tenantId ? { targetTenantId: q.tenantId } : {}),
      ...(q.actorId ? { platformUserId: q.actorId } : {}),
      ...(q.action ? { action: q.action } : {}),
    };

    // One row over the asked-for page: its existence is what says there is
    // more, without a second count query over the whole log.
    const page = await app.prisma.platformAuditLog.findMany({
      where,
      // Id breaks ties on timestamp. Two entries can share one — deactivating
      // an account and resetting its password are written by a single request —
      // and without a total order the cursor could skip a row or serve it twice.
      orderBy: [{ timestamp: 'desc' }, { id: 'desc' }],
      take: q.limit + 1,
      ...(q.cursor ? { cursor: { id: q.cursor }, skip: 1 } : {}),
    });
    const rows = page.slice(0, q.limit);
    const nextCursor = page.length > q.limit ? (rows[rows.length - 1]?.id ?? null) : null;

    const [actorsById, tenantsById] = await Promise.all([
      namesFor(rows.map((r) => r.platformUserId)),
      dealersFor(rows.map((r) => r.targetTenantId)),
    ]);

    const entries = rows.map((r) => {
      const dealer = r.targetTenantId ? tenantsById.get(r.targetTenantId) : undefined;
      return {
        id: r.id,
        action: r.action,
        actorId: r.platformUserId,
        // Deactivated staff still resolve — accounts are never deleted, which
        // is exactly so this line can never read "unknown".
        actorName: actorsById.get(r.platformUserId) ?? 'A removed account',
        targetTenantId: r.targetTenantId,
        tenantName: dealer?.name ?? null,
        tenantSlug: dealer?.slug ?? null,
        targetId: r.targetId,
        metadata: r.metadata,
        ipAddress: r.ipAddress,
        timestamp: r.timestamp,
      };
    });

    // The filter options describe the whole log, not this page — otherwise the
    // dropdown loses an option as soon as you scroll past its last entry. Sent
    // with the first page only; paging back for more does not need them again.
    const filters = q.cursor ? undefined : await auditFilterOptions();

    return { entries, nextCursor, ...(filters ? { filters } : {}) };
  });

  /** Resolve platform staff ids to names, in one query. */
  async function namesFor(ids: string[]): Promise<Map<string, string>> {
    const unique = [...new Set(ids)];
    if (unique.length === 0) return new Map();
    const people = await app.prisma.platformUser.findMany({
      where: { id: { in: unique } },
      select: { id: true, name: true },
    });
    return new Map(people.map((p) => [p.id, p.name]));
  }

  /** Resolve dealer ids to name and slug, in one query. */
  async function dealersFor(ids: (string | null)[]): Promise<Map<string, { name: string; slug: string }>> {
    const unique = [...new Set(ids.filter((id): id is string => id !== null))];
    if (unique.length === 0) return new Map();
    const tenants = await app.prisma.tenant.findMany({
      where: { id: { in: unique } },
      select: { id: true, name: true, slug: true },
    });
    return new Map(tenants.map((t) => [t.id, { name: t.name, slug: t.slug }]));
  }

  /**
   * Who has ever acted, and what kinds of action exist — grouped in the
   * database rather than counted in the page, so the filters cover the whole
   * log however long it grows.
   */
  async function auditFilterOptions() {
    const [byActor, byAction, byTenant] = await Promise.all([
      app.prisma.platformAuditLog.groupBy({ by: ['platformUserId'], _count: { _all: true } }),
      app.prisma.platformAuditLog.groupBy({ by: ['action'], _count: { _all: true } }),
      app.prisma.platformAuditLog.groupBy({
        by: ['targetTenantId'],
        where: { targetTenantId: { not: null } },
        _count: { _all: true },
      }),
    ]);

    const [names, dealers] = await Promise.all([
      namesFor(byActor.map((a) => a.platformUserId)),
      dealersFor(byTenant.map((t) => t.targetTenantId)),
    ]);

    return {
      actors: byActor
        .map((a) => ({
          id: a.platformUserId,
          name: names.get(a.platformUserId) ?? 'A removed account',
          count: a._count._all,
        }))
        .sort((a, b) => b.count - a.count),
      actions: byAction
        .map((a) => ({ action: a.action, count: a._count._all }))
        .sort((a, b) => b.count - a.count),
      // Only dealers that appear in the log: a filter that can only ever
      // return nothing is worse than no filter.
      dealers: byTenant
        .flatMap((t) => {
          const dealer = t.targetTenantId ? dealers.get(t.targetTenantId) : undefined;
          return dealer ? [{ id: t.targetTenantId as string, name: dealer.name, count: t._count._all }] : [];
        })
        .sort((a, b) => a.name.localeCompare(b.name)),
    };
  }
}
