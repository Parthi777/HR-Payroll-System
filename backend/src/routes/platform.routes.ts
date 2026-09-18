import type { FastifyInstance, FastifyRequest } from 'fastify';
import { z } from 'zod';
import bcrypt from 'bcrypt';
import { requirePlatform, type JwtPayload, type JwtRole } from '../middleware/auth.js';
import { AppError } from '../utils/AppError.js';
import { env } from '../config/env.js';
import { parseAllowList, platformAccessHook } from '../services/platform/platform-access.js';
import {
  CHALLENGE_TTL,
  TWO_STEP_CLEARED,
  acceptTotp,
  assertNotLocked,
  completeEnrolment,
  consumeRecoveryCode,
  generateRecoveryCodes,
  looksLikeTotp,
  recordFailure,
  recoveryCodesLeft,
  startEnrolment,
  type ChallengePurpose,
} from '../services/platform/two-step.service.js';
import {
  addTenantAdmin,
  provisionTenant,
  tenantLoginUrl,
} from '../services/platform/tenant-provisioning.service.js';

const PLATFORM_TOKEN_TTL = '8h'; // this account can create and suspend dealers

const loginSchema = z.object({ email: z.string().email(), password: z.string().min(1) });

const challengeSchema = z.object({ challenge: z.string().min(1) });
const challengeCodeSchema = z.object({ challenge: z.string().min(1), code: z.string().trim().min(1).max(32) });
const codeSchema = z.object({ code: z.string().trim().min(1).max(32) });

/** What the console may show about a colleague — never a hash or a secret. */
const STAFF_SELECT = {
  id: true, name: true, email: true, isActive: true, createdAt: true, totpEnabledAt: true,
} as const;

function staffView({ totpEnabledAt, ...rest }: {
  id: string; name: string; email: string; isActive: boolean; createdAt: Date; totpEnabledAt: Date | null;
}) {
  return { ...rest, twoStepEnabled: totpEnabledAt !== null };
}

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

const storageSchema = z.object({
  driveParentFolderId: z.string().trim().nullable().optional(),
  driveShareWith: z.string().trim().email('That does not look like an email address').nullable().optional(),
});

/**
 * Accept either a bare folder id or a pasted Drive URL — people copy the address
 * bar, not the id, and silently storing "https://drive.google.com/..." as an id
 * would fail later at upload time with nothing to point at.
 */
