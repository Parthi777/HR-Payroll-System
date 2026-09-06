/**
 * Cross-tenant isolation, proven end to end against a real Postgres.
 *
 * `tenancy-extension.test.ts` proves the scoping *rule*; this proves the rule is
 * actually reached on every route, by driving the real Fastify app in-process
 * with two tenants whose data deliberately collides — same employee code, same
 * phone, same admin email, same department name, same claim number.
 *
 * Requires a database. Set TEST_DATABASE_URL and apply migrations first:
 *   createdb hrtest
 *   DATABASE_URL=postgresql://localhost/hrtest npx prisma migrate deploy
 *   TEST_DATABASE_URL=postgresql://localhost/hrtest npx vitest run tests/isolation.test.ts
 * Without it the suite skips, so `npm test` still runs everywhere.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import bcrypt from 'bcrypt';
import type { FastifyInstance } from 'fastify';

const TEST_DATABASE_URL = process.env.TEST_DATABASE_URL;
const suite = TEST_DATABASE_URL ? describe : describe.skip;

/** Everything one seeded tenant owns, so a test can reach for another's ids. */
interface Seeded {
  slug: string;
  tenantId: string;
  branchId: string;
  employeeId: string;
  attendanceId: string;
  claimId: string;
  leaveId: string;
  adminToken: string;
  employeeToken: string;
}

const PASSWORD = 'correct horse battery';
// Identical in both tenants on purpose: if any of these leaked across, the
// composite uniques or the query scoping would have to be broken.
const SHARED = {
  email: 'admin@example.com',
  employeeCode: 'EMP001',
  phone: '+919000000001',
  department: 'Sales',
};

