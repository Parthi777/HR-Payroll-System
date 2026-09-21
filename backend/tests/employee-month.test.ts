/**
 * What the phone app reads about a month, and about who to ring.
 *
 * Three things the app now leans on that nothing pinned before:
 *
 *   - the calendar summary is the app's *only* source of monthly figures, so
 *     its worked minutes and pending count have to be right — the home screen
 *     previously counted the last thirty records and called it "this month";
 *   - a selfie punch may carry the phone's location, and the approver sees it;
 *   - an employee can read the dealership's HR contact and nothing else from
 *     a settings screen that is otherwise admin-only.
 *
 * Needs a database (see tests/isolation.test.ts); skips without one.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import bcrypt from 'bcrypt';
import type { FastifyInstance } from 'fastify';
import { platformSignIn } from './support/platform-session.js';

const TEST_DATABASE_URL = process.env.TEST_DATABASE_URL;
const suite = TEST_DATABASE_URL ? describe : describe.skip;

// No AWS in this suite: a selfie punch would otherwise be asked to match a face
// that was never enrolled. The punch path itself is what is under test.
process.env.AWS_ACCESS_KEY_ID = '';
process.env.AWS_SECRET_ACCESS_KEY = '';

const PLATFORM = { email: 'owner@platform.test', name: 'Platform Owner', password: 'platform-owner-pass' };
const DEALER_PASSWORD = 'dealer-admin-password';
const OWNER = 'owner@month.test';
const SLUG = 'month-motors';
const STAFF_PASSWORD = 'employee-app-password';
const STAFF_PHONE = '+919000055555';

/** A one-pixel JPEG — the bytes only have to exist. */
const SELFIE = Buffer.from(
  '/9j/4AAQSkZJRgABAQEAYABgAAD/2wBDAAgGBgcGBQgHBwcJCQgKDBQNDAsLDBkSEw8UHRofHh0aHBwgJC4nICIsIxwcKDcpLDAxNDQ0Hyc5PTgyPC4zNDL/wAALCAABAAEBAREA/8QAFAABAAAAAAAAAAAAAAAAAAAACf/EABQQAQAAAAAAAAAAAAAAAAAAAAD/2gAIAQEAAD8AKp//2Q==',
  'base64',
);

