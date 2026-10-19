/**
 * Signing in to a dealer's workspace.
 *
 *   - Employees sign in with the user ID an administrator issued them — their
 *     employee code, or their phone number — and a password only an
 *     administrator sets. There is no third-party sign-in.
 *   - Every Master Control account (Super Admin down to Cashier) signs in with
 *     a password AND a code from an authenticator app. A correct password earns
 *     only a challenge; the first sign-in enrols.
 *   - A Super Admin, or an HR Manager, issues employee passwords; only a Super
 *     Admin clears a colleague's two-step for a lost phone.
 *
 * Needs a database (see tests/isolation.test.ts); skips without one.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import bcrypt from 'bcrypt';
import type { FastifyInstance } from 'fastify';
import { platformSignIn } from './support/platform-session.js';
import { adminSignIn } from './support/admin-session.js';
import { codeForStep, stepAt } from '../src/services/auth/totp.js';

const TEST_DATABASE_URL = process.env.TEST_DATABASE_URL;
const suite = TEST_DATABASE_URL ? describe : describe.skip;

const PLATFORM = { email: 'owner@platform.test', name: 'Platform Owner', password: 'platform-owner-pass' };
const PASSWORD = 'dealer-admin-password';
const HOME = { slug: 'signin-home', owner: 'owner@home.test' };
const OTHER = { slug: 'signin-other', owner: 'owner@other.test' };
const HR = { email: 'hr@home.test', password: 'hr-manager-password' };
const BM = { email: 'bm@home.test', password: 'branch-manager-password' };
const FRESH = { email: 'fresh@home.test', password: 'fresh-admin-password' };

suite('signing in', () => {
  let app: FastifyInstance;

  let ipCounter = 0;
  const freshIp = () => `10.9.${Math.floor(++ipCounter / 250)}.${ipCounter % 250}`;

  const post = (url: string, payload: object, slug?: string, token?: string) =>
    app.inject({
      method: 'POST', url, remoteAddress: freshIp(), payload,
      headers: { ...(slug ? { 'x-tenant-slug': slug } : {}), ...(token ? { authorization: `Bearer ${token}` } : {}) },
    });
  const call = (method: 'GET' | 'POST' | 'DELETE', url: string, slug: string, token: string, payload?: object) =>
    app.inject({
      method, url, remoteAddress: freshIp(), ...(payload ? { payload } : {}),
      headers: { 'x-tenant-slug': slug, authorization: `Bearer ${token}` },
    });

  const tokens: Record<string, string> = {};
  const employees: Record<string, { id: string; code: string; phone: string; password: string }> = {};
  const adminIds: Record<string, string> = {};

  /** Read an admin row the way a test may: outside any one tenant's context. */
  async function adminRow(email: string, slug: string) {
    const { runUnscoped } = await import('../src/context/tenant-context.js');
    const tenant = await app.prisma.tenant.findUniqueOrThrow({ where: { slug } });
    return runUnscoped('test: read an admin row', () =>
      app.prisma.adminUser.findFirstOrThrow({ where: { email, tenantId: tenant.id } }),
    );
  }
  async function resetGuards(email: string, slug: string) {
    const { runUnscoped } = await import('../src/context/tenant-context.js');
    const row = await adminRow(email, slug);
    await runUnscoped('test: reset the lockout', () =>
      app.prisma.adminUser.update({
        where: { id: row.id },
        data: { totpLastStep: null, mfaFailures: 0, mfaLockedUntil: null },
      }),
    );
  }
  async function codeNow(email: string, slug: string) {
    const row = await adminRow(email, slug);
    return codeForStep(row.totpSecret!, stepAt(Date.now()));
  }

  beforeAll(async () => {
    process.env.DATABASE_URL = TEST_DATABASE_URL;
    const { buildServer } = await import('../src/server.js');
    app = await buildServer();
    await app.ready();

    const p = app.prisma;
    const { runUnscoped } = await import('../src/context/tenant-context.js');
    await runUnscoped('test teardown', async () => {
      for (const del of [
        p.integrationEvent, p.integrationClient,
        p.gPSLog, p.claimMessage, p.claim, p.attendance, p.leave, p.leaveBalance,
        p.payslip, p.notification, p.whatsAppLog, p.geofenceViolation, p.auditLog,
        p.kioskDevice, p.attendanceReminder, p.employee, p.adminUser, p.branch, p.department, p.designation,
        p.shift, p.holiday, p.tenantSettings,
      ]) {
        await (del as { deleteMany: (a?: unknown) => Promise<unknown> }).deleteMany({});
      }
    });
    await p.subscription.deleteMany({});
    await p.signupRequest.deleteMany({});
    await p.platformAuditLog.deleteMany({});
    await p.tenant.deleteMany({});
    await p.platformUser.deleteMany({});

    await p.platformUser.create({
      data: { email: PLATFORM.email, name: PLATFORM.name, passwordHash: await bcrypt.hash(PLATFORM.password, 4) },
    });
    tokens.platform = await platformSignIn(app, PLATFORM, freshIp);

    for (const { slug, owner } of [HOME, OTHER]) {
      const made = await post('/api/platform/tenants', {
        slug, name: slug, admin: { name: 'Owner', email: owner, password: PASSWORD },
      }, undefined, tokens.platform);
      expect(made.statusCode, made.body).toBe(201);

      const signIn = await adminSignIn(app, { slug, email: owner, password: PASSWORD }, freshIp);
      expect(signIn.statusCode, signIn.body).toBe(200);
      tokens[slug] = signIn.json().token;

      const [branches, departments, designations] = await Promise.all(
        ['branches', 'departments', 'designations'].map(async (k) => (await call('GET', `/api/admin/${k}`, slug, tokens[slug])).json()),
      );
      const shifts = (await call('GET', '/api/shifts', slug, tokens[slug])).json();
      const phone = slug === HOME.slug ? '+919000000701' : '+919000000702';
      const password = `${slug}-employee-pass`;
      const created = await call('POST', '/api/admin/employees', slug, tokens[slug], {
        name: `Employee of ${slug}`, phone, password,
        branchId: branches.branches[0].id, departmentId: departments.departments[0].id,
        designationId: designations.designations[0].id, shiftId: shifts.shifts[0].id,
        joiningDate: '2026-01-01', salary: 20000,
      });
      expect([200, 201], created.body).toContain(created.statusCode);
      employees[slug] = { id: created.json().employee.id, code: created.json().employee.employeeCode, phone, password };
    }

    for (const [who, role] of [[HR, 'HR_MANAGER'], [BM, 'BRANCH_MANAGER'], [FRESH, 'HR_MANAGER']] as const) {
      const res = await call('POST', '/api/admin/users', HOME.slug, tokens[HOME.slug], {
        name: role, email: who.email, role, password: who.password,
      });
      expect(res.statusCode, res.body).toBe(200);
      adminIds[who.email] = res.json().admin.id;
    }
    for (const who of [HR, BM]) {
      const res = await adminSignIn(app, { slug: HOME.slug, ...who }, freshIp);
      expect(res.statusCode, res.body).toBe(200);
      tokens[who.email] = res.json().token;
    }
  }, 120_000);

  afterAll(async () => {
    await app?.close();
  });

  describe('employees, by user ID', () => {
    const login = (body: object, slug = HOME.slug) => post('/api/auth/employee-login', body, slug);

    it('signs in with the employee code', async () => {
      const e = employees[HOME.slug];
      const res = await login({ userId: e.code, password: e.password });
      expect(res.statusCode, res.body).toBe(200);
      expect(res.json().employeeId).toBe(e.id);
    });

    it('accepts the code typed in lower case', async () => {
      const e = employees[HOME.slug];
      const res = await login({ userId: e.code.toLowerCase(), password: e.password });
      expect(res.statusCode, res.body).toBe(200);
    });

    it('still signs in with the phone number, with or without +91', async () => {
      const e = employees[HOME.slug];
      expect((await login({ userId: e.phone, password: e.password })).statusCode).toBe(200);
      expect((await login({ userId: e.phone.slice(3), password: e.password })).statusCode).toBe(200);
    });

    it('still accepts the { phone } body installed apps send', async () => {
      const e = employees[HOME.slug];
      const res = await login({ phone: e.phone, password: e.password });
      expect(res.statusCode, res.body).toBe(200);
    });

    it('gives one answer for a wrong ID and a wrong password', async () => {
      const e = employees[HOME.slug];
      const wrongPassword = await login({ userId: e.code, password: 'nope' });
      const wrongId = await login({ userId: 'EMP999', password: e.password });
      expect(wrongPassword.statusCode).toBe(401);
      expect(wrongId.statusCode).toBe(401);
      expect(wrongPassword.json().message).toBe(wrongId.json().message);
    });

    it('never resolves a code to another dealer’s employee', async () => {
      // Both dealers number from the same series, so the code exists in both.
      const other = employees[OTHER.slug];
      expect(other.code).toBe(employees[HOME.slug].code);
      const res = await login({ userId: other.code, password: other.password }, HOME.slug);
      expect(res.statusCode).toBe(401);
    });
  });

  describe('who issues employee passwords', () => {
    it('an HR Manager can reset one, and the new one works with the code', async () => {
      const e = employees[HOME.slug];
      const res = await call('POST', `/api/admin/employees/${e.id}/reset-password`, HOME.slug, tokens[HR.email]);
      expect(res.statusCode, res.body).toBe(200);
      const { password, employee } = res.json();
      expect(employee.employeeCode).toBe(e.code);

      const signIn = await post('/api/auth/employee-login', { userId: e.code, password }, HOME.slug);
      expect(signIn.statusCode, signIn.body).toBe(200);
      e.password = password;
    });

    it('a Branch Manager cannot', async () => {
      const e = employees[HOME.slug];
      const res = await call('POST', `/api/admin/employees/${e.id}/reset-password`, HOME.slug, tokens[BM.email]);
      expect(res.statusCode).toBe(403);
    });
  });

  describe('administrators, with a second step', () => {
    it('a correct password yields only a challenge, which opens nothing', async () => {
      const res = await post('/api/auth/admin/login', FRESH, HOME.slug);
      expect(res.statusCode, res.body).toBe(200);
      expect(res.json().step).toBe('enroll');
      expect(res.json().token).toBeUndefined();

      const probe = await call('GET', '/api/admin/branches', HOME.slug, res.json().challenge);
      expect(probe.statusCode).toBe(401);
    });

    it('enrols on first sign-in, and the session carries the proof', async () => {
      const { challenge } = (await post('/api/auth/admin/login', FRESH, HOME.slug)).json();
      // Nothing to verify against before enrolling.
      expect((await post('/api/auth/admin/two-step/verify', { challenge, code: '123456' }, HOME.slug)).statusCode).toBe(401);

      const setup = await post('/api/auth/admin/two-step/setup', { challenge }, HOME.slug);
      expect(setup.statusCode, setup.body).toBe(200);
      expect(setup.json().otpauthUri).toContain('Kayaazh%20Payroll');

      const enabled = await post('/api/auth/admin/two-step/enable', {
        challenge, code: codeForStep(setup.json().secret, stepAt(Date.now())),
      }, HOME.slug);
      expect(enabled.statusCode, enabled.body).toBe(200);
      expect(enabled.json().recoveryCodes).toHaveLength(10);
      expect(app.jwt.decode<{ twoStep?: boolean }>(enabled.json().token)?.twoStep).toBe(true);

      const ok = await call('GET', '/api/admin/branches', HOME.slug, enabled.json().token);
      expect(ok.statusCode, ok.body).toBe(200);
      tokens[FRESH.email] = enabled.json().token;

      const me = await call('GET', '/api/admin/me/two-step', HOME.slug, enabled.json().token);
      expect(me.json().recoveryCodesLeft).toBe(10);
    });

    it('refuses the code that confirmed enrolment, then accepts the next sign-in', async () => {
      const { step, challenge } = (await post('/api/auth/admin/login', FRESH, HOME.slug)).json();
      expect(step).toBe('verify');
      // Still inside the step whose code enabled it, unless the clock turned over.
      const replayed = await post('/api/auth/admin/two-step/verify', {
        challenge, code: await codeNow(FRESH.email, HOME.slug),
      }, HOME.slug);
      if (replayed.statusCode === 401) {
        await resetGuards(FRESH.email, HOME.slug);
        const fresh = await post('/api/auth/admin/two-step/verify', {
          challenge, code: await codeNow(FRESH.email, HOME.slug),
        }, HOME.slug);
        expect(fresh.statusCode, fresh.body).toBe(200);
      } else {
        expect(replayed.statusCode, replayed.body).toBe(200);
      }
    });

    it('locks the second step after five wrong codes', async () => {
      await resetGuards(FRESH.email, HOME.slug);
      const { challenge } = (await post('/api/auth/admin/login', FRESH, HOME.slug)).json();
      for (let i = 0; i < 5; i++) {
        const res = await post('/api/auth/admin/two-step/verify', { challenge, code: '000000' }, HOME.slug);
        expect(res.statusCode).toBe(401);
      }
      const locked = await post('/api/auth/admin/two-step/verify', {
        challenge, code: await codeNow(FRESH.email, HOME.slug),
      }, HOME.slug);
      expect(locked.statusCode).toBe(429);
      await resetGuards(FRESH.email, HOME.slug);
    });

    it('a recovery code works exactly once', async () => {
      const replaced = await call('POST', '/api/admin/me/recovery-codes', HOME.slug, tokens[FRESH.email], {
        code: await (async () => { await resetGuards(FRESH.email, HOME.slug); return codeNow(FRESH.email, HOME.slug); })(),
      });
      expect(replaced.statusCode, replaced.body).toBe(200);
      const [recovery] = replaced.json().recoveryCodes as string[];

      const first = await post('/api/auth/admin/two-step/verify', {
        challenge: (await post('/api/auth/admin/login', FRESH, HOME.slug)).json().challenge, code: recovery,
      }, HOME.slug);
      expect(first.statusCode, first.body).toBe(200);
      expect(first.json().recoveryCodesLeft).toBe(9);

      const again = await post('/api/auth/admin/two-step/verify', {
        challenge: (await post('/api/auth/admin/login', FRESH, HOME.slug)).json().challenge, code: recovery,
      }, HOME.slug);
      expect(again.statusCode).toBe(401);
      await resetGuards(FRESH.email, HOME.slug);
    });

    it('refuses a challenge presented to another workspace', async () => {
      const { challenge } = (await post('/api/auth/admin/login', FRESH, HOME.slug)).json();
      const res = await post('/api/auth/admin/two-step/verify', {
        challenge, code: await codeNow(FRESH.email, HOME.slug),
      }, OTHER.slug);
      expect(res.statusCode).toBe(401);
    });

    it('ends sessions and refresh tokens from before two-step was required', async () => {
      const tenantId = (await adminRow(FRESH.email, HOME.slug)).tenantId;
      const id = adminIds[FRESH.email];
      const legacy = app.jwt.sign({ sub: id, role: 'HR_MANAGER', tenantId }, { expiresIn: '12h' });
      expect((await call('GET', '/api/admin/branches', HOME.slug, legacy)).statusCode).toBe(401);

      const legacyRefresh = app.jwt.refresh.sign({ sub: id, role: 'HR_MANAGER', tenantId, typ: 'refresh' }, { expiresIn: '30d' });
      expect((await post('/api/auth/refresh-token', { refreshToken: legacyRefresh })).statusCode).toBe(401);
    });

    it('a Super Admin resets a colleague’s two-step, never their own; an HR Manager resets none', async () => {
      const ownerId = (await adminRow(HOME.owner, HOME.slug)).id;
      const own = await call('DELETE', `/api/admin/users/${ownerId}/two-step`, HOME.slug, tokens[HOME.slug]);
      expect(own.statusCode).toBe(400);

      const byHr = await call('DELETE', `/api/admin/users/${adminIds[FRESH.email]}/two-step`, HOME.slug, tokens[HR.email]);
      expect(byHr.statusCode).toBe(403);

      // Another dealer's Super Admin cannot reach this workspace's accounts at all.
      const fromOther = await call('DELETE', `/api/admin/users/${adminIds[FRESH.email]}/two-step`, OTHER.slug, tokens[OTHER.slug]);
      expect(fromOther.statusCode).toBe(404);

      const reset = await call('DELETE', `/api/admin/users/${adminIds[FRESH.email]}/two-step`, HOME.slug, tokens[HOME.slug]);
      expect(reset.statusCode, reset.body).toBe(200);
      const next = await post('/api/auth/admin/login', FRESH, HOME.slug);
      expect(next.json().step).toBe('enroll');

      const users = await call('GET', '/api/admin/users', HOME.slug, tokens[HOME.slug]);
      const row = (users.json().admins as { id: string; totpEnabledAt: string | null }[]).find((a) => a.id === adminIds[FRESH.email]);
      expect(row?.totpEnabledAt).toBeNull();
    });
  });
});