function driveFolderId(raw: string): string {
  const id = (raw.match(/\/folders\/([A-Za-z0-9_-]+)/)?.[1] ?? raw).trim();
  if (!/^[A-Za-z0-9_-]{10,}$/.test(id)) {
    throw new AppError(`"${raw}" is not a Drive folder id or folder link`, 400);
  }
  return id;
}

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
  // Before every route below, and before their rate limits: an address that is
  // not allowed should not even use up a sign-in attempt. This plugin is
  // encapsulated, so the hook guards the platform routes and nothing else.
  const allowList = parseAllowList(env.PLATFORM_ALLOWED_IPS);
  if (allowList) app.addHook('onRequest', platformAccessHook(allowList));

  /**
   * Record a platform action. Best-effort: it must never fail the action.
   *
   * `actorId` is for the sign-in steps, which run before there is a session to
   * read the actor from.
   */
  async function audit(
    req: FastifyRequest,
    action: string,
    detail: { targetTenantId?: string; targetId?: string; metadata?: unknown; actorId?: string },
  ) {
    try {
      await app.prisma.platformAuditLog.create({
        data: {
          platformUserId: detail.actorId ?? req.user.sub,
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

    // A correct password is half a sign-in. It earns a challenge — good for
    // nothing but the next step — and never a session. Which step comes next
    // depends on whether this person has an authenticator set up yet.
    const step: ChallengePurpose = staff.totpSecret ? 'verify' : 'enroll';
    return { step, challenge: signChallenge(staff.id, step) };
  });

  function signChallenge(staffId: string, purpose: ChallengePurpose): string {
    return app.jwt.sign(
      { sub: staffId, role: 'PLATFORM_ADMIN' as JwtRole, scope: 'PLATFORM_CHALLENGE' as const, purpose },
      { expiresIn: CHALLENGE_TTL[purpose] },
    );
  }

  /** The account a challenge was issued to, if it is still valid for this step. */
  async function readChallenge(challenge: string, purpose: ChallengePurpose) {
    let payload: JwtPayload;
    try {
      payload = app.jwt.verify<JwtPayload>(challenge);
    } catch {
      throw AppError.unauthorized('This sign-in has expired — enter your password again');
    }
    if (payload.scope !== 'PLATFORM_CHALLENGE' || payload.purpose !== purpose) {
      throw AppError.unauthorized('This sign-in has expired — enter your password again');
    }
    const staff = await app.prisma.platformUser.findUnique({ where: { id: payload.sub } });
    // Deactivated between the two steps counts as not signing in.
    if (!staff || !staff.isActive) throw AppError.unauthorized('Invalid email or password');
    return staff;
  }

  function signSession(staff: { id: string; name: string; email: string }) {
    const token = app.jwt.sign(
      { sub: staff.id, role: 'PLATFORM_ADMIN' as JwtRole, scope: 'PLATFORM' as const, twoStep: true as const },
      { expiresIn: PLATFORM_TOKEN_TTL },
    );
    return { token, name: staff.name, email: staff.email };
  }

  /**
   * A wrong code: counted against the account, and the lock recorded if this
   * was the one that tripped it — a lock means someone holds the password.
   */
  async function wrongCode(req: FastifyRequest, staffId: string): Promise<never> {
    const { locked } = await recordFailure(app.prisma, { id: staffId });
    if (locked) await audit(req, 'PLATFORM_TWO_STEP_LOCKED', { actorId: staffId, targetId: staffId });
    throw AppError.unauthorized('That code is not right');
  }

  // Second step, for an account that is already enrolled. Takes either the
  // six digits from the authenticator app or one of the recovery codes.
  app.post(
    '/platform/auth/two-step/verify',
    { config: { rateLimit: { max: 10, timeWindow: '10 minutes' } } },
    async (req) => {
      const { challenge, code } = challengeCodeSchema.parse(req.body);
      const staff = await readChallenge(challenge, 'verify');
      if (!staff.totpSecret) throw AppError.unauthorized('This sign-in has expired — enter your password again');
      assertNotLocked(staff);

      if (looksLikeTotp(code)) {
        if (!(await acceptTotp(app.prisma, staff, staff.totpSecret, code))) return wrongCode(req, staff.id);
        return signSession(staff);
      }

      const left = await consumeRecoveryCode(app.prisma, staff, code);
      if (left === null) return wrongCode(req, staff.id);
      // Worth a line in the log every time: either the phone is lost, or the
      // codes are no longer only in the owner's hands.
      await audit(req, 'PLATFORM_RECOVERY_CODE_USED', { actorId: staff.id, targetId: staff.id, metadata: { left } });
      return { ...signSession(staff), recoveryCodesLeft: left };
    },
  );

  // Enrolment, step one: a secret to scan. Replaces any half-finished attempt.
  app.post(
    '/platform/auth/two-step/setup',
    { config: { rateLimit: { max: 10, timeWindow: '10 minutes' } } },
    async (req) => {
      const { challenge } = challengeSchema.parse(req.body);
      const staff = await readChallenge(challenge, 'enroll');
      return startEnrolment(app.prisma, staff);
    },
  );

  // Enrolment, step two: a code from the new authenticator proves the scan
  // worked. Only then is the secret live, and the recovery codes are returned
  // — once, never again.
  app.post(
    '/platform/auth/two-step/enable',
    { config: { rateLimit: { max: 10, timeWindow: '10 minutes' } } },
    async (req) => {
      const { challenge, code } = challengeCodeSchema.parse(req.body);
      const staff = await readChallenge(challenge, 'enroll');
      assertNotLocked(staff);

      const recoveryCodes = await completeEnrolment(app.prisma, staff, code);
      if (!recoveryCodes) return wrongCode(req, staff.id);

      await audit(req, 'PLATFORM_TWO_STEP_ENABLED', { actorId: staff.id, targetId: staff.id });
      return { ...signSession(staff), recoveryCodes };
    },
  );

  app.get('/platform/me', { preHandler: requirePlatform }, async (req) => {
    const staff = await app.prisma.platformUser.findUnique({
      where: { id: req.user.sub },
      select: { id: true, name: true, email: true, totpEnabledAt: true, recoveryCodes: true },
    });
    if (!staff) throw AppError.notFound('Account');
    return {
      id: staff.id,
      name: staff.name,
      email: staff.email,
      twoStep: { enabledAt: staff.totpEnabledAt, recoveryCodesLeft: recoveryCodesLeft(staff) },
    };
  });

  /**
   * Replace your recovery codes — after using some, or if the printout went
   * missing. Needs a live code from the authenticator, not just the session:
   * a stolen token must not be able to mint itself a way back in.
   */
  app.post(
    '/platform/me/recovery-codes',
    { preHandler: requirePlatform, config: { rateLimit: { max: 5, timeWindow: '10 minutes' } } },
    async (req) => {
      const { code } = codeSchema.parse(req.body);
      const staff = await app.prisma.platformUser.findUnique({ where: { id: req.user.sub } });
      if (!staff) throw AppError.notFound('Account');
      if (!staff.totpSecret) throw new AppError('Set up two-step verification first — sign out and in again', 400);
      assertNotLocked(staff);

      if (!(await acceptTotp(app.prisma, staff, staff.totpSecret, code))) return wrongCode(req, staff.id);

      const { codes, stored } = generateRecoveryCodes();
      await app.prisma.platformUser.update({ where: { id: staff.id }, data: { recoveryCodes: stored } });
      await audit(req, 'PLATFORM_RECOVERY_CODES_REGENERATED', {});
      return { recoveryCodes: codes };
    },
  );

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
      select: STAFF_SELECT,
      orderBy: { createdAt: 'asc' },
    });
    return { staff: staff.map(staffView) };
  });

  app.post('/platform/users', { preHandler: requirePlatform }, async (req, reply) => {
    const input = newStaffSchema.parse(req.body);
    const email = input.email.trim().toLowerCase();

    const clash = await app.prisma.platformUser.findUnique({ where: { email } });
    if (clash) throw new AppError(`${email} already has a platform account`, 409);

    const created = await app.prisma.platformUser.create({
      data: { name: input.name.trim(), email, passwordHash: await bcrypt.hash(input.password, 12) },
      select: STAFF_SELECT,
    });
    await audit(req, 'PLATFORM_USER_CREATED', { targetId: created.id, metadata: { email: created.email } });

    return reply.code(201).send({ staff: staffView(created) });
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
      select: STAFF_SELECT,
    });

    if (input.isActive !== undefined) {
      await audit(req, input.isActive ? 'PLATFORM_USER_REACTIVATED' : 'PLATFORM_USER_DEACTIVATED', {
        targetId: id, metadata: { email: target.email },
      });
    }
    if (input.password) {
      await audit(req, 'PLATFORM_USER_PASSWORD_RESET', { targetId: id, metadata: { email: target.email } });
    }

    return { staff: staffView(updated) };
  });

  /**
   * Clear a colleague's two-step verification, for a lost or replaced phone.
   * Their next sign-in walks them through enrolment again.
   *
   * Never your own: that would let a stolen session strip the second step off
   * the account it was stolen from. Losing your own phone is what recovery
   * codes are for, then a colleague, then scripts/reset-platform-two-step.ts.
   */
  app.delete('/platform/users/:id/two-step', { preHandler: requirePlatform }, async (req) => {
    const { id } = req.params as { id: string };
    if (id === req.user.sub) {
      throw new AppError('You cannot reset your own two-step verification — ask another administrator', 400);
    }
    const target = await app.prisma.platformUser.findUnique({ where: { id } });
    if (!target) throw AppError.notFound('Account');

    const updated = await app.prisma.platformUser.update({
      where: { id },
      data: TWO_STEP_CLEARED,
      select: STAFF_SELECT,
    });
    await audit(req, 'PLATFORM_USER_TWO_STEP_RESET', { targetId: id, metadata: { email: target.email } });
    return { staff: staffView(updated) };
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

    // Where this dealer's claim files, selfies and faces live. Read here rather
    // than on the dealer's own settings screen: a dealer that could edit its own
    // Drive folder could point it at another dealer's and read their receipts.
    const settings = await app.prisma.tenantSettings.findFirst({
      where: { tenantId: id },
      select: {
        driveParentFolderId: true, driveShareWith: true,
        s3Prefix: true, rekognitionCollectionId: true,
      },
    });

    return {
      tenant: { ...tenant, loginUrl: tenantLoginUrl(tenant.slug) },
      admins,
      employees,
      storage: settings ?? {
        driveParentFolderId: null, driveShareWith: null,
        s3Prefix: '', rekognitionCollectionId: null,
      },
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
   * Point a dealer at its own Drive folder.
   *
   * Only the platform can set this. A folder id is a capability: whoever holds
   * it can read and write everything inside, so a dealer able to edit its own
   * would simply enter a rival's and collect their receipts. The same reasoning
   * is why the folder is never inherited from the environment — see
   * services/settings/tenant-settings.service.ts.
   *
   * Two dealers may never share a folder, so a folder already claimed by another
   * dealer is refused here rather than discovered later as mixed-up receipts.
   */
  app.patch('/platform/tenants/:id/storage', { preHandler: requirePlatform }, async (req) => {
    const { id } = req.params as { id: string };
    const input = storageSchema.parse(req.body);

    const tenant = await app.prisma.tenant.findUnique({ where: { id } });
    if (!tenant) throw AppError.notFound('Dealer');

    const folder = input.driveParentFolderId ? driveFolderId(input.driveParentFolderId) : null;
    const shareWith = input.driveShareWith || null;

    if (folder) {
      const clash = await app.prisma.tenantSettings.findFirst({
        where: { driveParentFolderId: folder, NOT: { tenantId: id } },
        select: { tenantId: true },
      });
      if (clash) {
        const other = await app.prisma.tenant.findUnique({ where: { id: clash.tenantId } });
        throw new AppError(
          `That folder already belongs to ${other?.name ?? 'another dealer'}. ` +
            'Each dealer needs a folder of its own, or their claim files end up in the same place.',
          409,
        );
      }
    }

    const before = await app.prisma.tenantSettings.findFirst({
      where: { tenantId: id },
      select: { driveParentFolderId: true, driveShareWith: true },
    });

    // A dealer provisioned before this existed may have no settings row yet.
    const saved = await app.prisma.tenantSettings.upsert({
      where: { tenantId: id },
      update: { driveParentFolderId: folder, driveShareWith: shareWith },
      create: { tenantId: id, name: tenant.name, driveParentFolderId: folder, driveShareWith: shareWith },
      select: {
        driveParentFolderId: true, driveShareWith: true,
        s3Prefix: true, rekognitionCollectionId: true,
      },
    });

    await audit(req, 'TENANT_STORAGE_UPDATED', {
      targetTenantId: id,
      metadata: {
        driveParentFolderId: folder,
        driveShareWith: shareWith,
        previousFolder: before?.driveParentFolderId ?? null,
      },
    });

    return { storage: saved };
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