suite('what an employee reads about their month', () => {
  let app: FastifyInstance;
  let adminToken: string;
  let staffToken: string;
  let employeeId: string;

  let ipCounter = 0;
  const freshIp = () => `10.9.${Math.floor(++ipCounter / 250)}.${ipCounter % 250}`;

  const asAdmin = (method: 'GET' | 'POST' | 'PUT' | 'PATCH', url: string, payload?: unknown) =>
    app.inject({
      method, url, remoteAddress: freshIp(),
      headers: { authorization: `Bearer ${adminToken}`, 'x-tenant-slug': SLUG },
      ...(payload === undefined ? {} : { payload: payload as object }),
    });

  const asStaff = (method: 'GET' | 'POST', url: string, payload?: unknown) =>
    app.inject({
      method, url, remoteAddress: freshIp(),
      headers: { authorization: `Bearer ${staffToken}`, 'x-tenant-slug': SLUG },
      ...(payload === undefined ? {} : { payload: payload as object }),
    });

  /** A selfie punch as the app sends it: multipart, optionally with a location. */
  async function selfiePunch(fields: Record<string, string>) {
    const boundary = '----monthtest';
    const parts: Buffer[] = [];
    for (const [name, value] of Object.entries(fields)) {
      parts.push(Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="${name}"\r\n\r\n${value}\r\n`));
    }
    parts.push(
      Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="selfie"; filename="s.jpg"\r\nContent-Type: image/jpeg\r\n\r\n`),
      SELFIE,
      Buffer.from(`\r\n--${boundary}--\r\n`),
    );
    return app.inject({
      method: 'POST', url: '/api/attendance/manual-punch', remoteAddress: freshIp(),
      headers: {
        authorization: `Bearer ${staffToken}`,
        'x-tenant-slug': SLUG,
        'content-type': `multipart/form-data; boundary=${boundary}`,
      },
      payload: Buffer.concat(parts),
    });
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
      method: 'POST', url: '/api/platform/tenants',
      headers: { authorization: `Bearer ${platformToken}` },
      payload: { slug: SLUG, name: 'Month Motors', admin: { name: 'Owner', email: OWNER, password: DEALER_PASSWORD } },
    });
    expect(made.statusCode, made.body).toBe(201);

    const signIn = await app.inject({
      method: 'POST', url: '/api/auth/admin/login', remoteAddress: freshIp(),
      headers: { 'x-tenant-slug': SLUG },
      payload: { email: OWNER, password: DEALER_PASSWORD },
    });
    expect(signIn.statusCode, signIn.body).toBe(200);
    adminToken = signIn.json().token;

    const [branches, departments, designations] = (
      await Promise.all(['branches', 'departments', 'designations'].map((k) => asAdmin('GET', `/api/admin/${k}`)))
    ).map((r) => r.json());
    const shifts = (await asAdmin('GET', '/api/shifts')).json().shifts;

    const created = await asAdmin('POST', '/api/admin/employees', {
      name: 'Month Staffer', phone: STAFF_PHONE,
      branchId: branches.branches[0].id,
      departmentId: departments.departments[0].id,
      designationId: designations.designations[0].id,
      shiftId: shifts[0].id,
      joiningDate: '2026-01-01', salary: 24000, password: STAFF_PASSWORD,
    });
    expect(created.statusCode, created.body).toBe(200);
    employeeId = created.json().employee.id;

    const staffIn = await app.inject({
      method: 'POST', url: '/api/auth/employee-login', remoteAddress: freshIp(),
      headers: { 'x-tenant-slug': SLUG },
      payload: { phone: STAFF_PHONE, password: STAFF_PASSWORD },
    });
    expect(staffIn.statusCode, staffIn.body).toBe(200);
    staffToken = staffIn.json().token;
  }, 90_000);

  afterAll(async () => {
    await app?.close();
  });

  describe('the month summary', () => {
    const now = new Date();
    const month = now.getMonth() + 1;
    const year = now.getFullYear();

    it('counts the hours actually worked, not just the days', async () => {
      // A settled day: in at 09:00, out at 17:30 — eight and a half hours.
      const day = new Date(year, month - 1, Math.min(10, now.getDate())).toISOString().slice(0, 10);
      const punch = await asAdmin('POST', '/api/admin/attendance/manual-punch', {
        employeeId, mode: 'MANUAL', date: day, checkIn: '09:00', checkOut: '17:30',
        reason: 'fixture for the month summary',
      });
      expect(punch.statusCode, punch.body).toBe(200);

      const res = await asStaff('GET', `/api/attendance/calendar?month=${month}&year=${year}`);
      expect(res.statusCode, res.body).toBe(200);
      const { summary } = res.json();
      expect(summary.workedMinutes).toBe(510);
      // Raised by HR, so it is still waiting on the manager and is not yet paid.
      expect(summary.pending).toBeGreaterThanOrEqual(1);
    });

    it('is zero for a month the employee had not joined', async () => {
      const res = await asStaff('GET', '/api/attendance/calendar?month=11&year=2025');
      expect(res.statusCode, res.body).toBe(200);
      const { summary } = res.json();
      expect(summary.workedMinutes).toBe(0);
      expect(summary.present).toBe(0);
      // Before joining is counted nowhere — not present, and not absent either.
      expect(summary.absent).toBe(0);
    });
  });

  describe('a selfie punch that knows where it was', () => {
    it('keeps the coordinates, and shows them to whoever approves it', async () => {
      const today = new Date().toISOString().slice(0, 10);
      const res = await selfiePunch({
        mode: 'SELFIE', date: today, checkIn: '09:20',
        reason: 'Site visit at the Erode yard — no signal inside the shed',
        lat: '11.34120', lng: '77.71720', accuracy: '18',
      });
      expect(res.statusCode, res.body).toBe(200);

      const approvals = await asAdmin('GET', '/api/admin/attendance/approvals');
      expect(approvals.statusCode, approvals.body).toBe(200);
      const mine = (approvals.json().approvals as { employeeCode: string; lat: number | null; lng: number | null; punchMode: string }[])
        .find((a) => a.punchMode === 'SELFIE');
      expect(mine, 'the selfie punch never reached the approvals queue').toBeDefined();
      expect(mine!.lat).toBeCloseTo(11.3412, 4);
      expect(mine!.lng).toBeCloseTo(77.7172, 4);
    });

    it('still goes through from a phone with no fix, rather than blocking the punch', async () => {
      const yesterday = new Date(Date.now() - 86_400_000).toISOString().slice(0, 10);
      const res = await selfiePunch({
        mode: 'SELFIE', date: yesterday, checkIn: '09:05',
        reason: 'Basement workshop, GPS could not get a fix',
        lat: '0', lng: '0',
      });
      expect(res.statusCode, res.body).toBe(200);

      // (0,0) is "no fix", not the Gulf of Guinea: nothing is stored.
      const { runInTenant } = await import('../src/context/tenant-context.js');
      const tenant = await app.prisma.tenant.findUniqueOrThrow({ where: { slug: SLUG } });
      const row = await runInTenant(
        { tenantId: tenant.id, subjectId: 'test', role: 'SUPER_ADMIN' },
        () => app.prisma.attendance.findFirstOrThrow({
          where: { employeeId, date: new Date(`${yesterday}T00:00:00`) },
        }),
      );
      expect(row.checkInLat).toBeNull();
      expect(row.checkInLng).toBeNull();
    });
  });

  describe('the HR contact', () => {
    it('is not readable through the settings screen an employee cannot open', async () => {
      const res = await asStaff('GET', '/api/admin/company');
      expect(res.statusCode).toBe(403);
    });

    it('reaches the app once it is set, and hides itself until then', async () => {
      const before = await asStaff('GET', '/api/me');
      expect(before.statusCode, before.body).toBe(200);
      // Nothing configured: the app is told there is nobody to ring.
      expect(before.json().hr).toBeNull();

      const saved = await asAdmin('PUT', '/api/admin/company', {
        hrContactName: 'Latha · HR', hrContactPhone: '+919000012121',
      });
      expect(saved.statusCode, saved.body).toBe(200);

      const after = await asStaff('GET', '/api/me');
      expect(after.json().hr).toEqual({ name: 'Latha · HR', phone: '+919000012121' });
      // And nothing else from the company profile leaks through this route.
      expect(Object.keys(after.json().hr)).toEqual(['name', 'phone']);
      expect(after.body).not.toContain('gstin');
    });

    it('falls back to the company number when only a name is filled in', async () => {
      const saved = await asAdmin('PUT', '/api/admin/company', {
        hrContactName: 'Front Office', hrContactPhone: '', phone: '+914242424242',
      });
      expect(saved.statusCode, saved.body).toBe(200);

      const res = await asStaff('GET', '/api/me');
      expect(res.json().hr).toEqual({ name: 'Front Office', phone: '+914242424242' });
    });
  });
});
