import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { OAuth2Client } from 'google-auth-library';
import { createOtp, verifyOtp, adminLogin, employeeLogin } from '../services/auth/auth.service.js';
import type { JwtRole } from '../middleware/auth.js';
import { env } from '../config/env.js';
import { AppError } from '../utils/AppError.js';

const sendOtpSchema = z.object({ phone: z.string().min(10) });
// TEMP (dev): OTP disabled — otp may be blank/omitted. Restore z.string().length(6) to re-enable.
const verifyOtpSchema = z.object({ phone: z.string().min(10), otp: z.string().optional().default('') });
const adminLoginSchema = z.object({ email: z.string().email(), password: z.string().min(6) });
const employeeLoginSchema = z.object({ phone: z.string().min(10), password: z.string().min(1) });

const TOKEN_TTL = '7d'; // employee sessions (field staff shouldn't re-login daily)
const ADMIN_TOKEN_TTL = '12h'; // admin sessions are more sensitive — expire same day
const REFRESH_TTL = '30d';

/**
 * Auth routes — phone+OTP for employees, email+password for admins.
 * Issues JWTs via @fastify/jwt (payload: { sub, role, branchId }).
 */
export async function authRoutes(app: FastifyInstance) {
  // Rate-limit OTP: 3 attempts per 10 minutes in prod (see CLAUDE.md Security);
  // relaxed in dev (DEV_FIXED_OTP set) so repeated testing doesn't trip a 429.
  const otpMax = env.DEV_FIXED_OTP ? 100 : 3;
  app.post('/send-otp', { config: { rateLimit: { max: otpMax, timeWindow: '10 minutes' } } }, async (req) => {
    const { phone } = sendOtpSchema.parse(req.body);
    const code = await createOtp(app.prisma, phone);
    req.log.info({ phone, trigger: 'OTP_SENT' }, 'OTP generated'); // phone redacted by logger
    // TODO: dispatch `code` via SMS/WhatsApp. Dev exposes it so login is testable without a provider.
    return { sent: true, ...(env.NODE_ENV !== 'production' ? { devOtp: code } : {}) };
  });

  app.post('/verify-otp', async (req) => {
    const { phone, otp } = verifyOtpSchema.parse(req.body);
    const employee = await verifyOtp(app.prisma, phone, otp);
    const role: JwtRole = 'EMPLOYEE';
    const token = app.jwt.sign({ sub: employee.id, role, branchId: employee.branchId }, { expiresIn: TOKEN_TTL });
    const refreshToken = app.jwt.sign({ sub: employee.id, role }, { expiresIn: REFRESH_TTL });
    return { token, refreshToken, employeeId: employee.id, name: employee.name };
  });

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
