/**
 * Who may reshape a dealer's set-up — branches, departments, designations.
 *
 * A branch manager reads these lists (they fill the employee form) but may not
 * change them. A branch carries its geofence, and PUT /admin/geofence was
 * already closed to them; PUT /admin/branches/:id writes the same fields and
 * was not, so a branch manager could widen the fence their own staff punch in.
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
const SLUG = 'roles';

suite('master data is the owner’s and HR’s to change', () => {
  let app: FastifyInstance;
  let owner: string;
  let manager: string;
  let branchId: string;

  let ipCounter = 0;
  const freshIp = () => `10.15.${Math.floor(++ipCounter / 250)}.${ipCounter % 250}`;
  const as = (token: string, method: 'GET' | 'POST' | 'PUT' | 'DELETE', url: string, payload?: unknown) =>
    app.inject({
      method, url, remoteAddress: freshIp(),
      headers: { authorization: `Bearer ${token}`, 'x-tenant-slug': SLUG },
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
      payload: { slug: SLUG, name: 'Roles Motors', admin: { name: 'Owner', email: 'owner@roles.test', password: PASSWORD } },
    });
    expect(made.statusCode, made.body).toBe(201);
    owner = (await adminSignIn(app, { slug: SLUG, email: 'owner@roles.test', password: PASSWORD }, freshIp)).json().token;

    branchId = (await as(owner, 'GET', '/api/admin/branches')).json().branches[0].id;
    const created = await as(owner, 'POST', '/api/admin/users', {
      name: 'Branch Boss', email: 'boss@roles.test', role: 'BRANCH_MANAGER', password: PASSWORD, branchId,
    });
    expect(created.statusCode, created.body).toBe(200);
    manager = (await adminSignIn(app, { slug: SLUG, email: 'boss@roles.test', password: PASSWORD }, freshIp)).json().token;
  }, 60_000);

  afterAll(async () => {
    await app?.close();
  });

  it('a branch manager still reads the lists', async () => {
    for (const list of ['branches', 'departments', 'designations']) {
      const res = await as(manager, 'GET', `/api/admin/${list}`);
      expect(res.statusCode, `${list}: ${res.body}`).toBe(200);
    }
  });

  it('a branch manager cannot move or widen a branch’s geofence', async () => {
    const res = await as(manager, 'PUT', `/api/admin/branches/${branchId}`, { geofenceRadius: 1_000_000, strictMode: false });
    expect(res.statusCode, res.body).toBe(403);
    const branch = (await as(owner, 'GET', '/api/admin/branches')).json().branches[0];
    expect(branch.geofenceRadius).toBe(100);
  });

  it('a branch manager cannot add or delete branches, departments or designations', async () => {
    const attempts = [
      as(manager, 'POST', '/api/admin/branches', { name: 'Rogue', address: 'X', geofenceLat: 11, geofenceLng: 77 }),
      as(manager, 'DELETE', `/api/admin/branches/${branchId}`),
      as(manager, 'POST', '/api/admin/departments', { name: 'Rogue' }),
      as(manager, 'POST', '/api/admin/designations', { name: 'Rogue' }),
    ];
    for (const res of await Promise.all(attempts)) expect(res.statusCode, res.body).toBe(403);
  });

  it('a branch manager edits their own branch’s staff, and only theirs', async () => {
    const lists = await Promise.all(['departments', 'designations'].map((k) => as(owner, 'GET', `/api/admin/${k}`)));
    const [departmentId, designationId] = [lists[0].json().departments[0].id, lists[1].json().designations[0].id];
    const shiftId = (await as(owner, 'GET', '/api/shifts')).json().shifts[0].id;
    const other = await as(owner, 'POST', '/api/admin/branches', { name: 'Other', address: 'Y', geofenceLat: 11, geofenceLng: 77 });
    expect(other.statusCode, other.body).toBe(200);

    const hire = async (phone: string, atBranch: string) => {
      const res = await as(owner, 'POST', '/api/admin/employees', {
        name: `Staff ${phone}`, phone, joiningDate: '2026-01-01', salary: 20000,
        branchId: atBranch, departmentId, designationId, shiftId,
      });
      expect(res.statusCode, res.body).toBe(200);
      return res.json().employee.id as string;
    };
    const mine = await hire('+919000000101', branchId);
    const theirs = await hire('+919000000102', other.json().branch.id);

    const own = await as(manager, 'PUT', `/api/admin/employees/${mine}`, { name: 'Renamed' });
    expect(own.statusCode, own.body).toBe(200);

    for (const res of [
      await as(manager, 'PUT', `/api/admin/employees/${theirs}`, { name: 'Renamed' }),
      await as(manager, 'POST', `/api/admin/employees/${theirs}/enroll-face`),
      await as(manager, 'DELETE', `/api/admin/employees/${theirs}/face`),
    ]) expect(res.statusCode, res.body).toBe(403);
    const check = await as(owner, 'GET', `/api/admin/employees/${theirs}`);
    expect(check.json().employee.name).toBe('Staff +919000000102');
  });

  it('the owner still can, within the geofence route’s bounds', async () => {
    const ok = await as(owner, 'PUT', `/api/admin/branches/${branchId}`, { geofenceRadius: 250 });
    expect(ok.statusCode, ok.body).toBe(200);
    const tooWide = await as(owner, 'PUT', `/api/admin/branches/${branchId}`, { geofenceRadius: 1_000_000 });
    expect(tooWide.statusCode, tooWide.body).toBe(422);
    const dept = await as(owner, 'POST', '/api/admin/departments', { name: 'Service' });
    expect(dept.statusCode, dept.body).toBe(200);
  });
});
