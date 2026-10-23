import type { FastifyInstance, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { adminLogin, employeeLogin } from '../services/auth/auth.service.js';
import type { JwtPayload, JwtRole } from '../middleware/auth.js';
import { runInTenant } from '../context/tenant-context.js';
import { requireTenantFromRequest, resolveTenant, tenantSlugFromRequest } from '../context/tenant-resolve.js';
import { AppError } from '../utils/AppError.js';
import { recordAudit } from '../services/audit/audit.service.js';
import { mailConfigured } from '../services/mail/mail.service.js';
import {
  RESET_TTL_MINUTES,
  completeAdminPasswordReset,
  issueAdminPasswordReset,
} from '../services/auth/password-reset.service.js';
import {
  CHALLENGE_TTL,
  acceptTotp,
  assertNotLocked,
  completeEnrolment,
  consumeRecoveryCode,
  looksLikeTotp,
  recordFailure,
  startEnrolment,
  type ChallengePurpose,
} from '../services/auth/two-step.service.js';

const adminLoginSchema = z.object({ email: z.string().email(), password: z.string().min(6) });
/**
 * `userId` is the employee code or the phone number. `phone` is what app
 * versions before employee-code sign-in send, and is still accepted so an
 * installed app keeps working until it updates.
 */
const employeeLoginSchema = z
  .object({ userId: z.string().trim().min(1).optional(), phone: z.string().trim().min(1).optional(), password: z.string().min(1) })
  .refine((b) => b.userId || b.phone, { message: 'Enter your employee ID or phone number', path: ['userId'] });
const forgotSchema = z.object({ email: z.string().trim().email() });
const resetSchema = z.object({ token: z.string().min(20).max(200), password: z.string().min(12) });
const challengeSchema = z.object({ challenge: z.string().min(1) });
const challengeCodeSchema = z.object({ challenge: z.string().min(1), code: z.string().trim().min(1).max(32) });

const TOKEN_TTL = '7d'; // employee sessions (field staff shouldn't re-login daily)
const ADMIN_TOKEN_TTL = '12h'; // admin sessions are more sensitive — expire same day
const REFRESH_TTL = '30d';

/**
 * Auth routes — employee code (or phone) + password for employees; email +
 * password + a code from an authenticator app for every Master Control account.
 * Credentials are only ever issued by an administrator: there is no self sign-up
 * and no third-party sign-in.
 * Issues JWTs via @fastify/jwt (payload: { sub, role, tenantId, branchId }).
 *
 * Every login resolves the tenant FIRST — from the subdomain, or the
 * X-Tenant-Slug header the Android app sends — and then checks credentials
 * *inside* that tenant's context. The credential lookup is therefore scoped by
 * the same extension that scopes everything else, so no unscoped bypass is
 * needed anywhere in the auth path, and one tenant's phone number can never
 * resolve to another tenant's employee.
 */
export async function authRoutes(app: FastifyInstance) {
  /** The workspace this login is for, or a clear 400 explaining what's missing. */
  const tenantFor = (req: FastifyRequest) => requireTenantFromRequest(app.prisma, req);

  /**
   * Exchange a refresh token for a fresh access token.
   *
   * Claims are rebuilt from the database, never copied out of the presented
   * token. That is what makes deactivation actually take effect, keeps the
   * admin TTL at 12h instead of silently widening it to 7d, and preserves
   * `branchId` and `tenantId` — dropping either used to widen access on the
   * next refresh.
   */
  app.post(
    '/refresh-token',
    // Unauthenticated, and it verifies a token and reads the database. Every
    // other auth route was throttled and this one was not. Loose enough for a
    // branch coming online together on one office address — a device refreshes
    // at most once every 12h (admin) or 7d (employee) — and tight enough that
    // it is not free to hammer.
    { config: { rateLimit: { max: 30, timeWindow: '10 minutes' } } },
    async (req) => {
    const { refreshToken } = z.object({ refreshToken: z.string() }).parse(req.body);

    type Refresh = { sub: string; role: JwtRole; tenantId?: string; typ?: string; twoStep?: true };
    let decoded: Refresh;
    try {
      decoded = app.jwt.refresh.verify<Refresh>(refreshToken);
    } catch {
      // Only JWT_REFRESH_SECRET. Refresh tokens signed with JWT_SECRET were
      // accepted for one REFRESH_TTL after the secrets were split; that window
      // closed on 2026-10-15, so every such token has expired on its own.
      throw AppError.unauthorized('Invalid or expired refresh token');
    }
    // An access token must never be spendable as a refresh token. The secrets
    // differ, so the signature check already refuses one; this costs nothing
    // and holds even if the two were ever set to the same value.
    if (decoded.typ !== 'refresh') throw AppError.unauthorized('Not a refresh token');
    if (!decoded.tenantId) throw AppError.unauthorized('Session is out of date — please sign in again');

    const tenant = await app.prisma.tenant.findUnique({
      where: { id: decoded.tenantId },
      select: { id: true, name: true, status: true },
    });
    if (!tenant) throw AppError.unauthorized('Workspace no longer exists');
    if (tenant.status !== 'ACTIVE') {
      throw new AppError(`The ${tenant.name} workspace is suspended — please contact support.`, 403);
    }

    return runInTenant({ tenantId: tenant.id, subjectId: decoded.sub, role: decoded.role }, async () => {
      if (decoded.role === 'EMPLOYEE') {
        const employee = await app.prisma.employee.findUnique({ where: { id: decoded.sub } });
        if (!employee || employee.status !== 'ACTIVE') {
          throw AppError.unauthorized('Account disabled — contact HR');
        }
        const token = app.jwt.sign(
          { sub: employee.id, role: 'EMPLOYEE', tenantId: tenant.id, branchId: employee.branchId },
          { expiresIn: TOKEN_TTL },
        );
        return { token, refreshToken };
      }

      // An admin session is only ever minted after the second step, so a
      // refresh token without that proof cannot be turned into one either.
      if (decoded.twoStep !== true) {
        throw AppError.unauthorized('Please sign in again — two-step verification is now required');
      }
      const admin = await app.prisma.adminUser.findUnique({ where: { id: decoded.sub } });
      if (!admin || !admin.isActive) throw AppError.unauthorized('Account disabled');
      const token = app.jwt.sign(
        {
          sub: admin.id,
          role: admin.role as JwtRole,
          tenantId: tenant.id,
          branchId: admin.branchId ?? undefined,
          twoStep: true,
        },
        { expiresIn: ADMIN_TOKEN_TTL },
      );
      return { token, refreshToken };
    });
  });

  // Password endpoints are brute-forceable — throttle per client IP (needs trustProxy
  // behind Railway's proxy, set in server.ts, or every user shares one bucket).
  app.post('/employee-login', { config: { rateLimit: { max: 10, timeWindow: '10 minutes' } } }, async (req) => {
    const body = employeeLoginSchema.parse(req.body);
    const tenant = await tenantFor(req);

    return runInTenant({ tenantId: tenant.id, subjectId: 'login', role: 'EMPLOYEE' }, async () => {
      const employee = await employeeLogin(app.prisma, (body.userId ?? body.phone)!, body.password);
      const role: JwtRole = 'EMPLOYEE';
      const token = app.jwt.sign(
        { sub: employee.id, role, tenantId: tenant.id, branchId: employee.branchId },
        { expiresIn: TOKEN_TTL },
      );
      const refreshToken = app.jwt.refresh.sign(
        { sub: employee.id, role, tenantId: tenant.id, typ: 'refresh' },
        { expiresIn: REFRESH_TTL },
      );
      return {
        token,
        refreshToken,
        employeeId: employee.id,
        name: employee.name,
        tenant: { slug: tenant.slug, name: tenant.name },
      };
    });
  });

  // A correct password is half a sign-in. It earns a challenge — good for
  // nothing but the second step — and never a session. Which step comes next
  // depends on whether this person has an authenticator set up yet; an account
  // that has never enrolled (every account from before this, and every one a
  // Super Admin creates) is walked through enrolment instead of being let in.
  app.post('/admin/login', { config: { rateLimit: { max: 5, timeWindow: '10 minutes' } } }, async (req) => {
    const { email, password } = adminLoginSchema.parse(req.body);
    const tenant = await tenantFor(req);

    return runInTenant({ tenantId: tenant.id, subjectId: 'login', role: 'SUPER_ADMIN' }, async () => {
      const admin = await adminLogin(app.prisma, email, password);
      const step: ChallengePurpose = admin.totpSecret ? 'verify' : 'enroll';
      return {
        step,
        challenge: signChallenge(admin.id, tenant.id, step),
        tenant: { slug: tenant.slug, name: tenant.name },
      };
    });
  });

  function signChallenge(adminId: string, tenantId: string, purpose: ChallengePurpose): string {
    return app.jwt.sign(
      { sub: adminId, role: 'SUPER_ADMIN' as JwtRole, tenantId, scope: 'ADMIN_CHALLENGE' as const, purpose },
      { expiresIn: CHALLENGE_TTL[purpose] },
    );
  }

  /**
   * Run `fn` as the account a challenge was issued to, inside the tenant it was
   * issued in. The tenant comes from the challenge, not the request — but a
   * request that names a workspace must name that one, as everywhere else.
   */
  async function withChallenge<T>(
    req: FastifyRequest,
    challenge: string,
    purpose: ChallengePurpose,
    fn: (ctx: {
      tenant: { id: string; slug: string; name: string };
      admin: NonNullable<Awaited<ReturnType<typeof app.prisma.adminUser.findUnique>>>;
    }) => Promise<T>,
  ): Promise<T> {
    const expired = () => AppError.unauthorized('This sign-in has expired — enter your password again');
    let payload: JwtPayload;
    try {
      payload = app.jwt.verify<JwtPayload>(challenge);
    } catch {
      throw expired();
    }
    if (payload.scope !== 'ADMIN_CHALLENGE' || payload.purpose !== purpose || !payload.tenantId) throw expired();

    const tenant = await app.prisma.tenant.findUnique({
      where: { id: payload.tenantId },
      select: { id: true, slug: true, name: true, status: true },
    });
    if (!tenant) throw expired();
    if (tenant.status !== 'ACTIVE') {
      throw new AppError(`The ${tenant.name} workspace is suspended — please contact support.`, 403);
    }
    const named = tenantSlugFromRequest(req);
    if (named && named !== tenant.slug) throw expired();

    return runInTenant({ tenantId: tenant.id, subjectId: payload.sub, role: 'SUPER_ADMIN' }, async () => {
      const admin = await app.prisma.adminUser.findUnique({ where: { id: payload.sub } });
      // Deactivated between the two steps counts as not signing in.
      if (!admin || !admin.isActive) throw AppError.unauthorized('Invalid email or password');
      return fn({ tenant, admin });
    });
  }

  /** A completed sign-in: noted on the account (for the console's health view), then the session. */
  async function startAdminSession(
    tenant: { id: string; slug: string; name: string },
    admin: { id: string; role: string; branchId: string | null; email: string; name: string },
  ) {
    await app.prisma.adminUser.update({ where: { id: admin.id }, data: { lastSignInAt: new Date() } });
    return signAdminSession(tenant, admin);
  }

  /** The session — the same token admin sign-in always returned, now proven by a second step. */
  function signAdminSession(
    tenant: { id: string; slug: string; name: string },
    admin: { id: string; role: string; branchId: string | null; email: string; name: string },
  ) {
    const token = app.jwt.sign(
      {
        sub: admin.id,
        role: admin.role as JwtRole,
        tenantId: tenant.id,
        branchId: admin.branchId ?? undefined,
        twoStep: true,
      },
      { expiresIn: ADMIN_TOKEN_TTL },
    );
    return {
      token,
      role: admin.role,
      email: admin.email,
      name: admin.name,
      tenant: { slug: tenant.slug, name: tenant.name },
    };
  }

  /**
   * A wrong code: counted against the account, and the lock recorded if this
   * was the one that tripped it — a lock means someone holds the password.
   */
  async function wrongCode(req: FastifyRequest, admin: { id: string; email: string }): Promise<never> {
    const { locked } = await recordFailure(app.prisma, 'admin', admin);
    if (locked) {
      await recordAudit(req, 'ADMIN_TWO_STEP_LOCKED', 'AdminUser', {
        actorId: admin.id, entityId: admin.id, metadata: { account: admin.email },
      });
    }
    throw AppError.unauthorized('That code is not right');
  }

  // Second step, for an account that is already enrolled. Takes either the six
  // digits from the authenticator app or one of the recovery codes.
  app.post('/admin/two-step/verify', { config: { rateLimit: { max: 10, timeWindow: '10 minutes' } } }, async (req) => {
    const { challenge, code } = challengeCodeSchema.parse(req.body);
    return withChallenge(req, challenge, 'verify', async ({ tenant, admin }) => {
      if (!admin.totpSecret) throw AppError.unauthorized('This sign-in has expired — enter your password again');
      assertNotLocked(admin);

      if (looksLikeTotp(code)) {
        if (!(await acceptTotp(app.prisma, 'admin', admin, admin.totpSecret, code))) return wrongCode(req, admin);
        return startAdminSession(tenant, admin);
      }

      const left = await consumeRecoveryCode(app.prisma, 'admin', admin, code);
      if (left === null) return wrongCode(req, admin);
      // Worth a line every time: either the phone is lost, or the codes are no
      // longer only in the owner's hands.
      await recordAudit(req, 'ADMIN_RECOVERY_CODE_USED', 'AdminUser', {
        actorId: admin.id, entityId: admin.id, metadata: { account: admin.email, left },
      });
      return { ...(await startAdminSession(tenant, admin)), recoveryCodesLeft: left };
    });
  });

  // Enrolment, step one: a secret to scan. Replaces any half-finished attempt.
  app.post('/admin/two-step/setup', { config: { rateLimit: { max: 10, timeWindow: '10 minutes' } } }, async (req) => {
    const { challenge } = challengeSchema.parse(req.body);
    return withChallenge(req, challenge, 'enroll', ({ tenant, admin }) =>
      startEnrolment(app.prisma, 'admin', admin, `${admin.email} (${tenant.name})`),
    );
  });

  // Enrolment, step two: a code from the new authenticator proves the scan
  // worked. Only then is the secret live, and the recovery codes are returned
  // — once, never again.
  app.post('/admin/two-step/enable', { config: { rateLimit: { max: 10, timeWindow: '10 minutes' } } }, async (req) => {
    const { challenge, code } = challengeCodeSchema.parse(req.body);
    return withChallenge(req, challenge, 'enroll', async ({ tenant, admin }) => {
      assertNotLocked(admin);
      const recoveryCodes = await completeEnrolment(app.prisma, 'admin', admin, code);
      if (!recoveryCodes) return wrongCode(req, admin);

      await recordAudit(req, 'ADMIN_TWO_STEP_ENABLED', 'AdminUser', {
        actorId: admin.id, entityId: admin.id, metadata: { account: admin.email },
      });
      return { ...(await startAdminSession(tenant, admin)), recoveryCodes };
    });
  });

  /**
   * "Forgot password?" — email a one-time link to a Master Control login.
   *
   * The same answer whether or not the address has an account here, and the
   * mail goes out after the response rather than before it, so neither the
   * words nor the timing say which addresses are registered. Without SMTP
   * configured it says so plainly: a reset that silently never arrives is
   * worse than being told to ask a Super Admin.
   */
  app.post('/admin/forgot-password', { config: { rateLimit: { max: 5, timeWindow: '10 minutes' } } }, async (req) => {
    const { email } = forgotSchema.parse(req.body);
    const tenant = await tenantFor(req);
    if (!mailConfigured()) {
      throw new AppError('Password reset by email is not set up yet — ask a Super Admin to reset your password from User Access.', 503);
    }

    await runInTenant({ tenantId: tenant.id, subjectId: 'password-reset', role: 'SUPER_ADMIN' }, async () => {
      const issued = await issueAdminPasswordReset(app.prisma, tenant, email);
      if (!issued) return;
      await recordAudit(req, 'ADMIN_PASSWORD_RESET_REQUESTED', 'AdminUser', {
        actorId: issued.admin.id, entityId: issued.admin.id, metadata: { account: issued.admin.email },
      });
      void issued.send().catch((err) => req.log.error({ err }, 'password reset email failed'));
    });

    return {
      ok: true,
      message: `If ${email} has a login at ${tenant.name}, a link to set a new password is on its way. It works for ${RESET_TTL_MINUTES} minutes.`,
    };
  });

  /** Spend the emailed link. Sign-in afterwards still needs the authenticator code. */
  app.post('/admin/reset-password', { config: { rateLimit: { max: 10, timeWindow: '10 minutes' } } }, async (req) => {
    const { token, password } = resetSchema.parse(req.body);
    const tenant = await tenantFor(req);

    return runInTenant({ tenantId: tenant.id, subjectId: 'password-reset', role: 'SUPER_ADMIN' }, async () => {
      const admin = await completeAdminPasswordReset(app.prisma, token, password);
      await recordAudit(req, 'ADMIN_PASSWORD_RESET_BY_EMAIL', 'AdminUser', {
        actorId: admin.id, entityId: admin.id, metadata: { account: admin.email },
      });
      return { ok: true, email: admin.email, tenant: { slug: tenant.slug, name: tenant.name } };
    });
  });

  /**
   * Public: must the sign-in page ask which workspace this is?
   *
   * One shared address (admin.<domain>) serves every dealer, so the page has to
   * know whether to ask before it asks for a password — asking everyone would
   * be friction on a deployment with one dealer, and asking nobody would make
   * the first sign-in fail on a deployment with several.
   *
   * Yes or no, and nothing else. It never names a customer or hints how many
   * there are beyond "more than one", which submitting any sign-in would reveal
   * anyway. Throttled like the lookup below.
   */
  app.get('/workspace', { config: { rateLimit: { max: 20, timeWindow: '10 minutes' } } }, async (req) => {
    if (tenantSlugFromRequest(req)) return { required: false };
    const active = await app.prisma.tenant.count({ where: { status: 'ACTIVE' } });
    return { required: active !== 1 };
  });

  /**
   * Public: the branding a login page shows before anyone has signed in.
   *
   * It has to be public — it is what puts a dealer's name on their own sign-in
   * page before there is a session — and it therefore confirms whether a slug
   * belongs to a customer, and names them. That cannot be hidden without
   * removing the feature, so it is throttled instead: enough for real sign-ins,
   * far too slow to walk a dictionary of names through.
   */
  app.get('/workspace/:slug', { config: { rateLimit: { max: 20, timeWindow: '10 minutes' } } }, async (req) => {
    const { slug } = req.params as { slug: string };
    const tenant = await resolveTenant(app.prisma, slug.toLowerCase());
    return { slug: tenant.slug, name: tenant.name };
  });
}
