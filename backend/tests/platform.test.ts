/**
 * The dealer onboarding flow, end to end.
 *
 * One platform administrator signs in, creates a dealer, and hands over that
 * dealer's credentials — and the two surfaces stay separate: a platform token
 * cannot read a dealer's data, and a dealer's token cannot reach the platform.
 *
 * Needs a database (see tests/isolation.test.ts); skips without one.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import bcrypt from 'bcrypt';
import type { FastifyInstance } from 'fastify';

const TEST_DATABASE_URL = process.env.TEST_DATABASE_URL;
const suite = TEST_DATABASE_URL ? describe : describe.skip;

const PLATFORM = { email: 'owner@platform.test', name: 'Platform Owner', password: 'platform-owner-pass' };
const DEALER_ADMIN_PASSWORD = 'dealer-admin-password';

suite('dealer onboarding', () => {
  let app: FastifyInstance;
  let platformToken: string;

  /**
   * Sign in to a dealer, once per account.
   *
   * Memoised deliberately: /api/auth/admin/login is rate-limited to 5 attempts
   * per 10 minutes per IP, and every inject() here shares 127.0.0.1. Logging in
   * repeatedly would trip a real security control rather than test anything.
   */
  const tokens = new Map<string, string>();
  async function dealerLogin(slug: string, email: string): Promise<string> {
    const key = `${slug}:${email}`;
    const cached = tokens.get(key);
    if (cached) return cached;
    const res = await app.inject({
      method: 'POST', url: '/api/auth/admin/login',
      headers: { 'x-tenant-slug': slug },
      payload: { email, password: DEALER_ADMIN_PASSWORD },
    });
    expect(res.statusCode, `login ${key}: ${res.body}`).toBe(200);
    tokens.set(key, res.json().token);
    return res.json().token;
  }

  const asDealer = async (slug: string, email: string, url: string) =>
    app.inject({
      method: 'GET', url,
      headers: { authorization: `Bearer ${await dealerLogin(slug, email)}`, 'x-tenant-slug': slug },
    });

  const asPlatform = (method: 'GET' | 'POST' | 'PATCH', url: string, payload?: unknown) =>
    app.inject({
      method, url,
      headers: { authorization: `Bearer ${platformToken}` },
      ...(payload === undefined ? {} : { payload: payload as object }),
    });

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
      data: {
        email: PLATFORM.email,
        name: PLATFORM.name,
        passwordHash: await bcrypt.hash(PLATFORM.password, 4),
      },
    });

    const login = await app.inject({
      method: 'POST', url: '/api/platform/auth/login',
      payload: { email: PLATFORM.email, password: PLATFORM.password },
    });
    expect(login.statusCode, login.body).toBe(200);
    platformToken = login.json().token;
  }, 60_000);

  afterAll(async () => {
    await app?.close();
  });

  describe('signing in', () => {
    it('rejects a wrong password with the same message as an unknown account', async () => {
      const wrongPassword = await app.inject({
        method: 'POST', url: '/api/platform/auth/login',
        payload: { email: PLATFORM.email, password: 'not the password' },
      });
      const unknownAccount = await app.inject({
        method: 'POST', url: '/api/platform/auth/login',
        payload: { email: 'nobody@platform.test', password: 'whatever at all' },
      });
      expect(wrongPassword.statusCode).toBe(401);
      expect(unknownAccount.statusCode).toBe(401);
      expect(wrongPassword.json().message).toBe(unknownAccount.json().message);
    });

    it('identifies the signed-in administrator', async () => {
      const res = await asPlatform('GET', '/api/platform/me');
      expect(res.statusCode).toBe(200);
      expect(res.json().email).toBe(PLATFORM.email);
    });
  });

  describe('creating a dealer', () => {
    let created: Record<string, string>;

    it('creates the workspace and its first login in one step', async () => {
      const res = await asPlatform('POST', '/api/platform/tenants', {
        slug: 'abc-motors',
        name: 'ABC Motors',
        admin: { name: 'ABC Owner', email: 'owner@abc.test', password: DEALER_ADMIN_PASSWORD },
      });
      expect(res.statusCode, res.body).toBe(201);
      created = res.json().tenant;
      expect(created.slug).toBe('abc-motors');
      expect(created.adminEmail).toBe('owner@abc.test');
      expect(created.loginUrl).toContain('abc-motors');
    });

    it('the dealer’s administrator can sign in immediately', async () => {
      const res = await app.inject({
        method: 'POST', url: '/api/auth/admin/login',
        headers: { 'x-tenant-slug': 'abc-motors' },
        payload: { email: 'owner@abc.test', password: DEALER_ADMIN_PASSWORD },
      });
      expect(res.statusCode, res.body).toBe(200);
      expect(res.json().role).toBe('SUPER_ADMIN');
      expect(res.json().tenant.name).toBe('ABC Motors');
      tokens.set('abc-motors:owner@abc.test', res.json().token);
    });

    it('gives the dealer a working branch, department, designation and shift', async () => {
      for (const [url, key] of [
        ['/api/admin/branches', 'branches'],
        ['/api/admin/departments', 'departments'],
        ['/api/admin/designations', 'designations'],
        ['/api/shifts', 'shifts'],
      ] as const) {
        const res = await asDealer('abc-motors', 'owner@abc.test', url);
        expect(res.statusCode, `${url}: ${res.body}`).toBe(200);
        expect((res.json() as Record<string, unknown[]>)[key], url).toHaveLength(1);
      }
    });

    it('refuses a duplicate address', async () => {
      const res = await asPlatform('POST', '/api/platform/tenants', {
        slug: 'abc-motors', name: 'Someone Else',
        admin: { name: 'X', email: 'x@x.test', password: DEALER_ADMIN_PASSWORD },
      });
      expect(res.statusCode).toBe(409);
    });

    it('refuses an address that is not a valid subdomain', async () => {
      const res = await asPlatform('POST', '/api/platform/tenants', {
        slug: 'ABC Motors!', name: 'Bad Slug',
        admin: { name: 'X', email: 'x@x.test', password: DEALER_ADMIN_PASSWORD },
      });
      expect(res.statusCode).toBe(400);
    });

    it('refuses a weak administrator password', async () => {
      const res = await asPlatform('POST', '/api/platform/tenants', {
        slug: 'weak-pass', name: 'Weak',
        admin: { name: 'X', email: 'x@x.test', password: 'short' },
      });
      // 422: the route schema rejects it before the service's own check, the
      // same as every other invalid payload in this API.
      expect(res.statusCode).toBe(422);
    });

    it('adds a further login to an existing dealer', async () => {
      const list = await asPlatform('GET', '/api/platform/tenants');
      const id = list.json().tenants.find((t: { slug: string }) => t.slug === 'abc-motors').id;

      const res = await asPlatform('POST', `/api/platform/tenants/${id}/admins`, {
        name: 'ABC HR', email: 'hr@abc.test', password: DEALER_ADMIN_PASSWORD, role: 'HR_MANAGER',
      });
      expect(res.statusCode, res.body).toBe(201);

      const check = await asDealer('abc-motors', 'hr@abc.test', '/api/admin/branches');
      expect(check.statusCode, check.body).toBe(200);
    });

    it('the same email can administer two different dealers', async () => {
      const res = await asPlatform('POST', '/api/platform/tenants', {
        slug: 'xyz-autos', name: 'XYZ Autos',
        // Deliberately the address already used at abc-motors.
        admin: { name: 'Shared Person', email: 'owner@abc.test', password: DEALER_ADMIN_PASSWORD },
      });
      expect(res.statusCode, res.body).toBe(201);

      const res2 = await app.inject({
        method: 'POST', url: '/api/auth/admin/login',
        headers: { 'x-tenant-slug': 'xyz-autos' },
        payload: { email: 'owner@abc.test', password: DEALER_ADMIN_PASSWORD },
      });
      expect(res2.statusCode, res2.body).toBe(200);
      expect(res2.json().tenant.name).toBe('XYZ Autos');
      tokens.set('xyz-autos:owner@abc.test', res2.json().token);
    });
  });


  describe('each dealer has its own settings', () => {
    const settingsOf = async (slug: string, email: string) => {
      const res = await asDealer(slug, email, '/api/admin/company');
      expect(res.statusCode, res.body).toBe(200);
      return res.json().company;
    };

    it('provisioning namespaces the external resources per dealer', async () => {
      // Faces are the one that matters: a shared Rekognition collection would
      // let one dealer's employee be recognised as another's.
      const abc = await settingsOf('abc-motors', 'owner@abc.test');
      const xyz = await settingsOf('xyz-autos', 'owner@abc.test');

      expect(abc.rekognitionCollectionId).not.toBe(xyz.rekognitionCollectionId);
      expect(abc.rekognitionCollectionId).toContain('abc-motors');
      expect(xyz.rekognitionCollectionId).toContain('xyz-autos');

      expect(abc.s3Prefix).toBe('t/abc-motors/');
      expect(xyz.s3Prefix).toBe('t/xyz-autos/');
    });

    it('one dealer changing its payroll policy does not touch another', async () => {
      const token = await dealerLogin('abc-motors', 'owner@abc.test');
      const before = await settingsOf('xyz-autos', 'owner@abc.test');

      const put = await app.inject({
        method: 'PUT', url: '/api/admin/company',
        headers: { authorization: `Bearer ${token}`, 'x-tenant-slug': 'abc-motors' },
        payload: { payrollPayDay: 10, clPerYear: 20, employeeCodePrefix: 'ABC' },
      });
      expect(put.statusCode, put.body).toBe(200);

      const abc = await settingsOf('abc-motors', 'owner@abc.test');
      expect(abc.payrollPayDay).toBe(10);
      expect(abc.clPerYear).toBe(20);
      expect(abc.employeeCodePrefix).toBe('ABC');

      const after = await settingsOf('xyz-autos', 'owner@abc.test');
      expect(after.payrollPayDay).toBe(before.payrollPayDay);
      expect(after.clPerYear).toBe(before.clPerYear);
    });

    it('the employee code series uses the dealer’s own prefix', async () => {
      const abc = await asDealer('abc-motors', 'owner@abc.test', '/api/admin/employees/next-code');
      expect(abc.statusCode, abc.body).toBe(200);
      expect(abc.json().nextCode).toMatch(/^ABC\d{3}$/);

      const xyz = await asDealer('xyz-autos', 'owner@abc.test', '/api/admin/employees/next-code');
      expect(xyz.json().nextCode).not.toContain('ABC');
    });

    it('rejects a face-match threshold low enough to be meaningless', async () => {
      const token = await dealerLogin('abc-motors', 'owner@abc.test');
      const res = await app.inject({
        method: 'PUT', url: '/api/admin/company',
        headers: { authorization: `Bearer ${token}`, 'x-tenant-slug': 'abc-motors' },
        payload: { faceMatchThreshold: 10 },
      });
      expect(res.statusCode).toBe(422);
    });
  });

  describe('the two surfaces stay separate', () => {
    it('a platform token cannot reach a dealer’s data', async () => {
      const res = await app.inject({
        method: 'GET', url: '/api/admin/employees',
        headers: { authorization: `Bearer ${platformToken}`, 'x-tenant-slug': 'abc-motors' },
      });
      expect(res.statusCode).toBe(403);
    });

    it('a dealer’s token cannot reach the platform API', async () => {
      const token = await dealerLogin('abc-motors', 'owner@abc.test');
      const res = await app.inject({
        method: 'GET', url: '/api/platform/tenants',
        headers: { authorization: `Bearer ${token}` },
      });
      expect(res.statusCode).toBe(403);
    });

    it('the platform API refuses an unauthenticated caller', async () => {
      const res = await app.inject({ method: 'GET', url: '/api/platform/tenants' });
      expect(res.statusCode).toBe(401);
    });
  });

  describe('suspending a dealer', () => {
    it('stops existing sessions immediately, and resuming restores them', async () => {
      const list = await asPlatform('GET', '/api/platform/tenants');
      const id = list.json().tenants.find((t: { slug: string }) => t.slug === 'xyz-autos').id;

      const token = await dealerLogin('xyz-autos', 'owner@abc.test');
      const headers = { authorization: `Bearer ${token}`, 'x-tenant-slug': 'xyz-autos' };
      const first = await app.inject({ method: 'GET', url: '/api/admin/branches', headers });
      expect(first.statusCode, `branches before suspend: ${first.body}`).toBe(200);

      expect((await asPlatform('PATCH', `/api/platform/tenants/${id}/status`, { status: 'SUSPENDED' })).statusCode).toBe(200);

      // The token is still valid and unexpired; the tenant's status is what stops it.
      expect((await app.inject({ method: 'GET', url: '/api/admin/branches', headers })).statusCode).toBe(403);
      const blocked = await app.inject({
        method: 'POST', url: '/api/auth/admin/login',
        headers: { 'x-tenant-slug': 'xyz-autos' },
        payload: { email: 'owner@abc.test', password: DEALER_ADMIN_PASSWORD },
      });
      expect(blocked.statusCode).toBe(403);

      await asPlatform('PATCH', `/api/platform/tenants/${id}/status`, { status: 'ACTIVE' });
      expect((await app.inject({ method: 'GET', url: '/api/admin/branches', headers })).statusCode).toBe(200);
    });
  });

  describe('audit trail', () => {
    it('records every platform action, and never the passwords', async () => {
      const res = await asPlatform('GET', '/api/platform/audit');
      expect(res.statusCode).toBe(200);
      const entries = res.json().entries as { action: string; metadata: string | null }[];

      const actions = entries.map((e) => e.action);
      expect(actions).toContain('TENANT_CREATED');
      expect(actions).toContain('TENANT_ADMIN_CREATED');
      expect(actions).toContain('TENANT_SUSPENDED');
      expect(actions).toContain('TENANT_RESUMED');

      const recorded = JSON.stringify(entries);
      expect(recorded, 'a password reached the audit log').not.toContain(DEALER_ADMIN_PASSWORD);
      expect(recorded).not.toContain(PLATFORM.password);
    });
  });
});