suite('cross-tenant isolation', () => {
  let app: FastifyInstance;
  let A: Seeded;
  let B: Seeded;

  /** Call a route as a given tenant's user. */
  const as = (token: string, slug: string, method: 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE', url: string, payload?: unknown) =>
    app.inject({
      method,
      url,
      headers: { authorization: `Bearer ${token}`, 'x-tenant-slug': slug },
      ...(payload === undefined ? {} : { payload: payload as object }),
    });

  async function seed(slug: string): Promise<Seeded> {
    const { runInTenant } = await import('../src/context/tenant-context.js');
    const prisma = app.prisma;
    const tenant = await prisma.tenant.create({ data: { slug, name: `${slug} Motors` } });

    const ids = await runInTenant(
      { tenantId: tenant.id, subjectId: 'seed', role: 'SUPER_ADMIN' },
      async () => {
        const passwordHash = await bcrypt.hash(PASSWORD, 4);
        const branch = await prisma.branch.create({
          data: { name: 'HQ', address: 'X', geofenceLat: 0, geofenceLng: 0, strictMode: false, tenantId: tenant.id },
        });
        const dept = await prisma.department.create({ data: { name: SHARED.department, tenantId: tenant.id } });
        const desig = await prisma.designation.create({ data: { name: 'Executive', tenantId: tenant.id } });
        const shift = await prisma.shift.create({
          data: { name: 'General', startTime: '09:00', endTime: '18:00', tenantId: tenant.id },
        });
        await prisma.adminUser.create({
          data: { name: `${slug} admin`, email: SHARED.email, passwordHash, role: 'SUPER_ADMIN', tenantId: tenant.id },
        });
        const employee = await prisma.employee.create({
          data: {
            employeeCode: SHARED.employeeCode, name: `${slug} employee`, phone: SHARED.phone,
            branchId: branch.id, departmentId: dept.id, designationId: desig.id, shiftId: shift.id,
            joiningDate: new Date('2026-01-01'), salary: 30000, passwordHash, tenantId: tenant.id,
          },
        });
        const attendance = await prisma.attendance.create({
          data: {
            employeeId: employee.id, date: new Date('2026-07-01'),
            checkIn: new Date('2026-07-01T09:00:00Z'), status: 'PRESENT',
            approvalStatus: 'PENDING', tenantId: tenant.id,
          },
        });
        const claim = await prisma.claim.create({
          data: {
            claimNo: 1, employeeId: employee.id, type: 'PETROL_EXPENSES',
            title: `${slug} claim`, amount: 100, status: 'PENDING', tenantId: tenant.id,
          },
        });
        const leave = await prisma.leave.create({
          data: {
            employeeId: employee.id, type: 'CL', fromDate: new Date('2026-07-10'),
            toDate: new Date('2026-07-10'), days: 1, reason: 'x', status: 'PENDING', tenantId: tenant.id,
          },
        });
        return { branchId: branch.id, employeeId: employee.id, attendanceId: attendance.id, claimId: claim.id, leaveId: leave.id };
      },
    );

    const adminRes = await app.inject({
      method: 'POST', url: '/api/auth/admin/login', headers: { 'x-tenant-slug': slug },
      payload: { email: SHARED.email, password: PASSWORD },
    });
    expect(adminRes.statusCode, `admin login for ${slug}: ${adminRes.body}`).toBe(200);

    const empRes = await app.inject({
      method: 'POST', url: '/api/auth/employee-login', headers: { 'x-tenant-slug': slug },
      payload: { phone: SHARED.phone, password: PASSWORD },
    });
    expect(empRes.statusCode, `employee login for ${slug}: ${empRes.body}`).toBe(200);

    return {
      slug, tenantId: tenant.id, ...ids,
      adminToken: adminRes.json().token,
      employeeToken: empRes.json().token,
    };
  }

  beforeAll(async () => {
    process.env.DATABASE_URL = TEST_DATABASE_URL;
    const { buildServer } = await import('../src/server.js');
    app = await buildServer();
    await app.ready();

    // Fresh slate, children before parents.
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
    await p.tenant.deleteMany({});

    A = await seed('alpha');
    B = await seed('bravo');
  }, 60_000);

  afterAll(async () => {
    await app?.close();
  });

  it('seeds two tenants holding identical business keys', () => {
    expect(A.tenantId).not.toBe(B.tenantId);
    expect(A.employeeId).not.toBe(B.employeeId);
  });

  describe('list endpoints return only the caller’s tenant', () => {
    const listCases: { url: string; pick: (body: Record<string, unknown>) => unknown[] }[] = [
      { url: '/api/admin/employees', pick: (b) => b.employees as unknown[] },
      { url: '/api/admin/users', pick: (b) => b.admins as unknown[] },
      { url: '/api/admin/branches', pick: (b) => b.branches as unknown[] },
      { url: '/api/admin/departments', pick: (b) => b.departments as unknown[] },
      { url: '/api/admin/designations', pick: (b) => b.designations as unknown[] },
      { url: '/api/shifts', pick: (b) => b.shifts as unknown[] },
      { url: '/api/admin/claims', pick: (b) => b.claims as unknown[] },
      { url: '/api/admin/leaves/pending', pick: (b) => b.pending as unknown[] },
      { url: '/api/admin/attendance/approvals', pick: (b) => b.approvals as unknown[] },
      { url: '/api/admin/geofence', pick: (b) => b.branches as unknown[] },
    ];

    for (const { url, pick } of listCases) {
      it(`${url} shows one row, not two`, async () => {
        const res = await as(A.adminToken, A.slug, 'GET', url);
        expect(res.statusCode, res.body).toBe(200);
        const rows = pick(res.json());
        expect(rows).toHaveLength(1);
        expect(JSON.stringify(rows)).not.toContain('bravo');
      });
    }
  });

  describe('another tenant’s id is not found, rather than forbidden', () => {
    // 404 not 403: a 403 would confirm the row exists, which is itself a leak.
    it('GET /api/admin/employees/:id', async () => {
      const res = await as(A.adminToken, A.slug, 'GET', `/api/admin/employees/${B.employeeId}`);
      expect(res.statusCode).toBe(404);
    });

    it('PUT /api/admin/employees/:id cannot edit across tenants', async () => {
      const res = await as(A.adminToken, A.slug, 'PUT', `/api/admin/employees/${B.employeeId}`, { name: 'HACKED' });
      expect(res.statusCode).not.toBe(200);
      const check = await as(B.adminToken, B.slug, 'GET', `/api/admin/employees/${B.employeeId}`);
      expect(check.json().employee.name).toBe('bravo employee');
    });

    it('GET /api/claims/:id', async () => {
      const res = await as(A.adminToken, A.slug, 'GET', `/api/claims/${B.claimId}`);
      expect(res.statusCode).toBe(404);
    });

    it('PATCH /api/admin/claims/:id/approve', async () => {
      const res = await as(A.adminToken, A.slug, 'PATCH', `/api/admin/claims/${B.claimId}/approve`);
      expect(res.statusCode).toBe(404);
      const still = await as(B.adminToken, B.slug, 'GET', `/api/claims/${B.claimId}`);
      expect(still.json().claim.status).toBe('PENDING');
    });

    it('PATCH /api/admin/attendance/:id/approve', async () => {
      const res = await as(A.adminToken, A.slug, 'PATCH', `/api/admin/attendance/${B.attendanceId}/approve`);
      expect(res.statusCode).toBe(404);
    });

    it('PATCH /api/admin/leaves/:id/approve', async () => {
      const res = await as(A.adminToken, A.slug, 'PATCH', `/api/admin/leaves/${B.leaveId}/approve`, {});
      expect(res.statusCode).toBe(404);
    });

    it('PUT /api/admin/geofence/:branchId', async () => {
      const res = await as(A.adminToken, A.slug, 'PUT', `/api/admin/geofence/${B.branchId}`, { geofenceRadius: 9999 });
      expect(res.statusCode).not.toBe(200);
    });
  });

  describe('aggregate surfaces', () => {
    it('dashboard stats count one employee, not two', async () => {
      const res = await as(A.adminToken, A.slug, 'GET', '/api/admin/dashboard/stats');
      expect(res.statusCode, res.body).toBe(200);
      expect(res.json().totalStaff).toBe(1);
      expect(res.json().branches).toBe(1);
    });

    it('live attendance shows only this tenant', async () => {
      const res = await as(A.adminToken, A.slug, 'GET', '/api/admin/attendance/live');
      expect(res.statusCode).toBe(200);
      expect(JSON.stringify(res.json())).not.toContain('bravo');
    });

    it('a report cannot be widened by passing another tenant’s branchId', async () => {
      // reports take branchId straight from the query string — the scoping has
      // to come from the tenant filter, not from trusting the caller.
      const res = await as(A.adminToken, A.slug, 'GET', `/api/admin/reports/daily?date=2026-07-01&branchId=${B.branchId}`);
      expect(res.statusCode, res.body).toBe(200);
      expect(JSON.stringify(res.json())).not.toContain('bravo');
    });

    it('payroll runs for one tenant only', async () => {
      const res = await as(A.adminToken, A.slug, 'POST', '/api/admin/payroll/run', { month: 7, year: 2026 });
      expect(res.statusCode, res.body).toBe(200);

      const mine = await as(A.adminToken, A.slug, 'GET', '/api/admin/payroll/payslips/7/2026');
      expect(mine.json().payslips).toHaveLength(1);

      const theirs = await as(B.adminToken, B.slug, 'GET', '/api/admin/payroll/payslips/7/2026');
      expect(theirs.json().payslips, 'payroll for alpha must not create payslips for bravo').toHaveLength(0);
    });
  });

  describe('per-tenant numbering', () => {
    it('each tenant has its own claim number 1', async () => {
      const a = await as(A.adminToken, A.slug, 'GET', `/api/claims/${A.claimId}`);
      const b = await as(B.adminToken, B.slug, 'GET', `/api/claims/${B.claimId}`);
      expect(a.json().claim.claimNo).toBe(1);
      expect(b.json().claim.claimNo).toBe(1);
    });
  });


  /**
   * Coverage guard.
   *
   * Isolation only holds if the scoping is actually reached on every route, so
   * a route that nobody has classified is a gap by definition. Every route must
   * be in exactly one of three buckets, and a newly added route lands in none —
   * failing this test until someone decides which it is.
   *
   * NOT_YET_ASSERTED is the honest bucket: those routes inherit scoping from the
   * Prisma extension (which `tenancy-extension.test.ts` proves) but have no
   * end-to-end assertion of their own yet. Shrink it over time; never grow it
   * without reading the route first.
   */
  const COVERED = [
    'GET /api/admin/employees',
    'GET /api/admin/users',
    'GET /api/admin/branches',
    'GET /api/admin/departments',
    'GET /api/admin/designations',
    'GET /api/shifts',
    'GET /api/admin/claims',
    'GET /api/admin/leaves/pending',
    'GET /api/admin/attendance/approvals',
    'GET /api/admin/geofence',
    'GET /api/admin/employees/:id',
    'PUT /api/admin/employees/:id',
    'GET /api/claims/:id',
    'PATCH /api/admin/claims/:id/approve',
    'PATCH /api/admin/attendance/:id/approve',
    'PATCH /api/admin/leaves/:id/approve',
    'PUT /api/admin/geofence/:branchId',
    'GET /api/admin/dashboard/stats',
    'GET /api/admin/attendance/live',
    'GET /api/admin/reports/daily',
    'POST /api/admin/payroll/run',
    'GET /api/admin/payroll/payslips/:month/:year',
    'GET /api/leaves/my-leaves',
  ];

  const NO_TENANT_DATA = [
    'GET /api/health',
    'GET /api/app/version',
    'GET /api/app/download',
    'GET /api/whatsapp/webhook',
    'POST /api/whatsapp/webhook',
    'POST /api/auth/admin/google',
    'POST /api/auth/admin/login',
    'POST /api/auth/employee-login',
    'POST /api/auth/refresh-token',
    'GET /api/auth/workspace/:slug',
    'GET /api/claims/types',
    'GET /api/admin/whatsapp/templates',
  ];

  const NOT_YET_ASSERTED = [
    'DELETE /api/admin/branches/:id',
    'DELETE /api/admin/departments/:id',
    'DELETE /api/admin/designations/:id',
    'DELETE /api/admin/employees/:id',
    'DELETE /api/admin/employees/:id/face',
    'DELETE /api/admin/shifts/:id',
    'GET /api/admin/attendance/:id/selfie',
    'GET /api/admin/attendance/month-summary',
    'GET /api/admin/claims/stats',
    'GET /api/admin/company',
    'GET /api/admin/dashboard/trend',
    'GET /api/admin/employees/managers',
    'GET /api/admin/employees/next-code',
    'GET /api/admin/geofence/violations',
    'GET /api/admin/leaves/balances',
    'GET /api/admin/notifications',
    'GET /api/admin/payroll/payslips/:id/pdf',
    'GET /api/admin/payroll/preview/:month/:year',
    'GET /api/admin/payroll/register/:month/:year/pdf',
    'GET /api/admin/reports/employee/:id',
    'GET /api/admin/reports/late',
    'GET /api/admin/reports/monthly',
    'GET /api/admin/reports/monthly-performance',
    'GET /api/admin/reports/payroll-summary',
    'GET /api/admin/reports/performance',
    'GET /api/admin/whatsapp/logs',
    'GET /api/attendance/calendar',
    'GET /api/attendance/history',
    'GET /api/attendance/missing-checkout',
    'GET /api/attendance/today',
    'GET /api/claims/:id/file',
    'GET /api/claims/:id/voucher',
    'GET /api/claims/my-claims',
    'GET /api/geofence/check',
    'GET /api/leaves/balance',
    'GET /api/me',
    'GET /api/me/photo',
    'GET /api/payroll/my-payslips',
    'GET /api/payroll/my-payslips/:id/pdf',
    'GET /api/shifts/my-schedule',
    'PATCH /api/admin/attendance/:id/override',
    'PATCH /api/admin/attendance/:id/reject',
    'PATCH /api/admin/claims/:id/clarify',
    'PATCH /api/admin/claims/:id/pay',
    'PATCH /api/admin/claims/:id/reject',
    'PATCH /api/admin/leaves/:id/reject',
    'PATCH /api/admin/notifications/read',
    'POST /api/admin/attendance/manual-punch',
    'POST /api/admin/branches',
    'POST /api/admin/departments',
    'POST /api/admin/designations',
    'POST /api/admin/employees',
    'POST /api/admin/employees/:id/enroll-face',
    'POST /api/admin/employees/bulk-import',
    'POST /api/admin/employees/:id/reset-password',
    'POST /api/admin/payroll/send-slips',
    'POST /api/admin/shifts',
    'POST /api/admin/shifts/assign',
    'POST /api/admin/users',
    'POST /api/admin/whatsapp/broadcast',
    'POST /api/admin/whatsapp/send',
    'POST /api/attendance/checkin',
    'POST /api/attendance/checkout',
    'POST /api/attendance/manual-punch',
    'POST /api/claims',
    'POST /api/claims/:id/reply',
    'POST /api/claims/:id/resubmit',
    'POST /api/leaves/apply',
    'POST /api/me/fcm-token',
    'PUT /api/admin/branches/:id',
    'PUT /api/admin/company',
    'PUT /api/admin/departments/:id',
    'PUT /api/admin/designations/:id',
    'PUT /api/admin/leaves/balances/:employeeId',
    'PUT /api/admin/shifts/:id',
    'PUT /api/admin/users/:id',
  ];

  /**
   * The platform surface. Not tenant-scoped by design: platform staff belong to
   * no tenant, so `requirePlatform` runs these under a PLATFORM context that the
   * Prisma extension lets through. That is a deliberate hole, which is why it is
   * confined to this one route group and covered separately by
   * tests/platform.test.ts — including that a dealer's token cannot reach it and
   * a platform token cannot reach a dealer's data.
   */
  const PLATFORM_SURFACE = [
    'POST /api/platform/auth/login',
    'GET /api/platform/me',
    'PATCH /api/platform/me/password',
    'GET /api/platform/tenants',
    'POST /api/platform/tenants',
    'GET /api/platform/tenants/:id',
    'PATCH /api/platform/tenants/:id',
    'PATCH /api/platform/tenants/:id/status',
    'POST /api/platform/tenants/:id/admins',
    'GET /api/platform/audit',
  ];

  it('classifies every registered route', () => {
    const classified = new Set([...COVERED, ...NO_TENANT_DATA, ...NOT_YET_ASSERTED, ...PLATFORM_SURFACE]);
    const registered = [...new Set(app.routeList)].sort();

    const unclassified = registered.filter((r) => !classified.has(r));
    expect(
      unclassified,
      'new route(s) with no isolation decision — add to COVERED (and write the test), ' +
        'NO_TENANT_DATA, or NOT_YET_ASSERTED',
    ).toEqual([]);

    // And the reverse: a bucket entry for a route that no longer exists is dead
    // weight that would hide a real gap.
    const stale = [...classified].filter((r) => !registered.includes(r)).sort();
    expect(stale, 'classified routes that are no longer registered').toEqual([]);
  });

  describe('tokens are bound to their tenant', () => {
    it('a token replayed against another tenant’s URL is rejected', async () => {
      const res = await as(A.adminToken, B.slug, 'GET', '/api/admin/employees');
      expect(res.statusCode).toBe(401);
    });

    it('an employee sees only their own leave', async () => {
      const res = await as(A.employeeToken, A.slug, 'GET', '/api/leaves/my-leaves');
      expect(res.statusCode).toBe(200);
      expect(res.json().leaves).toHaveLength(1);
    });

    it('a suspended tenant cannot be used', async () => {
      await app.prisma.tenant.update({ where: { id: B.tenantId }, data: { status: 'SUSPENDED' } });
      const res = await as(B.adminToken, B.slug, 'GET', '/api/admin/employees');
      expect(res.statusCode).toBe(403);
      await app.prisma.tenant.update({ where: { id: B.tenantId }, data: { status: 'ACTIVE' } });
    });
  });
});
