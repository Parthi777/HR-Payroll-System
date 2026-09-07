/**
 * The dealer-side audit trail, driven through the real endpoints.
 *
 * The suite never inserts an AuditLog row itself. The whole claim being tested
 * is that ordinary administrative work writes the trail as a side effect, and a
 * seeded row would let the log pass against a history the application could not
 * actually have produced.
 *
 * Needs a database (see tests/isolation.test.ts); skips without one.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import bcrypt from 'bcrypt';
import type { FastifyInstance } from 'fastify';

const TEST_DATABASE_URL = process.env.TEST_DATABASE_URL;
const suite = TEST_DATABASE_URL ? describe : describe.skip;

const PLATFORM = { email: 'owner@platform.test', name: 'Platform Owner', password: 'platform-owner-pass' };
const DEALER_PASSWORD = 'dealer-admin-password';

suite('dealer audit trail', () => {
  let app: FastifyInstance;
  let platformToken: string;
  /** The employee created below, reused by the tests that follow it. */
  let employeeId: string;

  // Login is rate-limited per IP, and every inject() would otherwise share
  // 127.0.0.1 — so each sign-in comes from its own address rather than the
  // suite relaxing a real security control.
  let ipCounter = 0;
  const freshIp = () => `10.1.${Math.floor(++ipCounter / 250)}.${ipCounter % 250}`;

  const tokens = new Map<string, string>();
  async function dealerLogin(slug: string, email: string): Promise<string> {
    const key = `${slug}:${email}`;
    const cached = tokens.get(key);
    if (cached) return cached;
    const res = await app.inject({
      method: 'POST', url: '/api/auth/admin/login', remoteAddress: freshIp(),
      headers: { 'x-tenant-slug': slug },
      payload: { email, password: DEALER_PASSWORD },
    });
    expect(res.statusCode, `login ${key}: ${res.body}`).toBe(200);
    tokens.set(key, res.json().token);
    return res.json().token;
  }

  /** Any call, as a given dealer administrator. */
  async function asDealer(
    slug: string, email: string,
    method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE', url: string, payload?: unknown,
  ) {
    return app.inject({
      method, url,
      headers: { authorization: `Bearer ${await dealerLogin(slug, email)}`, 'x-tenant-slug': slug },
      ...(payload === undefined ? {} : { payload: payload as object }),
    });
  }

  const OWNER = 'owner@alpha.test';
  const alpha = (method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE', url: string, payload?: unknown) =>
    asDealer('alpha-motors', OWNER, method, url, payload);

  /** The log as the dealer's owner sees it. */
  async function auditLog(query = '') {
    const res = await alpha('GET', `/api/admin/audit${query}`);
    expect(res.statusCode, res.body).toBe(200);
    return res.json();
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
    const login = await app.inject({
      method: 'POST', url: '/api/platform/auth/login', remoteAddress: freshIp(),
      payload: { email: PLATFORM.email, password: PLATFORM.password },
    });
    expect(login.statusCode, login.body).toBe(200);
    platformToken = login.json().token;

    // Two dealers, so "one workspace cannot read another's trail" is a claim
    // this suite can actually make.
    for (const [slug, name, email] of [
      ['alpha-motors', 'Alpha Motors', OWNER],
      ['beta-motors', 'Beta Motors', 'owner@beta.test'],
    ]) {
      const res = await app.inject({
        method: 'POST', url: '/api/platform/tenants',
        headers: { authorization: `Bearer ${platformToken}` },
        payload: { slug, name, admin: { name: `${name} Owner`, email, password: DEALER_PASSWORD } },
      });
      expect(res.statusCode, res.body).toBe(201);
    }
  }, 60_000);

  afterAll(async () => {
    await app?.close();
  });

  describe('ordinary work writes the trail', () => {
    it('starts empty — nothing has been done in this workspace yet', async () => {
      const { entries } = await auditLog();
      expect(entries).toEqual([]);
    });

    it('records a department being created, naming the person who did it', async () => {
      const created = await alpha('POST', '/api/admin/departments', { name: 'Service' });
      expect(created.statusCode, created.body).toBe(200);

      const { entries } = await auditLog();
      expect(entries).toHaveLength(1);
      expect(entries[0].action).toBe('DEPARTMENT_CREATED');
      expect(entries[0].entity).toBe('Department');
      // The point of the log: a name, not an id nobody can resolve.
      expect(entries[0].actorName).toBe('Alpha Motors Owner');
      expect(entries[0].actorRole).toBe('SUPER_ADMIN');
      expect(JSON.parse(entries[0].metadata)).toMatchObject({ name: 'Service' });
      expect(entries[0].ipAddress).toBeTruthy();
    });

    it('records a salary revision with both the old and the new figure', async () => {
      // Onboarding creates Head Office, a department, a designation and a
      // shift, so an employee can be created without inventing any of them.
      const master = await Promise.all(
        ['branches', 'departments', 'designations'].map((k) => alpha('GET', `/api/admin/${k}`)),
      );
      const [branches, departments, designations] = master.map((r) => r.json());
      const shifts = (await alpha('GET', '/api/shifts')).json().shifts;

      const created = await alpha('POST', '/api/admin/employees', {
        name: 'Ravi Kumar',
        phone: '+919000000123',
        branchId: branches.branches[0].id,
        departmentId: departments.departments[0].id,
        designationId: designations.designations[0].id,
        shiftId: shifts[0].id,
        joiningDate: '2026-01-01',
        salary: 20000,
        password: 'employee-app-password',
      });
      expect(created.statusCode, created.body).toBe(200);
      employeeId = created.json().employee.id;

      const raised = await alpha('PUT', `/api/admin/employees/${employeeId}`, { salary: 26000 });
      expect(raised.statusCode, raised.body).toBe(200);

      const { entries } = await auditLog('?action=EMPLOYEE_UPDATED');
      expect(entries).toHaveLength(1);
      expect(JSON.parse(entries[0].metadata)).toMatchObject({
        name: 'Ravi Kumar',
        salary: { from: 20000, to: 26000 },
      });
    });

    it('records a password reset without recording the password', async () => {
      const reset = await alpha('POST', `/api/admin/employees/${employeeId}/reset-password`);
      expect(reset.statusCode, reset.body).toBe(200);
      const issued = reset.json().password;
      expect(issued).toBeTruthy();

      const { entries } = await auditLog('?action=EMPLOYEE_PASSWORD_RESET');
      expect(entries).toHaveLength(1);
      // The whole row, not just the metadata field: the issued credential must
      // appear nowhere in what the log hands back.
      expect(JSON.stringify(entries[0])).not.toContain(issued);
      expect(JSON.parse(entries[0].metadata)).toMatchObject({ name: 'Ravi Kumar' });
    });

    it('leaves no entry behind when the action itself was refused', async () => {
      const before = (await auditLog()).entries.length;
      // 404: no such employee, so nothing happened and nothing may be recorded.
      const missing = await alpha('PUT', '/api/admin/employees/does-not-exist', { salary: 999999 });
      expect(missing.statusCode).toBe(404);
      expect((await auditLog()).entries.length).toBe(before);
    });
  });

  describe('reading the log', () => {
    it('filters by actor, action and entity on the server', async () => {
      const all = await auditLog();
      expect(all.entries.length).toBeGreaterThan(2);

      const employees = await auditLog('?entity=Employee');
      expect(employees.entries.length).toBeGreaterThan(0);
      expect(employees.entries.every((e: { entity: string }) => e.entity === 'Employee')).toBe(true);

      const nobody = await auditLog('?actorId=someone-who-never-acted');
      expect(nobody.entries).toEqual([]);
    });

    it('offers filter options covering the whole log, not just the page shown', async () => {
      const { filters } = await auditLog('?limit=1');
      expect(filters.actions.length).toBeGreaterThan(1);
      expect(filters.actors[0].name).toBe('Alpha Motors Owner');
      // Counts describe every entry, not the single row this page returned.
      expect(filters.actions.reduce((n: number, a: { count: number }) => n + a.count, 0)).toBeGreaterThan(1);
    });

    it('serves each entry exactly once while paging', async () => {
      const seen: string[] = [];
      let cursor: string | null = null;
      do {
        const page: { entries: { id: string }[]; nextCursor: string | null } =
          await auditLog(`?limit=2${cursor ? `&cursor=${cursor}` : ''}`);
        seen.push(...page.entries.map((e) => e.id));
        cursor = page.nextCursor;
      } while (cursor);

      const whole = await auditLog('?limit=200');
      expect(seen).toEqual(whole.entries.map((e: { id: string }) => e.id));
      expect(new Set(seen).size).toBe(seen.length);
    });

    it('sends no filter options on later pages — the first page already carried them', async () => {
      const first = await auditLog('?limit=1');
      expect(first.filters).toBeDefined();
      const second = await auditLog(`?limit=1&cursor=${first.nextCursor}`);
      expect(second.filters).toBeUndefined();
    });
  });

  describe('who may read it', () => {
    it('refuses an HR manager — the trail carries salaries and payroll totals', async () => {
      const hr = await alpha('POST', '/api/admin/users', {
        name: 'Alpha HR', email: 'hr@alpha.test', role: 'HR_MANAGER', password: DEALER_PASSWORD,
      });
      expect(hr.statusCode, hr.body).toBe(200);

      const res = await asDealer('alpha-motors', 'hr@alpha.test', 'GET', '/api/admin/audit');
      expect(res.statusCode).toBe(403);
    });

    it('never shows one workspace the other workspace’s trail', async () => {
      const beta = await asDealer('beta-motors', 'owner@beta.test', 'GET', '/api/admin/audit');
      expect(beta.statusCode, beta.body).toBe(200);
      // Alpha has been busy throughout this suite; Beta has done nothing. If
      // scoping were missing, Beta would be reading Alpha's salary changes.
      expect(beta.json().entries).toEqual([]);

      const alphaEntries = (await auditLog()).entries;
      expect(alphaEntries.length).toBeGreaterThan(0);
    });
  });
});
