/**
 * "Show payroll to employees": the dealer's switch for the app's Payroll tab.
 *
 * Off by default — sharing pay with staff is each dealer's decision. While it
 * is off the employee's payslips, the payslip PDF and the monthly statement
 * are refused by the server, not merely hidden by the app; on, they open, and
 * still only ever for the employee's own records.
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
const DEALER_PASSWORD = 'dealer-admin-password';
const OWNER = 'owner@visible.test';
const HR = 'hr@visible.test';
const SLUG = 'visible-motors';
const STAFF = { phone: '+919000066601', password: 'employee-app-password' };
const OTHER = { phone: '+919000066602', password: 'employee-app-password' };

suite('showing payroll to employees', () => {
  let app: FastifyInstance;
  let ownerToken: string;
  let hrToken: string;
  let staffToken: string;
  let otherPayslipId: string;

  let ipCounter = 0;
  const freshIp = () => `10.12.${Math.floor(++ipCounter / 250)}.${ipCounter % 250}`;
  const as = (token: string, method: 'GET' | 'POST' | 'PUT', url: string, payload?: unknown) =>
    app.inject({
      method, url, remoteAddress: freshIp(),
      headers: { authorization: `Bearer ${token}`, 'x-tenant-slug': SLUG },
      ...(payload === undefined ? {} : { payload: payload as object }),
    });
  const setVisible = async (on: boolean) => {
    const res = await as(hrToken, 'PUT', '/api/admin/company', { payrollVisibleToEmployees: on });
    expect(res.statusCode, res.body).toBe(200);
  };

  const now = new Date();
  const month = now.getMonth() + 1;
  const year = now.getFullYear();

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
    const platformToken = await platformSignIn(app, PLATFORM, freshIp);
    const made = await app.inject({
      method: 'POST', url: '/api/platform/tenants', remoteAddress: freshIp(),
      headers: { authorization: `Bearer ${platformToken}` },
      payload: { slug: SLUG, name: 'Visible Motors', admin: { name: 'Owner', email: OWNER, password: DEALER_PASSWORD } },
    });
    expect(made.statusCode, made.body).toBe(201);

    ownerToken = (await adminSignIn(app, { slug: SLUG, email: OWNER, password: DEALER_PASSWORD }, freshIp)).json().token;
    const hrMade = await as(ownerToken, 'POST', '/api/admin/users', { name: 'HR', email: HR, role: 'HR_MANAGER', password: DEALER_PASSWORD });
    expect(hrMade.statusCode, hrMade.body).toBe(200);
    hrToken = (await adminSignIn(app, { slug: SLUG, email: HR, password: DEALER_PASSWORD }, freshIp)).json().token;

    const [branches, departments, designations] = (
      await Promise.all(['branches', 'departments', 'designations'].map((k) => as(ownerToken, 'GET', `/api/admin/${k}`)))
    ).map((r) => r.json());
    const shifts = (await as(ownerToken, 'GET', '/api/shifts')).json().shifts;
    for (const who of [STAFF, OTHER]) {
      const res = await as(ownerToken, 'POST', '/api/admin/employees', {
        name: who === STAFF ? 'Shown Staff' : 'Other Staff', phone: who.phone, password: who.password,
        branchId: branches.branches[0].id, departmentId: departments.departments[0].id,
        designationId: designations.designations[0].id, shiftId: shifts[0].id,
        joiningDate: '2026-01-01', salary: 20000,
      });
      expect(res.statusCode, res.body).toBe(200);
    }

    // A punch this month, and a payroll run so there are payslips to show.
    const staffRow = (await as(ownerToken, 'GET', '/api/admin/employees')).json().employees
      .find((e: { phone: string }) => e.phone === STAFF.phone);
    const day = `${year}-${String(month).padStart(2, '0')}-${String(Math.min(now.getDate(), 2)).padStart(2, '0')}`;
    const punch = await as(ownerToken, 'POST', '/api/admin/attendance/manual-punch', {
      employeeId: staffRow.id, mode: 'MANUAL', date: day, checkIn: '09:00', checkOut: '18:00', reason: 'statement fixture',
    });
    expect(punch.statusCode, punch.body).toBe(200);
    const run = await as(ownerToken, 'POST', '/api/admin/payroll/run', { month, year });
    expect(run.statusCode, run.body).toBe(200);

    const otherRow = (await as(ownerToken, 'GET', '/api/admin/employees')).json().employees
      .find((e: { phone: string }) => e.phone === OTHER.phone);
    const { runInTenant } = await import('../src/context/tenant-context.js');
    const tenantId = (await p.tenant.findUniqueOrThrow({ where: { slug: SLUG } })).id;
    otherPayslipId = await runInTenant({ tenantId, subjectId: 'test', role: 'SUPER_ADMIN' }, async () =>
      (await p.payslip.findFirstOrThrow({ where: { employeeId: otherRow.id } })).id,
    );

    const login = await app.inject({
      method: 'POST', url: '/api/auth/employee-login', remoteAddress: freshIp(),
      headers: { 'x-tenant-slug': SLUG }, payload: { userId: STAFF.phone, password: STAFF.password },
    });
    expect(login.statusCode, login.body).toBe(200);
    staffToken = login.json().token;
  }, 120_000);

  afterAll(async () => {
    await app?.close();
  });

  it('is off by default: the app is told so, and the server refuses', async () => {
    const me = await as(staffToken, 'GET', '/api/me');
    expect(me.json().payrollVisible).toBe(false);

    const list = await as(staffToken, 'GET', '/api/payroll/my-payslips');
    expect(list.statusCode).toBe(403);
    expect(list.json().message).toMatch(/not shared payroll/i);
    expect((await as(staffToken, 'GET', `/api/attendance/my-statement?month=${month}&year=${year}`)).statusCode).toBe(403);
  });

  it('leaves administrators on their own route, whatever the switch says', async () => {
    const res = await as(ownerToken, 'GET', `/api/admin/payroll/payslips/${otherPayslipId}/pdf`);
    expect(res.statusCode, res.body).toBe(200);
    // The employee route is for employees only.
    expect((await as(ownerToken, 'GET', `/api/payroll/my-payslips/${otherPayslipId}/pdf`)).statusCode).toBe(403);
  });

  it('once an HR Manager turns it on, opens payslips and the statement', async () => {
    await setVisible(true);

    expect((await as(staffToken, 'GET', '/api/me')).json().payrollVisible).toBe(true);

    const list = await as(staffToken, 'GET', '/api/payroll/my-payslips');
    expect(list.statusCode, list.body).toBe(200);
    const slips = list.json().payslips as { id: string; month: number; year: number }[];
    expect(slips.length).toBe(1);

    const pdf = await as(staffToken, 'GET', `/api/payroll/my-payslips/${slips[0].id}/pdf`);
    expect(pdf.statusCode, pdf.body).toBe(200);
    expect(pdf.headers['content-type']).toMatch(/application\/pdf/);

    const statement = await as(staffToken, 'GET', `/api/attendance/my-statement?month=${month}&year=${year}`);
    expect(statement.statusCode, statement.body).toBe(200);
    expect(statement.headers['content-type']).toMatch(/application\/pdf/);
    expect(String(statement.headers['content-disposition'])).toMatch(/attachment; filename="statement-.+\.pdf"/);
    expect(statement.rawPayload.subarray(0, 4).toString()).toBe('%PDF');
  });

  it('still shows only the employee’s own records', async () => {
    expect((await as(staffToken, 'GET', `/api/payroll/my-payslips/${otherPayslipId}/pdf`)).statusCode).toBe(403);
  });

  it('refuses a statement for a month before the workspace began', async () => {
    const before = new Date(year, month - 2, 1);
    const res = await as(staffToken, 'GET', `/api/attendance/my-statement?month=${before.getMonth() + 1}&year=${before.getFullYear()}`);
    expect(res.statusCode).toBe(400);
  });

  it('closes again when it is turned off', async () => {
    await setVisible(false);
    expect((await as(staffToken, 'GET', '/api/payroll/my-payslips')).statusCode).toBe(403);
    expect((await as(staffToken, 'GET', '/api/me')).json().payrollVisible).toBe(false);
  });
});
