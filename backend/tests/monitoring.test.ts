/**
 * The monitoring dashboards.
 *
 * The console's overview and per-dealer view count each dealer's own rows and
 * carry no employee names and no salary figures. Master Control's insights
 * show the last payroll's totals only to the roles that may see salaries, and
 * a branch manager sees only their branch.
 *
 * Needs a database (see tests/isolation.test.ts); skips without one.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import bcrypt from 'bcrypt';
import type { FastifyInstance } from 'fastify';
import { platformSignIn } from './support/platform-session.js';
import { adminSignIn } from './support/admin-session.js';

const TEST_DATABASE_URL = process.env.TEST_DATABASE_URL;
const suite = TEST_DATABASE_URL ? describe : describe.skip;

const PLATFORM = { email: 'owner@platform.test', name: 'Platform Owner', password: 'platform-owner-pass' };
const PASSWORD = 'dealer-admin-password';
const OWNER = 'owner@monitor.test';

suite('monitoring dashboards', () => {
  let app: FastifyInstance;
  let platformToken: string;
  const tokens: Record<string, string> = {};
  let alphaId: string;

  let ipCounter = 0;
  const freshIp = () => `10.14.${Math.floor(++ipCounter / 250)}.${ipCounter % 250}`;
  const as = (token: string, slug: string | null, method: 'GET' | 'POST', url: string, payload?: unknown) =>
    app.inject({
      method, url, remoteAddress: freshIp(),
      headers: { authorization: `Bearer ${token}`, ...(slug ? { 'x-tenant-slug': slug } : {}) },
      ...(payload === undefined ? {} : { payload: payload as object }),
    });

  const now = new Date();
  const today = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;

  /** A dealer with `staff` employees in its first branch, each punched in today. */
  async function dealer(slug: string, staff: number) {
    const made = await app.inject({
      method: 'POST', url: '/api/platform/tenants', remoteAddress: freshIp(),
      headers: { authorization: `Bearer ${platformToken}` },
      payload: { slug, name: `${slug} motors`, admin: { name: 'Owner', email: OWNER, password: PASSWORD } },
    });
    expect(made.statusCode, made.body).toBe(201);
    const token = (await adminSignIn(app, { slug, email: OWNER, password: PASSWORD }, freshIp)).json().token;
    tokens[slug] = token;

    const [branches, departments, designations] = (
      await Promise.all(['branches', 'departments', 'designations'].map((k) => as(token, slug, 'GET', `/api/admin/${k}`)))
    ).map((r) => r.json());
    const shifts = (await as(token, slug, 'GET', '/api/shifts')).json().shifts;
    for (let i = 0; i < staff; i++) {
      const res = await as(token, slug, 'POST', '/api/admin/employees', {
        name: `${slug} person ${i}`, phone: `+9190000${slug.length}${String(i).padStart(4, '0')}`, password: 'employee-app-password',
        branchId: branches.branches[0].id, departmentId: departments.departments[0].id,
        designationId: designations.designations[0].id, shiftId: shifts[0].id,
        joiningDate: '2026-01-01', salary: 30000,
      });
      expect(res.statusCode, res.body).toBe(200);
      const punch = await as(token, slug, 'POST', '/api/admin/attendance/manual-punch', {
        employeeId: res.json().employee.id, mode: 'MANUAL', date: today, checkIn: '09:45', checkOut: '18:00', reason: 'fixture',
      });
      expect(punch.statusCode, punch.body).toBe(200);
    }
    return { branchId: branches.branches[0].id as string };
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
    platformToken = await platformSignIn(app, PLATFORM, freshIp);

    await dealer('alpha', 3);
    await dealer('bravo', 1);
    alphaId = (await p.tenant.findUniqueOrThrow({ where: { slug: 'alpha' } })).id;

    const run = await as(tokens.alpha, 'alpha', 'POST', '/api/admin/payroll/run', { month: now.getMonth() + 1, year: now.getFullYear() });
    expect(run.statusCode, run.body).toBe(200);
  }, 180_000);

  afterAll(async () => {
    await app?.close();
  });

  describe('the console overview', () => {
    it('counts each dealer’s own staff and today’s check-ins', async () => {
      const res = await as(platformToken, null, 'GET', '/api/platform/overview');
      expect(res.statusCode, res.body).toBe(200);
      const body = res.json();
      expect(body.totals.dealers).toBe(2);
      expect(body.totals.staff).toBe(4);
      expect(body.totals.checkedInToday).toBe(4);

      const alpha = body.dealers.find((d: { slug: string }) => d.slug === 'alpha');
      expect(alpha.staff).toBe(3);
      expect(alpha.checkedInToday).toBe(3);
      expect(alpha.attendanceRate).toBe(100);
      expect(alpha.checkInsLast14).toHaveLength(14);
      expect(alpha.checkInsLast14.at(-1)).toBe(3);
      expect(alpha.lastPayroll).toMatchObject({ month: now.getMonth() + 1, year: now.getFullYear(), payslips: 3 });
      // The owner signed in once — enrolling counts as a sign-in.
      expect(alpha.admins).toBe(1);
      expect(alpha.adminsWithTwoStep).toBe(1);
      expect(alpha.lastAdminSignInAt).toBeTruthy();
      // Manual punches wait for approval.
      expect(alpha.pendingApprovals).toBe(3);

      expect(body.series.checkIns).toHaveLength(30);
      expect(body.series.checkIns.at(-1).checkIns).toBe(4);
    });

    it('carries no employee names and no salary figures', async () => {
      const overview = JSON.stringify((await as(platformToken, null, 'GET', '/api/platform/overview')).json());
      const insights = JSON.stringify((await as(platformToken, null, 'GET', `/api/platform/tenants/${alphaId}/insights`)).json());
      for (const body of [overview, insights]) {
        expect(body).not.toContain('person 0');
        expect(body).not.toMatch(/salary|netSalary|grossSalary|"gross"|"net"/i);
      }
    });

    it('is the console’s alone', async () => {
      expect((await as(tokens.alpha, 'alpha', 'GET', '/api/platform/overview')).statusCode).toBe(403);
      expect((await app.inject({ method: 'GET', url: '/api/platform/overview', remoteAddress: freshIp() })).statusCode).toBe(401);
    });
  });

  describe('one dealer in the console', () => {
    it('shows that dealer’s activity and nobody else’s', async () => {
      const res = await as(platformToken, null, 'GET', `/api/platform/tenants/${alphaId}/insights`);
      expect(res.statusCode, res.body).toBe(200);
      const body = res.json();
      expect(body.today).toMatchObject({ staff: 3, checkedIn: 3, attendanceRate: 100, branches: 1 });
      expect(body.checkIns).toHaveLength(30);
      expect(body.checkIns.at(-1).checkIns).toBe(3);
      // 09:45 against the default shift is late.
      expect(body.checkIns.at(-1).late).toBe(3);
      expect(body.punchModes).toEqual([{ mode: 'MANUAL', label: 'Manual', count: 3 }]);
      expect(body.payrollRuns).toEqual([{ month: now.getMonth() + 1, year: now.getFullYear(), payslips: 3 }]);
      expect(body.admins).toHaveLength(1);
    });

    it('answers 404 for a dealer that does not exist', async () => {
      expect((await as(platformToken, null, 'GET', '/api/platform/tenants/nope/insights')).statusCode).toBe(404);
    });
  });

  describe('Master Control insights', () => {
    it('gives the owner the last payroll’s totals', async () => {
      const res = await as(tokens.alpha, 'alpha', 'GET', '/api/admin/dashboard/insights?days=30');
      expect(res.statusCode, res.body).toBe(200);
      const body = res.json();
      expect(body.staff).toBe(3);
      expect(body.attendanceRate).toHaveLength(30);
      expect(body.attendanceRate.at(-1)).toMatchObject({ rate: 100, present: 3, late: 3 });
      expect(body.arrivals.reduce((s: number, b: { count: number }) => s + b.count, 0)).toBe(3);
      expect(body.pending.attendance).toBe(3);
      expect(body.topLate).toHaveLength(3);
      expect(body.payroll).toMatchObject({ month: now.getMonth() + 1, payslips: 3 });
      expect(body.payroll.net).toBeGreaterThanOrEqual(0);
    });

    it('leaves salaries out for an HR Manager, and shows a branch manager only their branch', async () => {
      const { runInTenant } = await import('../src/context/tenant-context.js');
      const p = app.prisma;
      // A second, empty branch for the branch manager.
      const branch = await as(tokens.alpha, 'alpha', 'POST', '/api/admin/branches', {
        name: 'Second', address: 'Elsewhere', geofenceLat: 11, geofenceLng: 77,
      });
      expect(branch.statusCode, branch.body).toBe(200);
      for (const [email, role, branchId] of [
        ['hr@monitor.test', 'HR_MANAGER', null],
        ['bm@monitor.test', 'BRANCH_MANAGER', branch.json().branch.id],
      ] as const) {
        const made = await as(tokens.alpha, 'alpha', 'POST', '/api/admin/users', { name: role, email, role, password: PASSWORD, branchId });
        expect(made.statusCode, made.body).toBe(200);
      }
      const hr = (await adminSignIn(app, { slug: 'alpha', email: 'hr@monitor.test', password: PASSWORD }, freshIp)).json().token;
      const bm = (await adminSignIn(app, { slug: 'alpha', email: 'bm@monitor.test', password: PASSWORD }, freshIp)).json().token;

      const forHr = (await as(hr, 'alpha', 'GET', '/api/admin/dashboard/insights')).json();
      expect(forHr.staff).toBe(3);
      expect(forHr.payroll).toBeNull();

      const forBm = (await as(bm, 'alpha', 'GET', '/api/admin/dashboard/insights')).json();
      expect(forBm.staff).toBe(0);
      expect(forBm.topLate).toEqual([]);

      // Signing in is recorded on the account.
      const signedIn = await runInTenant({ tenantId: alphaId, subjectId: 'test', role: 'SUPER_ADMIN' }, () =>
        p.adminUser.findFirstOrThrow({ where: { email: 'hr@monitor.test' }, select: { lastSignInAt: true } }),
      );
      expect(signedIn.lastSignInAt).toBeTruthy();
    });

    it('takes 7 or 30 days, nothing else', async () => {
      expect((await as(tokens.alpha, 'alpha', 'GET', '/api/admin/dashboard/insights?days=90')).statusCode).toBe(422);
    });
  });
});
