import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { OAuth2Client } from 'google-auth-library';
import { adminLogin, employeeLogin } from '../services/auth/auth.service.js';
import type { JwtRole } from '../middleware/auth.js';
import { env } from '../config/env.js';
import { AppError } from '../utils/AppError.js';

const adminLoginSchema = z.object({ email: z.string().email(), password: z.string().min(6) });
const employeeLoginSchema = z.object({ phone: z.string().min(10), password: z.string().min(1) });

const TOKEN_TTL = '7d'; // employee sessions (field staff shouldn't re-login daily)
const ADMIN_TOKEN_TTL = '12h'; // admin sessions are more sensitive — expire same day
const REFRESH_TTL = '30d';

/**
 * Auth routes — phone+password for employees, email+password (or Google) for admins.
 * Issues JWTs via @fastify/jwt (payload: { sub, role, branchId }).
 */
export async function authRoutes(app: FastifyInstance) {
  app.post('/refresh-token', async (req) => {
    const { refreshToken } = z.object({ refreshToken: z.string() }).parse(req.body);
    const decoded = app.jwt.verify<{ sub: string; role: JwtRole }>(refreshToken);
    const token = app.jwt.sign({ sub: decoded.sub, role: decoded.role }, { expiresIn: TOKEN_TTL });
    return { token, refreshToken };
  });

  // Password endpoints are brute-forceable — throttle per client IP (needs trustProxy
  // behind Railway's proxy, set in server.ts, or every user shares one bucket).
  app.post('/employee-login', { config: { rateLimit: { max: 10, timeWindow: '10 minutes' } } }, async (req) => {
    const { phone, password } = employeeLoginSchema.parse(req.body);
    const employee = await employeeLogin(app.prisma, phone, password);
    const role: JwtRole = 'EMPLOYEE';
    const token = app.jwt.sign({ sub: employee.id, role, branchId: employee.branchId }, { expiresIn: TOKEN_TTL });
    const refreshToken = app.jwt.sign({ sub: employee.id, role }, { expiresIn: REFRESH_TTL });
    return { token, refreshToken, employeeId: employee.id, name: employee.name };
  });

  // "Sign in with Google": the web app sends a Google ID token; we verify it against
  // our Web OAuth client id, then authorize ONLY emails that already exist as active
  // AdminUsers. Google proves identity; our AdminUser table decides access + role.
  app.post('/admin/google', { config: { rateLimit: { max: 10, timeWindow: '10 minutes' } } }, async (req) => {
    if (!env.GOOGLE_WEB_CLIENT_ID) throw new AppError('Google login is not configured', 503);
    const { credential } = z.object({ credential: z.string().min(10) }).parse(req.body);

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

    const admin = await app.prisma.adminUser.findUnique({ where: { email } });
    if (!admin || !admin.isActive) {
      throw new AppError(`${email} is not an authorized admin`, 403);
    }
    const token = app.jwt.sign(
      { sub: admin.id, role: admin.role as JwtRole, branchId: admin.branchId ?? undefined },
      { expiresIn: ADMIN_TOKEN_TTL },
    );
    return { token, role: admin.role, email: admin.email, name: admin.name };
  });

  app.post('/admin/login', { config: { rateLimit: { max: 5, timeWindow: '10 minutes' } } }, async (req) => {
    const { email, password } = adminLoginSchema.parse(req.body);
    const admin = await adminLogin(app.prisma, email, password);
    const token = app.jwt.sign(
      { sub: admin.id, role: admin.role as JwtRole, branchId: admin.branchId ?? undefined },
      { expiresIn: ADMIN_TOKEN_TTL },
    );
    return { token, role: admin.role, email: admin.email, name: admin.name };
  });
}
