/**
 * Live tracking between check-in and check-out — who is tracked, what the
 * phone may upload, and who may watch.
 *
 * Off by default. On, a check-in from the employee's own phone starts a
 * tracked window that check-out (or switching it off) closes; an exempt
 * employee and a kiosk punch are never tracked. The phone can only add fixes
 * to its own open day, and the watching side follows the attendance roles —
 * a branch manager sees their own branch, PAYROLL_ADMIN sees nothing, and one
 * dealer never sees another's.
 *
 * Needs a database (see tests/isolation.test.ts); skips without one.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import bcrypt from 'bcrypt';
import type { FastifyInstance } from 'fastify';
import { platformSignIn } from './support/platform-session.js';
import { adminSignIn } from './support/admin-session.js';

// No face match: the check-ins below send no selfie.
process.env.AWS_ACCESS_KEY_ID = '';
process.env.AWS_SECRET_ACCESS_KEY = '';

const TEST_DATABASE_URL = process.env.TEST_DATABASE_URL;
const suite = TEST_DATABASE_URL ? describe : describe.skip;

const PLATFORM = { email: 'owner@platform.test', name: 'Platform Owner', password: 'platform-owner-pass' };
const PASSWORD = 'dealer-admin-password';
const SLUG = 'tracked-motors';
const OTHER_SLUG = 'elsewhere-motors';
const APP_PASSWORD = 'employee-app-password';
const A = { lat: 11.4, lng: 77.6 };
const B = { lat: 11.5, lng: 77.7 };

suite('live tracking', () => {
  let app: FastifyInstance;
  let tenantId: string;
  const tok: Record<string, string> = {};
  const emp: Record<string, { id: string; token: string }> = {};
  let branchA: string;
  let att1: string;
  let att3: string;
  let trackedFrom: Date;

  let ipCounter = 0;
  const freshIp = () => `10.14.${Math.floor(++ipCounter / 250)}.${ipCounter % 250}`;
  const as = (token: string, method: 'GET' | 'POST' | 'PUT', url: string, payload?: unknown, slug = SLUG) =>
    app.inject({
      method, url, remoteAddress: freshIp(),
      headers: { authorization: `Bearer ${token}`, 'x-tenant-slug': slug },
      ...(payload === undefined ? {} : { payload: payload as object }),
    });

  /** A check-in or check-out as the phone sends it: multipart, here without a selfie. */
  const punch = (token: string, kind: 'checkin' | 'checkout', at: { lat: number; lng: number }) => {
    const boundary = '----tracktest';
    const field = (k: string, v: string) => `--${boundary}\r\nContent-Disposition: form-data; name="${k}"\r\n\r\n${v}\r\n`;
    return app.inject({
      method: 'POST', url: `/api/attendance/${kind}`, remoteAddress: freshIp(),
      headers: { authorization: `Bearer ${token}`, 'x-tenant-slug': SLUG, 'content-type': `multipart/form-data; boundary=${boundary}` },
      payload: field('lat', String(at.lat)) + field('lng', String(at.lng)) + field('accuracy', '8') + `--${boundary}--\r\n`,
    });
  };

  const inTenant = async <T>(fn: () => Promise<T>) => {
    const { runInTenant } = await import('../src/context/tenant-context.js');
    return runInTenant({ tenantId, subjectId: 'tracking-test', role: 'SUPER_ADMIN' }, fn);
  };
  const setTracking = async (on: boolean) => {
    const res = await as(tok.hr, 'PUT', '/api/admin/company', { liveTrackingOn: on });
    expect(res.statusCode, res.body).toBe(200);
  };
  const plus = (ms: number) => new Date(trackedFrom.getTime() + ms).toISOString();

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
    for (const [slug, email] of [[SLUG, 'owner@tracked.test'], [OTHER_SLUG, 'owner@elsewhere.test']]) {
      const made = await app.inject({
        method: 'POST', url: '/api/platform/tenants', remoteAddress: freshIp(),
        headers: { authorization: `Bearer ${platformToken}` },
        payload: { slug, name: slug, admin: { name: 'Owner', email, password: PASSWORD } },
      });
      expect(made.statusCode, made.body).toBe(201);
    }
    tenantId = (await p.tenant.findUniqueOrThrow({ where: { slug: SLUG } })).id;
    tok.owner = (await adminSignIn(app, { slug: SLUG, email: 'owner@tracked.test', password: PASSWORD }, freshIp)).json().token;
    tok.otherOwner = (await adminSignIn(app, { slug: OTHER_SLUG, email: 'owner@elsewhere.test', password: PASSWORD }, freshIp)).json().token;

    const branch = async (name: string, at: { lat: number; lng: number }) => {
      const res = await as(tok.owner, 'POST', '/api/admin/branches', {
        name, address: name, geofenceLat: at.lat, geofenceLng: at.lng, geofenceRadius: 100, strictMode: false,
      });
      expect(res.statusCode, res.body).toBe(200);
      return (res.json().branch ?? res.json()).id as string;
    };
    branchA = await branch('Branch A', A);
    const branchB = await branch('Branch B', B);

    for (const [key, role, branchId] of [
      ['hr', 'HR_MANAGER', null], ['bm', 'BRANCH_MANAGER', branchA], ['payroll', 'PAYROLL_ADMIN', null],
    ] as const) {
      const email = `${key}@tracked.test`;
      const made = await as(tok.owner, 'POST', '/api/admin/users', { name: key, email, role, password: PASSWORD, branchId });
      expect(made.statusCode, made.body).toBe(200);
      tok[key] = (await adminSignIn(app, { slug: SLUG, email, password: PASSWORD }, freshIp)).json().token;
    }

    const [departments, designations] = (
      await Promise.all(['departments', 'designations'].map((k) => as(tok.owner, 'GET', `/api/admin/${k}`)))
    ).map((r) => r.json());
    const shifts = (await as(tok.owner, 'GET', '/api/shifts')).json().shifts as { id: string; isNightShift: boolean }[];
    const dayShift = shifts.find((s) => !s.isNightShift)!;
    for (const [key, phone, branchId] of [
      ['e1', '+919000077701', branchA], ['e2', '+919000077702', branchA],
      ['e3', '+919000077703', branchB], ['e4', '+919000077704', branchA],
      ['e5', '+919000077705', branchA],
    ] as const) {
      const res = await as(tok.owner, 'POST', '/api/admin/employees', {
        name: `Staff ${key}`, phone, password: APP_PASSWORD, branchId,
        departmentId: departments.departments[0].id, designationId: designations.designations[0].id,
        shiftId: dayShift.id, joiningDate: '2026-01-01', salary: 20000,
      });
      expect(res.statusCode, res.body).toBe(200);
      const login = await app.inject({
        method: 'POST', url: '/api/auth/employee-login', remoteAddress: freshIp(),
        headers: { 'x-tenant-slug': SLUG }, payload: { userId: phone, password: APP_PASSWORD },
      });
      expect(login.statusCode, login.body).toBe(200);
      emp[key] = { id: res.json().employee.id, token: login.json().token };
      // What 0.9.6+ does after sign-in. e5 stands for a phone on an older app,
      // which never asks for consent and has no tracking service.
      if (key !== 'e5') {
        const agreed = await as(login.json().token, 'POST', '/api/me/consent', { version: 1 });
        expect(agreed.statusCode, agreed.body).toBe(200);
      }
    }
  }, 120_000);

  afterAll(async () => {
    await app?.close();
  });

  it('is off by default, and a check-in then is not tracked', async () => {
    expect((await as(emp.e4.token, 'GET', '/api/me')).json().tracking).toEqual({ enabled: false, intervalSec: 120 });
    expect((await as(tok.hr, 'GET', '/api/admin/tracking/live')).json().enabled).toBe(false);
  });

  it('only HR and the owner can exempt someone', async () => {
    const byBm = await as(tok.bm, 'PUT', `/api/admin/employees/${emp.e1.id}`, { trackingExempt: true });
    expect(byBm.statusCode, byBm.body).toBe(200);
    expect(byBm.json().employee.trackingExempt).toBe(false);

    const byHr = await as(tok.hr, 'PUT', `/api/admin/employees/${emp.e2.id}`, { trackingExempt: true });
    expect(byHr.json().employee.trackingExempt).toBe(true);
  });

  it('switched on, a phone check-in is tracked and the app is told so', async () => {
    await setTracking(true);
    expect((await as(emp.e1.token, 'GET', '/api/me')).json().tracking.enabled).toBe(true);

    const res = await punch(emp.e1.token, 'checkin', A);
    expect(res.statusCode, res.body).toBe(200);
    expect(res.json().tracking).toMatchObject({ enabled: true, intervalSec: 120 });
    att1 = res.json().id;
    trackedFrom = new Date(res.json().checkIn);

    const resume = await as(emp.e1.token, 'GET', '/api/attendance/tracking');
    expect(resume.json()).toEqual({ enabled: true, intervalSec: 120, attendanceId: att1 });

    const e3 = await punch(emp.e3.token, 'checkin', B);
    expect(e3.json().tracking.enabled).toBe(true);
    att3 = e3.json().id;
  });

  it('a phone on an older app — no consent recorded — is not tracked', async () => {
    const res = await punch(emp.e5.token, 'checkin', A);
    expect(res.statusCode, res.body).toBe(200);
    expect(res.json().tracking.enabled).toBe(false);
  });

  it('an exempt employee is never tracked', async () => {
    expect((await as(emp.e2.token, 'GET', '/api/me')).json().tracking.enabled).toBe(false);
    const res = await punch(emp.e2.token, 'checkin', A);
    expect(res.statusCode, res.body).toBe(200);
    expect(res.json().tracking.enabled).toBe(false);
  });

  it('a kiosk punch is never tracked', async () => {
    const { markCheckIn } = await import('../src/services/attendance/attendance.service.js');
    const result = await inTenant(() => markCheckIn(app.prisma, emp.e4.id, null, A.lat, A.lng));
    expect(result.tracking.enabled).toBe(false);
    const row = await inTenant(() => app.prisma.attendance.findUniqueOrThrow({ where: { id: result.id } }));
    expect(row.trackingFrom).toBeNull();
  });

  it('stores fixes inside the window, drops the rest, and lands a re-sent batch once', async () => {
    const batch = {
      attendanceId: att1,
      points: [
        { ts: plus(10_000), lat: A.lat, lng: A.lng, accuracy: 8 },
        { ts: plus(20_000), lat: A.lat + 0.005, lng: A.lng, accuracy: 8 }, // ~550 m out
        { ts: plus(-10 * 60_000), lat: A.lat, lng: A.lng }, // before check-in
        { ts: plus(60 * 60_000), lat: A.lat, lng: A.lng }, // an hour in the future
      ],
      events: [{ ts: plus(15_000), kind: 'GPS_ON' }],
    };
    const first = await as(emp.e1.token, 'POST', '/api/attendance/gps-log', batch);
    expect(first.statusCode, first.body).toBe(200);
    expect(first.json()).toEqual({ tracking: true, intervalSec: 120, accepted: 3, dropped: 2 });

    const again = await as(emp.e1.token, 'POST', '/api/attendance/gps-log', batch);
    expect(again.json()).toMatchObject({ accepted: 0, dropped: 2 });

    const stored = await inTenant(() =>
      app.prisma.gPSLog.findMany({ where: { attendanceId: att1, kind: 'FIX' }, orderBy: { timestamp: 'asc' } }),
    );
    expect(stored.map((s) => s.geofenceStatus)).toEqual(['INSIDE', 'OUTSIDE']);
    expect(stored[1].employeeId).toBe(emp.e1.id);
  });

  it("refuses another employee's day and an admin token", async () => {
    const foreign = await as(emp.e3.token, 'POST', '/api/attendance/gps-log', { attendanceId: att1, points: [] });
    expect(foreign.statusCode).toBe(404);
    const admin = await as(tok.owner, 'POST', '/api/attendance/gps-log', { attendanceId: att1, points: [] });
    expect(admin.statusCode).toBe(403);
  });

  it('HR sees everyone tracked; a branch manager sees their branch; payroll sees nothing', async () => {
    const hr = (await as(tok.hr, 'GET', '/api/admin/tracking/live')).json();
    expect(hr.enabled).toBe(true);
    expect(hr.employees.map((e: { attendanceId: string }) => e.attendanceId).sort()).toEqual([att1, att3].sort());
    expect(hr.untrackedCheckedIn).toBe(3); // the exempt one, the kiosk punch, the old app
    const e1 = hr.employees.find((e: { attendanceId: string }) => e.attendanceId === att1);
    expect(e1.state).toBe('OUTSIDE');
    expect(e1.last).toMatchObject({ status: 'OUTSIDE' });

    const bm = (await as(tok.bm, 'GET', '/api/admin/tracking/live')).json();
    expect(bm.employees.map((e: { attendanceId: string }) => e.attendanceId)).toEqual([att1]);
    expect((await as(tok.bm, 'GET', `/api/admin/tracking/${att3}/track`)).statusCode).toBe(403);

    const track = await as(tok.hr, 'GET', `/api/admin/tracking/${att1}/track`);
    expect(track.statusCode, track.body).toBe(200);
    expect(track.json().points).toHaveLength(2);
    expect(track.json().events).toEqual([expect.objectContaining({ kind: 'GPS_ON' })]);

    expect((await as(tok.payroll, 'GET', '/api/admin/tracking/live')).statusCode).toBe(403);
  });

  it('the report matches the live figures, downloads, and is audited', async () => {
    const d = trackedFrom;
    const day = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    const url = `/api/admin/reports/tracking?from=${day}&to=${day}`;

    const json = await as(tok.hr, 'GET', url);
    expect(json.statusCode, json.body).toBe(200);
    expect(json.json().rows.map((r: { attendanceId: string }) => r.attendanceId).sort()).toEqual([att1, att3].sort());

    const bm = await as(tok.bm, 'GET', url);
    expect(bm.json().rows.map((r: { attendanceId: string }) => r.attendanceId)).toEqual([att1]);

    const xlsx = await as(tok.hr, 'GET', `${url}&format=xlsx`);
    expect(xlsx.statusCode).toBe(200);
    expect(xlsx.headers['content-type']).toContain('spreadsheetml');
    const pdf = await as(tok.hr, 'GET', `${url}&view=episodes&format=pdf`);
    expect(pdf.headers['content-type']).toContain('application/pdf');

    const audited = await inTenant(() => app.prisma.auditLog.count({ where: { action: 'TRACKING_REPORT_EXPORTED' } }));
    expect(audited).toBe(2);

    expect((await as(tok.payroll, 'GET', url)).statusCode).toBe(403);
    expect((await as(tok.hr, 'GET', `/api/admin/reports/tracking?from=2026-01-01&to=2026-03-01`)).statusCode).toBe(400);
  });

  it('another dealer sees none of it', async () => {
    const res = await as(tok.otherOwner, 'GET', `/api/admin/tracking/${att1}/track`, undefined, OTHER_SLUG);
    expect(res.statusCode).toBe(404);

    const on = await as(tok.otherOwner, 'PUT', '/api/admin/company', { liveTrackingOn: true }, OTHER_SLUG);
    expect(on.statusCode, on.body).toBe(200);
    const live = (await as(tok.otherOwner, 'GET', '/api/admin/tracking/live', undefined, OTHER_SLUG)).json();
    expect(live).toMatchObject({ enabled: true, employees: [], untrackedCheckedIn: 0 });
    const d = trackedFrom;
    const day = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    const report = await as(tok.otherOwner, 'GET', `/api/admin/reports/tracking?from=${day}&to=${day}`, undefined, OTHER_SLUG);
    expect(report.json().rows).toEqual([]);
  });

  it('check-out ends it: the app is told, and late fixes from inside the day still land', async () => {
    const out = await punch(emp.e1.token, 'checkout', A);
    expect(out.statusCode, out.body).toBe(200);
    expect(out.json().tracking).toMatchObject({ enabled: false, wasTracked: true });

    const late = await as(emp.e1.token, 'POST', '/api/attendance/gps-log', {
      attendanceId: att1, points: [{ ts: plus(30_000), lat: A.lat, lng: A.lng, accuracy: 8 }],
    });
    expect(late.json()).toMatchObject({ tracking: false, accepted: 1 });
    expect((await as(emp.e1.token, 'GET', '/api/attendance/tracking')).json().enabled).toBe(false);
  });

  it("records the app's consent once per version, for the employee only", async () => {
    const first = await as(emp.e5.token, 'POST', '/api/me/consent', { version: 1, acceptedAt: plus(-60_000) });
    expect(first.statusCode, first.body).toBe(200);
    expect(first.json().consentVersion).toBe(1);

    // A reinstall agrees again: the first agreement's time stands.
    await as(emp.e5.token, 'POST', '/api/me/consent', { version: 1 });
    const row = await inTenant(() => app.prisma.employee.findUniqueOrThrow({ where: { id: emp.e5.id } }));
    expect(row.consentAt?.toISOString()).toBe(plus(-60_000));

    // HR sees it on the employee record.
    const listed = (await as(tok.hr, 'GET', `/api/admin/employees/${emp.e1.id}`)).json().employee;
    expect(listed.consentVersion).toBe(1);

    expect((await as(tok.owner, 'POST', '/api/me/consent', { version: 1 })).statusCode).toBe(403);
  });

  it('switching it off closes open days and stops the phone', async () => {
    await setTracking(false);
    const row = await inTenant(() => app.prisma.attendance.findUniqueOrThrow({ where: { id: att3 } }));
    expect(row.trackingTo).not.toBeNull();

    const res = await as(emp.e3.token, 'POST', '/api/attendance/gps-log', { attendanceId: att3, points: [] });
    expect(res.json().tracking).toBe(false);
    expect((await as(emp.e3.token, 'GET', '/api/attendance/tracking')).json().enabled).toBe(false);
    expect((await as(tok.hr, 'GET', '/api/admin/tracking/live')).json().enabled).toBe(false);
  });
});
