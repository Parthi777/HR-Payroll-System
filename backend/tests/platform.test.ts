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
import { currentCode, platformSignIn } from './support/platform-session.js';
import { codeForStep, stepAt } from '../src/services/platform/totp.js';

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
  /**
   * A distinct client IP per sign-in.
   *
   * Login is rate-limited to 5 attempts per 10 minutes per IP, and every
   * inject() would otherwise share 127.0.0.1 — so the suite would trip a real
   * security control rather than test anything. Real users come from different
   * addresses; this reproduces that instead of relaxing the limit.
   */
  let ipCounter = 0;
  const freshIp = () => `10.0.${Math.floor(++ipCounter / 250)}.${ipCounter % 250}`;

  const tokens = new Map<string, string>();
  async function dealerLogin(slug: string, email: string): Promise<string> {
    const key = `${slug}:${email}`;
    const cached = tokens.get(key);
    if (cached) return cached;
    const res = await app.inject({
      method: 'POST', url: '/api/auth/admin/login', remoteAddress: freshIp(),
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

    platformToken = await platformSignIn(app, PLATFORM, freshIp);
  }, 60_000);

  afterAll(async () => {
    await app?.close();
  });

  describe('signing in', () => {
    it('rejects a wrong password with the same message as an unknown account', async () => {
      const wrongPassword = await app.inject({
        method: 'POST', url: '/api/platform/auth/login',
        remoteAddress: freshIp(),
        payload: { email: PLATFORM.email, password: 'not the password' },
      });
      const unknownAccount = await app.inject({
        method: 'POST', url: '/api/platform/auth/login',
        remoteAddress: freshIp(),
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
        method: 'POST', url: '/api/auth/admin/login', remoteAddress: freshIp(),
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
        method: 'POST', url: '/api/auth/admin/login', remoteAddress: freshIp(),
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

  describe('claim file storage is set per dealer, by the platform only', () => {
    const tenantIdOf = async (slug: string) => {
      const res = await asPlatform('GET', '/api/platform/tenants');
      const found = res.json().tenants.find((t: { slug: string }) => t.slug === slug);
      expect(found, `no dealer ${slug}`).toBeTruthy();
      return found.id as string;
    };

    const storageOf = async (slug: string) => {
      const res = await asPlatform('GET', `/api/platform/tenants/${await tenantIdOf(slug)}`);
      expect(res.statusCode, res.body).toBe(200);
      return res.json().storage;
    };

    it('starts unset, so claim files fall back to S3 rather than a shared folder', async () => {
      expect((await storageOf('abc-motors')).driveParentFolderId).toBeNull();
    });

    it('sets a dealer’s own folder', async () => {
      const res = await asPlatform('PATCH', `/api/platform/tenants/${await tenantIdOf('abc-motors')}/storage`, {
        driveParentFolderId: 'abcMotorsFolder123',
        driveShareWith: 'hr@abc.test',
      });
      expect(res.statusCode, res.body).toBe(200);

      const saved = await storageOf('abc-motors');
      expect(saved.driveParentFolderId).toBe('abcMotorsFolder123');
      expect(saved.driveShareWith).toBe('hr@abc.test');
    });

    it('takes the id out of a pasted Drive link', async () => {
      const res = await asPlatform('PATCH', `/api/platform/tenants/${await tenantIdOf('xyz-autos')}/storage`, {
        driveParentFolderId: 'https://drive.google.com/drive/folders/xyzAutosFolder99?usp=sharing',
      });
      expect(res.statusCode, res.body).toBe(200);
      expect((await storageOf('xyz-autos')).driveParentFolderId).toBe('xyzAutosFolder99');
    });

    it('refuses a folder another dealer already uses', async () => {
      // The whole point of the field: two dealers sharing a folder would file
      // their receipts together, which is what this guard exists to stop.
      const res = await asPlatform('PATCH', `/api/platform/tenants/${await tenantIdOf('xyz-autos')}/storage`, {
        driveParentFolderId: 'abcMotorsFolder123',
      });
      expect(res.statusCode, res.body).toBe(409);
      expect(res.json().message).toContain('ABC Motors');

      // and the attempt changed nothing
      expect((await storageOf('xyz-autos')).driveParentFolderId).toBe('xyzAutosFolder99');
    });

    it('lets a dealer keep its own folder on a re-save', async () => {
      const res = await asPlatform('PATCH', `/api/platform/tenants/${await tenantIdOf('abc-motors')}/storage`, {
        driveParentFolderId: 'abcMotorsFolder123',
        driveShareWith: 'newhr@abc.test',
      });
      expect(res.statusCode, res.body).toBe(200);
      expect((await storageOf('abc-motors')).driveShareWith).toBe('newhr@abc.test');
    });

    it('rejects something that is not a folder id', async () => {
      const res = await asPlatform('PATCH', `/api/platform/tenants/${await tenantIdOf('abc-motors')}/storage`, {
        driveParentFolderId: 'my folder',
      });
      expect(res.statusCode).toBe(400);
    });

    it('clears the folder when emptied', async () => {
      const id = await tenantIdOf('xyz-autos');
      expect((await asPlatform('PATCH', `/api/platform/tenants/${id}/storage`, {
        driveParentFolderId: null, driveShareWith: null,
      })).statusCode).toBe(200);

      const saved = await storageOf('xyz-autos');
      expect(saved.driveParentFolderId).toBeNull();
      expect(saved.driveShareWith).toBeNull();
    });

    it('refuses a dealer’s own administrator — a folder id is a capability', async () => {
      const token = await dealerLogin('abc-motors', 'owner@abc.test');
      const res = await app.inject({
        method: 'PATCH', url: `/api/platform/tenants/${await tenantIdOf('xyz-autos')}/storage`,
        headers: { authorization: `Bearer ${token}`, 'x-tenant-slug': 'abc-motors' },
        payload: { driveParentFolderId: 'stolenFolder123' },
      });
      expect([401, 403]).toContain(res.statusCode);
      expect((await storageOf('xyz-autos')).driveParentFolderId).toBeNull();
    });

    it('records the change in the activity log', async () => {
      const res = await asPlatform('GET', `/api/platform/audit?tenantId=${await tenantIdOf('abc-motors')}`);
      expect(res.statusCode, res.body).toBe(200);
      const entry = res.json().entries.find((e: { action: string }) => e.action === 'TENANT_STORAGE_UPDATED');
      expect(entry, 'no TENANT_STORAGE_UPDATED entry').toBeTruthy();
      // Stored as a JSON string; the console parses it the same way.
      expect(JSON.parse(entry.metadata).driveParentFolderId).toBe('abcMotorsFolder123');
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
        method: 'POST', url: '/api/auth/admin/login', remoteAddress: freshIp(),
        headers: { 'x-tenant-slug': 'xyz-autos' },
        payload: { email: 'owner@abc.test', password: DEALER_ADMIN_PASSWORD },
      });
      expect(blocked.statusCode).toBe(403);

      await asPlatform('PATCH', `/api/platform/tenants/${id}/status`, { status: 'ACTIVE' });
      expect((await app.inject({ method: 'GET', url: '/api/admin/branches', headers })).statusCode).toBe(200);
    });
  });


  describe('signing in without naming a workspace', () => {
    /**
     * The transitional fallback that lets the backend ship before the clients
     * do. It must resolve when there is exactly one dealer, and must refuse —
     * not guess — once there is more than one.
     */
    it('refuses once more than one dealer exists', async () => {
      const res = await app.inject({
        method: 'POST', url: '/api/auth/admin/login', remoteAddress: freshIp(),
        payload: { email: 'owner@abc.test', password: DEALER_ADMIN_PASSWORD },
      });
      expect(res.statusCode).toBe(400);
      expect(res.json().message).toContain('which workspace');
    });

    it('resolves to the only dealer when just one is active', async () => {
      const list = await asPlatform('GET', '/api/platform/tenants');
      const others = list.json().tenants.filter((t: { slug: string }) => t.slug !== 'abc-motors');
      for (const t of others) {
        await asPlatform('PATCH', `/api/platform/tenants/${t.id}/status`, { status: 'SUSPENDED' });
      }
      try {
        const res = await app.inject({
          method: 'POST', url: '/api/auth/admin/login', remoteAddress: freshIp(),
          payload: { email: 'owner@abc.test', password: DEALER_ADMIN_PASSWORD },
        });
        expect(res.statusCode, res.body).toBe(200);
        expect(res.json().tenant.slug).toBe('abc-motors');
      } finally {
        for (const t of others) {
          await asPlatform('PATCH', `/api/platform/tenants/${t.id}/status`, { status: 'ACTIVE' });
        }
      }
    });
  });

  describe('the platform team', () => {
    const COLLEAGUE = { name: 'Second Owner', email: 'second@platform.test', password: 'colleague-first-password' };
    let colleagueId: string;

    const platformLogin = (email: string, password: string) =>
      app.inject({
        method: 'POST', url: '/api/platform/auth/login',
        remoteAddress: freshIp(),
        payload: { email, password },
      });

    it('lists the team', async () => {
      const res = await asPlatform('GET', '/api/platform/users');
      expect(res.statusCode).toBe(200);
      const staff = res.json().staff as { email: string; isActive: boolean }[];
      expect(staff.map((s) => s.email)).toContain(PLATFORM.email);
      expect(staff.every((s) => !('passwordHash' in s)), 'the hash was serialised').toBe(true);
      for (const secret of ['totpSecret', 'totpPendingSecret', 'recoveryCodes']) {
        expect(res.body, `${secret} was serialised`).not.toContain(secret);
      }
    });

    it('adds a second administrator who can then sign in', async () => {
      const res = await asPlatform('POST', '/api/platform/users', COLLEAGUE);
      expect(res.statusCode, res.body).toBe(201);
      colleagueId = res.json().staff.id;

      const login = await platformLogin(COLLEAGUE.email, COLLEAGUE.password);
      expect(login.statusCode, 'the new administrator cannot sign in').toBe(200);
      // A new account has no authenticator yet, so it is sent to enrol.
      expect(login.json().step).toBe('enroll');
      expect(login.json().token).toBeUndefined();
      await platformSignIn(app, COLLEAGUE, freshIp);
    });

    it('refuses an email that already has an account', async () => {
      const res = await asPlatform('POST', '/api/platform/users', { ...COLLEAGUE, name: 'Someone Else' });
      expect(res.statusCode).toBe(409);
    });

    it('refuses a password under 12 characters', async () => {
      const res = await asPlatform('POST', '/api/platform/users', {
        name: 'Too Easy', email: 'weak@platform.test', password: 'short',
      });
      expect(res.statusCode).toBe(422);
    });

    it('refuses to let you deactivate yourself', async () => {
      const me = await asPlatform('GET', '/api/platform/me');
      const res = await asPlatform(`PATCH`, `/api/platform/users/${me.json().id}`, { isActive: false });
      expect(res.statusCode).toBe(400);
    });

    it('resets a colleague’s password, and the old one stops working', async () => {
      const next = 'a-brand-new-password';
      const res = await asPlatform('PATCH', `/api/platform/users/${colleagueId}`, { password: next });
      expect(res.statusCode, res.body).toBe(200);

      expect((await platformLogin(COLLEAGUE.email, COLLEAGUE.password)).statusCode).toBe(401);
      expect((await platformLogin(COLLEAGUE.email, next)).statusCode).toBe(200);
      COLLEAGUE.password = next;
    });

    it('deactivating locks the account out on the next request, not at token expiry', async () => {
      // A token minted while they were active must stop working immediately —
      // otherwise revoking access means waiting up to 8 hours.
      const stillValid = await platformSignIn(app, COLLEAGUE, freshIp);

      const off = await asPlatform('PATCH', `/api/platform/users/${colleagueId}`, { isActive: false });
      expect(off.statusCode, off.body).toBe(200);
      expect(off.json().staff.isActive).toBe(false);

      const withOldToken = await app.inject({
        method: 'GET', url: '/api/platform/tenants',
        headers: { authorization: `Bearer ${stillValid}` },
      });
      expect(withOldToken.statusCode).toBe(401);
      expect((await platformLogin(COLLEAGUE.email, COLLEAGUE.password)).statusCode).toBe(401);
    });

    it('reactivating restores access', async () => {
      const on = await asPlatform('PATCH', `/api/platform/users/${colleagueId}`, { isActive: true });
      expect(on.statusCode).toBe(200);
      expect((await platformLogin(COLLEAGUE.email, COLLEAGUE.password)).statusCode).toBe(200);
    });

    it('is unreachable with a dealer’s own sign-in', async () => {
      const res = await asDealer('abc-motors', 'owner@abc.test', '/api/platform/users');
      expect(res.statusCode).toBe(403);
    });

    it('records the changes without recording the passwords', async () => {
      const res = await asPlatform('GET', '/api/platform/audit');
      const actions = (res.json().entries as { action: string }[]).map((e) => e.action);
      expect(actions).toContain('PLATFORM_USER_CREATED');
      expect(actions).toContain('PLATFORM_USER_DEACTIVATED');
      expect(actions).toContain('PLATFORM_USER_REACTIVATED');
      expect(actions).toContain('PLATFORM_USER_PASSWORD_RESET');
      expect(JSON.stringify(res.json())).not.toContain(COLLEAGUE.password);
    });
  });

  describe('two-step verification', () => {
    const ACCOUNT = { name: 'Two Step', email: 'twostep@platform.test', password: 'two-step-password-1' };
    let accountId: string;
    let secret: string;
    let recoveryCodes: string[];

    const post = (url: string, payload: object, headers: Record<string, string> = {}) =>
      app.inject({ method: 'POST', url, remoteAddress: freshIp(), headers, payload });

    /** The password step, asserting which second step it asks for. */
    async function passwordStep(expected: 'verify' | 'enroll'): Promise<string> {
      const res = await post('/api/platform/auth/login', { email: ACCOUNT.email, password: ACCOUNT.password });
      expect(res.statusCode, res.body).toBe(200);
      expect(res.json().step).toBe(expected);
      return res.json().challenge;
    }

    const lastStep = async () =>
      (await app.prisma.platformUser.findUniqueOrThrow({ where: { id: accountId } })).totpLastStep!;

    const auditFor = async (action: string) =>
      (await asPlatform('GET', `/api/platform/audit?action=${action}`)).json().entries as { targetId: string | null }[];

    beforeAll(async () => {
      const res = await asPlatform('POST', '/api/platform/users', ACCOUNT);
      expect(res.statusCode, res.body).toBe(201);
      accountId = res.json().staff.id;
    });

    it('a correct password alone never yields a session', async () => {
      const res = await post('/api/platform/auth/login', { email: ACCOUNT.email, password: ACCOUNT.password });
      expect(res.statusCode).toBe(200);
      expect(res.json()).not.toHaveProperty('token');

      // The challenge it does return opens nothing — not the console, not a dealer.
      const { challenge } = res.json();
      const console = await app.inject({
        method: 'GET', url: '/api/platform/tenants', headers: { authorization: `Bearer ${challenge}` },
      });
      expect(console.statusCode).toBe(403);
      const dealer = await app.inject({
        method: 'GET', url: '/api/admin/employees',
        headers: { authorization: `Bearer ${challenge}`, 'x-tenant-slug': 'abc-motors' },
      });
      expect(dealer.statusCode).toBe(403);
    });

    it('ends console sessions that never passed a second step', async () => {
      // What every session issued before two-step verification existed looks like.
      const legacy = app.jwt.sign({ sub: accountId, role: 'PLATFORM_ADMIN', scope: 'PLATFORM' }, { expiresIn: '8h' });
      const res = await app.inject({
        method: 'GET', url: '/api/platform/me', headers: { authorization: `Bearer ${legacy}` },
      });
      expect(res.statusCode).toBe(401);
    });

    it('enrols: scan a secret, confirm it with a code, get recovery codes once', async () => {
      const challenge = await passwordStep('enroll');

      // An enrolment challenge is not a sign-in, and cannot confirm a secret it was never shown.
      expect((await post('/api/platform/auth/two-step/verify', { challenge, code: '123456' })).statusCode).toBe(401);
      expect((await post('/api/platform/auth/two-step/enable', { challenge, code: '123456' })).statusCode).toBe(400);

      const setup = await post('/api/platform/auth/two-step/setup', { challenge });
      expect(setup.statusCode, setup.body).toBe(200);
      secret = setup.json().secret;
      expect(setup.json().otpauthUri).toContain(`secret=${secret}`);

      const wrong = await post('/api/platform/auth/two-step/enable', {
        challenge, code: codeForStep(secret, stepAt(Date.now()) - 5),
      });
      expect(wrong.statusCode).toBe(401);
      // A half-finished setup changes nothing.
      await passwordStep('enroll');

      const enabled = await post('/api/platform/auth/two-step/enable', {
        challenge, code: codeForStep(secret, stepAt(Date.now())),
      });
      expect(enabled.statusCode, enabled.body).toBe(200);
      recoveryCodes = enabled.json().recoveryCodes;
      expect(recoveryCodes).toHaveLength(10);
      expect(new Set(recoveryCodes).size).toBe(10);

      const me = await app.inject({
        method: 'GET', url: '/api/platform/me', headers: { authorization: `Bearer ${enabled.json().token}` },
      });
      expect(me.statusCode, me.body).toBe(200);
      expect(me.json().twoStep.recoveryCodesLeft).toBe(10);
      expect(me.json().twoStep.enabledAt).toBeTruthy();

      // Enrolled now, so the same challenge cannot enrol a second secret over it.
      expect((await post('/api/platform/auth/two-step/setup', { challenge })).statusCode).toBe(409);
      await passwordStep('verify');

      expect((await auditFor('PLATFORM_TWO_STEP_ENABLED')).some((e) => e.targetId === accountId)).toBe(true);
      const team = await asPlatform('GET', '/api/platform/users');
      const row = (team.json().staff as { id: string; twoStepEnabled: boolean }[]).find((s) => s.id === accountId);
      expect(row?.twoStepEnabled).toBe(true);
    });

    it('stores recovery codes only as hashes', async () => {
      const row = await app.prisma.platformUser.findUniqueOrThrow({ where: { id: accountId } });
      for (const code of recoveryCodes) {
        expect(row.recoveryCodes).not.toContain(code);
        expect(row.recoveryCodes).not.toContain(code.replace('-', ''));
      }
    });

    it('signs in with an authenticator code, and never twice with the same code', async () => {
      // The code that confirmed enrolment is already spent.
      const spent = await lastStep();
      const replayed = await post('/api/platform/auth/two-step/verify', {
        challenge: await passwordStep('verify'), code: codeForStep(secret, spent),
      });
      expect(replayed.statusCode).toBe(401);

      const code = codeForStep(secret, spent + 1);
      const first = await post('/api/platform/auth/two-step/verify', { challenge: await passwordStep('verify'), code });
      expect(first.statusCode, first.body).toBe(200);
      expect(first.json().token).toBeTruthy();

      const again = await post('/api/platform/auth/two-step/verify', { challenge: await passwordStep('verify'), code });
      expect(again.statusCode, 'the same code signed in twice').toBe(401);
    });

    it('accepts a recovery code once, however it is typed, and says how many are left', async () => {
      const [code] = recoveryCodes;
      const used = await post('/api/platform/auth/two-step/verify', {
        challenge: await passwordStep('verify'), code: ` ${code.toLowerCase()} `,
      });
      expect(used.statusCode, used.body).toBe(200);
      expect(used.json().recoveryCodesLeft).toBe(9);

      const again = await post('/api/platform/auth/two-step/verify', { challenge: await passwordStep('verify'), code });
      expect(again.statusCode).toBe(401);

      expect((await auditFor('PLATFORM_RECOVERY_CODE_USED')).filter((e) => e.targetId === accountId)).toHaveLength(1);
    });

    it('replaces recovery codes only with a live authenticator code', async () => {
      const token = await platformSignIn(app, ACCOUNT, freshIp);
      const auth = { authorization: `Bearer ${token}` };

      // A session alone, or an old recovery code, is not enough to mint new ones.
      expect((await post('/api/platform/me/recovery-codes', { code: recoveryCodes[1] }, auth)).statusCode).toBe(401);

      const res = await post('/api/platform/me/recovery-codes', { code: await currentCode(app, ACCOUNT.email) }, auth);
      expect(res.statusCode, res.body).toBe(200);
      const fresh = res.json().recoveryCodes as string[];
      expect(fresh).toHaveLength(10);

      const old = await post('/api/platform/auth/two-step/verify', {
        challenge: await passwordStep('verify'), code: recoveryCodes[1],
      });
      expect(old.statusCode, 'a replaced recovery code still worked').toBe(401);
      recoveryCodes = fresh;
    });

    it('locks the second step after five wrong codes — even for the right code', async () => {
      await app.prisma.platformUser.update({ where: { id: accountId }, data: { mfaFailures: 0 } });
      for (let i = 0; i < 5; i++) {
        const res = await post('/api/platform/auth/two-step/verify', {
          challenge: await passwordStep('verify'), code: 'AAAAA-AAAAA',
        });
        expect(res.statusCode).toBe(401);
      }

      const right = await post('/api/platform/auth/two-step/verify', {
        challenge: await passwordStep('verify'), code: await currentCode(app, ACCOUNT.email),
      });
      expect(right.statusCode).toBe(429);
      expect(right.json().message).toMatch(/Try again in 15 minutes/);
      expect((await auditFor('PLATFORM_TWO_STEP_LOCKED')).filter((e) => e.targetId === accountId)).toHaveLength(1);

      await app.prisma.platformUser.update({ where: { id: accountId }, data: { mfaLockedUntil: null } });
    });

    it('refuses a challenge used for the wrong step, altered, or that is really a session', async () => {
      const challenge = await passwordStep('verify');
      expect((await post('/api/platform/auth/two-step/setup', { challenge })).statusCode).toBe(401);

      // Re-pointed at another account, keeping the signature: the classic swap.
      const ownerId = (await asPlatform('GET', '/api/platform/me')).json().id as string;
      const [header, payload, signature] = challenge.split('.');
      const swapped = Buffer.from(JSON.stringify({
        ...JSON.parse(Buffer.from(payload, 'base64url').toString()), sub: ownerId,
      })).toString('base64url');
      const forged = await post('/api/platform/auth/two-step/verify', {
        challenge: [header, swapped, signature].join('.'), code: await currentCode(app, PLATFORM.email),
      });
      expect(forged.statusCode).toBe(401);

      const session = await post('/api/platform/auth/two-step/verify', {
        challenge: platformToken, code: await currentCode(app, PLATFORM.email),
      });
      expect(session.statusCode).toBe(401);
    });

    it('resets a colleague’s two-step verification, but never your own', async () => {
      const auth = { authorization: `Bearer ${platformToken}` };
      const ownerId = (await asPlatform('GET', '/api/platform/me')).json().id as string;

      const own = await app.inject({ method: 'DELETE', url: `/api/platform/users/${ownerId}/two-step`, headers: auth });
      expect(own.statusCode).toBe(400);

      const res = await app.inject({ method: 'DELETE', url: `/api/platform/users/${accountId}/two-step`, headers: auth });
      expect(res.statusCode, res.body).toBe(200);
      expect(res.json().staff.twoStepEnabled).toBe(false);

      // Their next sign-in enrols again, and the old authenticator is dead.
      await passwordStep('enroll');
      expect((await auditFor('PLATFORM_USER_TWO_STEP_RESET')).some((e) => e.targetId === accountId)).toBe(true);
    });

    it('cannot be reset with a dealer’s own sign-in', async () => {
      const res = await app.inject({
        method: 'DELETE', url: `/api/platform/users/${accountId}/two-step`,
        headers: { authorization: `Bearer ${await dealerLogin('abc-motors', 'owner@abc.test')}`, 'x-tenant-slug': 'abc-motors' },
      });
      expect(res.statusCode).toBe(403);
    });
  });

  describe('audit trail', () => {
    interface Entry {
      id: string;
      action: string;
      actorId: string;
      actorName: string;
      targetTenantId: string | null;
      tenantName: string | null;
      metadata: string | null;
      timestamp: string;
    }
    interface Page {
      entries: Entry[];
      nextCursor: string | null;
      filters?: {
        actors: { id: string; name: string; count: number }[];
        actions: { action: string; count: number }[];
        dealers: { id: string; name: string; count: number }[];
      };
    }

    const readLog = async (query = ''): Promise<Page> => {
      const res = await asPlatform('GET', `/api/platform/audit${query}`);
      expect(res.statusCode, res.body).toBe(200);
      return res.json() as Page;
    };

    it('records every platform action, and never the passwords', async () => {
      const { entries } = await readLog();

      const actions = entries.map((e) => e.action);
      expect(actions).toContain('TENANT_CREATED');
      expect(actions).toContain('TENANT_ADMIN_CREATED');
      expect(actions).toContain('TENANT_SUSPENDED');
      expect(actions).toContain('TENANT_RESUMED');

      const recorded = JSON.stringify(entries);
      expect(recorded, 'a password reached the audit log').not.toContain(DEALER_ADMIN_PASSWORD);
      expect(recorded).not.toContain(PLATFORM.password);
    });

    it('names the actor and the dealer, not their ids', async () => {
      const { entries } = await readLog();
      const created = entries.find((e) => e.action === 'TENANT_CREATED');

      expect(created?.actorName).toBe(PLATFORM.name);
      // The dealer's own name, resolved from targetTenantId — the row stores
      // only the id, so this is what makes the log readable.
      expect(created?.tenantName).toBeTruthy();
      expect(created?.tenantName).not.toBe(created?.targetTenantId);
    });

    it('filters by dealer, by person and by action', async () => {
      const all = await readLog();
      const sample = all.entries.find((e) => e.action === 'TENANT_SUSPENDED');
      expect(sample, 'expected a suspension in the log').toBeDefined();

      const byTenant = await readLog(`?tenantId=${sample!.targetTenantId}`);
      expect(byTenant.entries.length).toBeGreaterThan(0);
      expect(byTenant.entries.every((e) => e.targetTenantId === sample!.targetTenantId)).toBe(true);

      const byActor = await readLog(`?actorId=${sample!.actorId}`);
      expect(byActor.entries.every((e) => e.actorId === sample!.actorId)).toBe(true);

      const byAction = await readLog('?action=TENANT_SUSPENDED');
      expect(byAction.entries.length).toBeGreaterThan(0);
      expect(byAction.entries.every((e) => e.action === 'TENANT_SUSPENDED')).toBe(true);

      // Filters combine, rather than the last one winning.
      const both = await readLog(`?action=TENANT_SUSPENDED&tenantId=${sample!.targetTenantId}`);
      expect(both.entries.every(
        (e) => e.action === 'TENANT_SUSPENDED' && e.targetTenantId === sample!.targetTenantId,
      )).toBe(true);
    });

    it('pages with a cursor without repeating or skipping an entry', async () => {
      const all = await readLog('?limit=200');
      expect(all.entries.length, 'need several entries to page through').toBeGreaterThan(3);
      expect(all.nextCursor).toBeNull();

      const first = await readLog('?limit=2');
      expect(first.entries).toHaveLength(2);
      expect(first.nextCursor).toBe(first.entries[1].id);

      const second = await readLog(`?limit=2&cursor=${first.nextCursor}`);
      const paged = [...first.entries, ...second.entries].map((e) => e.id);

      expect(new Set(paged).size, 'an entry appeared on two pages').toBe(paged.length);
      expect(paged).toEqual(all.entries.slice(0, paged.length).map((e) => e.id));
    });

    it('offers filter options for the whole log, on the first page only', async () => {
      const first = await readLog('?limit=2');
      expect(first.filters).toBeDefined();

      const { actors, actions, dealers } = first.filters!;
      expect(actors.some((a) => a.name === PLATFORM.name)).toBe(true);
      expect(actions.some((a) => a.action === 'TENANT_CREATED')).toBe(true);
      expect(dealers.length).toBeGreaterThan(0);
      expect(dealers.every((d) => d.name.length > 0)).toBe(true);

      // Counts cover every entry, not just the two on this page.
      expect(actors.reduce((n, a) => n + a.count, 0)).toBeGreaterThan(first.entries.length);

      // Paging back for more does not re-send them.
      const next = await readLog(`?limit=2&cursor=${first.nextCursor}`);
      expect(next.filters).toBeUndefined();
    });

    it('rejects a nonsense page size rather than trusting it', async () => {
      const res = await asPlatform('GET', '/api/platform/audit?limit=5000');
      expect(res.statusCode).toBe(422);
    });

    it('is unreachable with a dealer’s own sign-in', async () => {
      const res = await asDealer('abc-motors', 'owner@abc.test', '/api/platform/audit');
      expect(res.statusCode).toBe(403);
    });
  });
});
