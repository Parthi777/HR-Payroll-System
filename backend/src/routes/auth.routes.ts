import type { FastifyInstance, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { OAuth2Client } from 'google-auth-library';
import { adminLogin, employeeLogin } from '../services/auth/auth.service.js';
import type { JwtRole } from '../middleware/auth.js';
import { runInTenant } from '../context/tenant-context.js';
import { requireTenantFromRequest, resolveTenant } from '../context/tenant-resolve.js';
import { env } from '../config/env.js';
import { AppError } from '../utils/AppError.js';

const adminLoginSchema = z.object({ email: z.string().email(), password: z.string().min(6) });
const employeeLoginSchema = z.object({ phone: z.string().min(10), password: z.string().min(1) });

const TOKEN_TTL = '7d'; // employee sessions (field staff shouldn't re-login daily)
const ADMIN_TOKEN_TTL = '12h'; // admin sessions are more sensitive — expire same day
const REFRESH_TTL = '30d';

/**
 * Auth routes — phone+password for employees, email+password (or Google) for admins.
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
  app.post('/refresh-token', async (req) => {
    const { refreshToken } = z.object({ refreshToken: z.string() }).parse(req.body);

    type Refresh = { sub: string; role: JwtRole; tenantId?: string; typ?: string };
    let decoded: Refresh;
    try {
      decoded = app.jwt.verify<Refresh>(refreshToken);
    } catch {
      throw AppError.unauthorized('Invalid or expired refresh token');
    }
    // Access and refresh tokens are signed with the same secret, so without this
    // an access token would itself be accepted here as a refresh token.
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

      const admin = await app.prisma.adminUser.findUnique({ where: { id: decoded.sub } });
      if (!admin || !admin.isActive) throw AppError.unauthorized('Account disabled');
      const token = app.jwt.sign(
        {
          sub: admin.id,
          role: admin.role as JwtRole,
          tenantId: tenant.id,
          branchId: admin.branchId ?? undefined,
        },
        { expiresIn: ADMIN_TOKEN_TTL },
      );
      return { token, refreshToken };
    });
  });

  // Password endpoints are brute-forceable — throttle per client IP (needs trustProxy
  // behind Railway's proxy, set in server.ts, or every user shares one bucket).
  app.post('/employee-login', { config: { rateLimit: { max: 10, timeWindow: '10 minutes' } } }, async (req) => {
    const { phone, password } = employeeLoginSchema.parse(req.body);
    const tenant = await tenantFor(req);

    return runInTenant({ tenantId: tenant.id, subjectId: 'login', role: 'EMPLOYEE' }, async () => {
      const employee = await employeeLogin(app.prisma, phone, password);
      const role: JwtRole = 'EMPLOYEE';
      const token = app.jwt.sign(
        { sub: employee.id, role, tenantId: tenant.id, branchId: employee.branchId },
        { expiresIn: TOKEN_TTL },
      );
      const refreshToken = app.jwt.sign(
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

  // "Sign in with Google": the web app sends a Google ID token; we verify it against
  // our Web OAuth client id, then authorize ONLY emails that already exist as active
  // AdminUsers *in this workspace*. Google proves identity; our AdminUser table
  // decides access + role.
  app.post('/admin/google', { config: { rateLimit: { max: 10, timeWindow: '10 minutes' } } }, async (req) => {
    if (!env.GOOGLE_WEB_CLIENT_ID) throw new AppError('Google login is not configured', 503);
    const { credential } = z.object({ credential: z.string().min(10) }).parse(req.body);
    const tenant = await tenantFor(req);

    const client = new OAuth2Client(env.GOOGLE_WEB_CLIENT_ID);
    let email: string | undefined;
    try {
      const ticket = await client.verifyIdToken({ idToken: credential, audience: env.GOOGLE_WEB_CLIENT_ID });
      const payload = ticket.getPayload();
      if (payload?.email_verified) email = payload.email;
    } catch {
      throw AppError.unauthorized('Invalid Google credential');
    }
    if (!email) throw AppError.unauthorized('Google account has no verified email');

    return runInTenant({ tenantId: tenant.id, subjectId: 'login', role: 'SUPER_ADMIN' }, async () => {
      // findFirst, not findUnique: email is unique per tenant now, not globally.
      const admin = await app.prisma.adminUser.findFirst({ where: { email } });
      if (!admin || !admin.isActive) {
        throw new AppError(`${email} is not an authorized admin for ${tenant.name}`, 403);
      }
      const token = app.jwt.sign(
        {
          sub: admin.id,
          role: admin.role as JwtRole,
          tenantId: tenant.id,
          branchId: admin.branchId ?? undefined,
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
    });
  });

  app.post('/admin/login', { config: { rateLimit: { max: 5, timeWindow: '10 minutes' } } }, async (req) => {
    const { email, password } = adminLoginSchema.parse(req.body);
    const tenant = await tenantFor(req);

    return runInTenant({ tenantId: tenant.id, subjectId: 'login', role: 'SUPER_ADMIN' }, async () => {
      const admin = await adminLogin(app.prisma, email, password);
      const token = app.jwt.sign(
        {
          sub: admin.id,
          role: admin.role as JwtRole,
          tenantId: tenant.id,
          branchId: admin.branchId ?? undefined,
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
    });
  });

  /** Public: the branding a login page shows before anyone has signed in. */
  app.get('/workspace/:slug', async (req) => {
    const { slug } = req.params as { slug: string };
    const tenant = await resolveTenant(app.prisma, slug.toLowerCase());
    return { slug: tenant.slug, name: tenant.name };
  });
}
