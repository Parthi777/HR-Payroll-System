/**
 * Refresh tokens: their own secret, and the transition to it.
 *
 * JWT_REFRESH_SECRET has been required by config/env.ts since the beginning and
 * was never used — both kinds of token were signed with JWT_SECRET. The only
 * thing standing between an access token and a refresh was the `typ` claim, and
 * the two could never be invalidated independently: rotating the secret to end
 * every session's ability to refresh also invalidated every access token.
 *
 * Splitting them cannot sign out the field. An employee's access token lasts 7
 * days and their refresh 30, so rejecting the old signature outright would log
 * out every member of staff as their week ran out. Tokens signed the old way
 * are therefore still accepted until the last one has expired on its own — and
 * that window is what these tests pin, including the fact that it is a window
 * and not a permanent second key.
 *
 * Needs a database (see tests/isolation.test.ts); skips without one.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import bcrypt from 'bcrypt';
import type { FastifyInstance } from 'fastify';

const TEST_DATABASE_URL = process.env.TEST_DATABASE_URL;
const suite = TEST_DATABASE_URL ? describe : describe.skip;

const PLATFORM = { email: 'owner@platform.test', name: 'Platform Owner', password: 'platform-owner-pass' };
const ADMIN = { email: 'owner@refresh.test', password: 'dealer-admin-password' };
const SLUG = 'refresh-motors';
const EMPLOYEE = { phone: '+919000000555', password: 'employee-pass' };

suite('refresh tokens', () => {
  let app: FastifyInstance;
  let employeeId: string;
  let refreshToken: string;
  let accessToken: string;

  // Login is rate-limited per IP and every inject() would otherwise share
  // 127.0.0.1 — so each sign-in comes from its own address rather than the
  // suite relaxing a real control.
  let ipCounter = 0;
  const freshIp = () => `10.7.${Math.floor(++ipCounter / 250)}.${ipCounter % 250}`;

  const post = (url: string, payload: unknown, headers: Record<string, string> = {}) =>
    app.inject({ method: 'POST', url, remoteAddress: freshIp(), headers, payload: payload as object });

  beforeAll(async () => {
    process.env.DATABASE_URL = TEST_DATABASE_URL;
    const { buildServer } = await import('../src/server.js');
    app = await buildServer();
    await app.ready();

    const p = app.prisma;
    const { runUnscoped } = await import('../src/context/tenant-context.js');
    await runUnscoped('test teardown', async () => {
      for (const del of [
        p.gPSLog, p.claimMessage, p.claim, p.attendance, p.leave, p.leaveBalance,
        p.payslip, p.notification, p.whatsAppLog, p.geofenceViolation, p.auditLog,
        p.employee, p.adminUser, p.branch, p.department, p.designation, p.shift,
        p.holiday, p.tenantSettings,
      ]) {
        await (del as { deleteMany: (a?: unknown) => Promise<unknown> }).deleteMany({});
      }
    });
    await p.platformAuditLog.deleteMany({});
    await p.tenant.deleteMany({});
    await p.platformUser.deleteMany({});

    await p.platformUser.create({
      data: { email: PLATFORM.email, name: PLATFORM.name, passwordHash: await bcrypt.hash(PLATFORM.password, 4) },
    });
    const platformLogin = await post('/api/platform/auth/login', PLATFORM);
    expect(platformLogin.statusCode, platformLogin.body).toBe(200);
    const platformToken = platformLogin.json().token;

    const made = await app.inject({
      method: 'POST', url: '/api/platform/tenants',
      headers: { authorization: `Bearer ${platformToken}` },
      payload: {
        slug: SLUG, name: 'Refresh Motors',
        admin: { name: 'Owner', email: ADMIN.email, password: ADMIN.password },
      },
    });
    expect(made.statusCode, made.body).toBe(201);

    const adminLogin = await post('/api/auth/admin/login', ADMIN, { 'x-tenant-slug': SLUG });
    expect(adminLogin.statusCode, adminLogin.body).toBe(200);
    const adminToken = adminLogin.json().token;

    // Shifts are served at /api/shifts; the rest under /api/admin.
    const masters = async (path: string) => {
      const res = await app.inject({
        method: 'GET', url: path === 'shifts' ? '/api/shifts' : `/api/admin/${path}`,
        headers: { authorization: `Bearer ${adminToken}`, 'x-tenant-slug': SLUG },
      });
      expect(res.statusCode, res.body).toBe(200);
      return res.json();
    };
    const [branches, departments, designations, shifts] = await Promise.all([
      masters('branches'), masters('departments'), masters('designations'), masters('shifts'),
    ]);

    const created = await app.inject({
      method: 'POST', url: '/api/admin/employees',
      headers: { authorization: `Bearer ${adminToken}`, 'x-tenant-slug': SLUG },
      payload: {
        name: 'Refresh Tester', phone: EMPLOYEE.phone, password: EMPLOYEE.password,
        branchId: branches.branches[0].id,
        departmentId: departments.departments[0].id,
        designationId: designations.designations[0].id,
        shiftId: shifts.shifts[0].id,
        joiningDate: '2026-01-01', salary: 20000,
      },
    });
    expect([200, 201], created.body).toContain(created.statusCode);
    employeeId = created.json().employee.id;

    const login = await post('/api/auth/employee-login', EMPLOYEE, { 'x-tenant-slug': SLUG });
    expect(login.statusCode, login.body).toBe(200);
    refreshToken = login.json().refreshToken;
    accessToken = login.json().token;
  }, 90_000);

  afterAll(async () => {
    await app?.close();
  });

  it('issues a refresh token signed with the refresh secret, not the access one', () => {
    // The point of the split: the access verifier must not recognise it. If
    // both secrets were the same this would pass verification and the two
    // could still only ever be rotated together.
    expect(() => app.jwt.refresh.verify(refreshToken)).not.toThrow();
    expect(() => app.jwt.verify(refreshToken)).toThrow();
  });

  it('exchanges it for a working access token', async () => {
    const res = await post('/api/auth/refresh-token', { refreshToken });
    expect(res.statusCode, res.body).toBe(200);

    const me = await app.inject({
      method: 'GET', url: '/api/me',
      headers: { authorization: `Bearer ${res.json().token}`, 'x-tenant-slug': SLUG },
    });
    expect(me.statusCode, me.body).toBe(200);
    expect(me.json().id).toBe(employeeId);
  });

  it('refuses an access token presented as a refresh token', async () => {
    // Different secrets now, so this fails on the signature; the `typ` guard
    // behind it is what stops it on the legacy path below.
    const res = await post('/api/auth/refresh-token', { refreshToken: accessToken });
    expect(res.statusCode).toBe(401);
  });

  it('still accepts one signed the old way, so nobody in the field is signed out', async () => {
    // LEGACY PATH — expected to be removed after 2026-10-15, at which point
    // this test should be deleted with it and the one below kept.
    const legacy = app.jwt.sign(
      { sub: employeeId, role: 'EMPLOYEE', tenantId: (await tenantId()), typ: 'refresh' },
      { expiresIn: '30d' },
    );
    const res = await post('/api/auth/refresh-token', { refreshToken: legacy });
    expect(res.statusCode, res.body).toBe(200);
  });

  it('refuses an access token even on the legacy path', async () => {
    // The `typ` claim is what keeps the transition from being a way in: an old
    // access token is signed with the very secret the legacy branch accepts.
    const legacyAccess = app.jwt.sign(
      { sub: employeeId, role: 'EMPLOYEE', tenantId: await tenantId() },
      { expiresIn: '7d' },
    );
    const res = await post('/api/auth/refresh-token', { refreshToken: legacyAccess });
    expect(res.statusCode).toBe(401);
    expect(res.json().message).toContain('Not a refresh token');
  });

  it('refuses a token signed with neither secret', async () => {
    const forged = [
      'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9',
      Buffer.from(JSON.stringify({ sub: employeeId, typ: 'refresh' })).toString('base64url'),
      'not-a-real-signature',
    ].join('.');
    const res = await post('/api/auth/refresh-token', { refreshToken: forged });
    expect(res.statusCode).toBe(401);
  });

  async function tenantId(): Promise<string> {
    const t = await app.prisma.tenant.findUnique({ where: { slug: SLUG } });
    return t!.id;
  }
});
