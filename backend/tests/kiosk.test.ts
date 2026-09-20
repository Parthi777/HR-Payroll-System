/**
 * The branch kiosk: a shared tablet that punches for whoever is standing in
 * front of it.
 *
 * A device token that lives for months and can mark anyone at its branch
 * present is the most powerful credential in the product after an admin's, so
 * the things pinned here are the ones that keep it narrow: it reaches no other
 * route, no other branch and no other dealership, a pairing code works once,
 * and switching the tablet off in Master Control stops it on its next request
 * rather than when the token expires.
 *
 * AWS is switched off for this suite, which turns off both the liveness check
 * and the face gate — neither can be driven from a test without a camera and a
 * real enrolled face. So what runs here is the kiosk's own logic: the device
 * token, the branch binding, the direction of the punch. On a real deployment a
 * punch must also pass liveness and match the enrolled face, which is the same
 * gate the app goes through (services/attendance/attendance.service.ts) and is
 * described in docs/KIOSK.md.
 *
 * Needs a database (see tests/isolation.test.ts); skips without one.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import bcrypt from 'bcrypt';
import type { FastifyInstance } from 'fastify';
import { platformSignIn } from './support/platform-session.js';
import { runInTenant } from '../src/context/tenant-context.js';

const TEST_DATABASE_URL = process.env.TEST_DATABASE_URL;
const suite = TEST_DATABASE_URL ? describe : describe.skip;

// Both read once, at import time, by config/env.ts — so they are set before
// the server is imported. Without this the suite would call real AWS with a
// one-pixel image and fail on a face that was never enrolled.
process.env.KIOSK_LIVENESS = 'off';
process.env.AWS_ACCESS_KEY_ID = '';
process.env.AWS_SECRET_ACCESS_KEY = '';

const PLATFORM = { email: 'owner@platform.test', name: 'Platform Owner', password: 'platform-owner-pass' };
const DEALER_PASSWORD = 'kiosk-dealer-password';

const HOME = { slug: 'kiosk-motors', owner: 'owner@kiosk.test' };
const OTHER = { slug: 'rival-motors', owner: 'owner@rival.test' };

/** A one-pixel JPEG. The face gate is off without AWS, so the bytes only have to exist. */
const SELFIE = Buffer.from(
  '/9j/4AAQSkZJRgABAQEAYABgAAD/2wBDAAgGBgcGBQgHBwcJCQgKDBQNDAsLDBkSEw8UHRofHh0aHBwgJC4nICIsIxwcKDcpLDAxNDQ0Hyc5PTgyPC4zNDL/wAALCAABAAEBAREA/8QAFAABAAAAAAAAAAAAAAAAAAAACf/EABQQAQAAAAAAAAAAAAAAAAAAAAD/2gAIAQEAAD8AKp//2Q==',
  'base64',
);

suite('the branch kiosk', () => {
  let app: FastifyInstance;
  let platformToken: string;

  /** Per-dealer state, filled by the fixture below. */
  const dealer: Record<string, {
    tenantId: string;
    token: string;
    branchId: string;
    otherBranchId: string;
    employeeId: string;
    employeeCode: string;
  }> = {};

  let ipCounter = 0;
  const freshIp = () => `10.6.${Math.floor(++ipCounter / 250)}.${ipCounter % 250}`;

  const asAdmin = (slug: string, method: 'GET' | 'POST' | 'PATCH' | 'DELETE', url: string, payload?: unknown) =>
    app.inject({
      method, url, remoteAddress: freshIp(),
      headers: { authorization: `Bearer ${dealer[slug].token}`, 'x-tenant-slug': slug },
      ...(payload === undefined ? {} : { payload: payload as object }),
    });

  const asKiosk = (token: string, method: 'GET' | 'POST', url: string, payload?: unknown) =>
    app.inject({
      method, url, remoteAddress: freshIp(),
      headers: { authorization: `Bearer ${token}` },
      ...(payload === undefined ? {} : { payload: payload as object }),
    });

  /** A punch, as the tablet sends it: multipart, with the captured image. */
  async function punch(token: string, employeeId: string, selfie: Buffer | null = SELFIE) {
    const boundary = '----kiosktest';
    const parts: Buffer[] = [
      Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="employeeId"\r\n\r\n${employeeId}\r\n`),
    ];
    if (selfie) {
      parts.push(
        Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="selfie"; filename="s.jpg"\r\nContent-Type: image/jpeg\r\n\r\n`),
        selfie,
        Buffer.from('\r\n'),
      );
    }
    parts.push(Buffer.from(`--${boundary}--\r\n`));

    return app.inject({
      method: 'POST', url: '/api/kiosk/punch', remoteAddress: freshIp(),
      headers: { authorization: `Bearer ${token}`, 'content-type': `multipart/form-data; boundary=${boundary}` },
      payload: Buffer.concat(parts),
    });
  }

  /** Reading the database directly still has to say which dealer it is for. */
  const inTenant = <T>(slug: string, fn: () => Promise<T>): Promise<T> =>
    runInTenant({ tenantId: dealer[slug].tenantId, subjectId: 'kiosk-test', role: 'SUPER_ADMIN' }, fn);

  /** Create a kiosk and pair a tablet to it, as an administrator would. */
  async function pairKiosk(slug: string, name: string, branchId: string) {
    const created = await asAdmin(slug, 'POST', '/api/admin/kiosks', { name, branchId });
    expect(created.statusCode, created.body).toBe(201);
    const { pairingCode, kiosk } = created.json();

    const paired = await app.inject({
      method: 'POST', url: '/api/kiosk/pair', remoteAddress: freshIp(),
      payload: { workspace: slug, code: pairingCode },
    });
    expect(paired.statusCode, paired.body).toBe(200);
    return { token: paired.json().token as string, kioskId: kiosk.id as string, pairingCode: pairingCode as string };
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
        p.kioskDevice, p.employee, p.adminUser, p.branch, p.department, p.designation,
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

    for (const { slug, owner } of [HOME, OTHER]) {
      const made = await app.inject({
        method: 'POST', url: '/api/platform/tenants',
        headers: { authorization: `Bearer ${platformToken}` },
        payload: { slug, name: slug, admin: { name: 'Owner', email: owner, password: DEALER_PASSWORD } },
      });
      expect(made.statusCode, made.body).toBe(201);

      const signIn = await app.inject({
        method: 'POST', url: '/api/auth/admin/login', remoteAddress: freshIp(),
        headers: { 'x-tenant-slug': slug },
        payload: { email: owner, password: DEALER_PASSWORD },
      });
      expect(signIn.statusCode, signIn.body).toBe(200);
      dealer[slug] = {
        tenantId: made.json().tenant.id,
        token: signIn.json().token,
        branchId: '', otherBranchId: '', employeeId: '', employeeCode: '',
      };

      const [branches, departments, designations] = (
        await Promise.all(['branches', 'departments', 'designations'].map((k) => asAdmin(slug, 'GET', `/api/admin/${k}`)))
      ).map((r) => r.json());
      const shifts = (await asAdmin(slug, 'GET', '/api/shifts')).json().shifts;
      dealer[slug].branchId = branches.branches[0].id;

      // A second branch, so "not at this branch" is a claim this suite can make.
      const second = await asAdmin(slug, 'POST', '/api/admin/branches', {
        name: 'Second Branch', address: 'Elsewhere', geofenceLat: 12.9, geofenceLng: 77.6, geofenceRadius: 100, strictMode: false,
      });
      expect([200, 201], second.body).toContain(second.statusCode);
      dealer[slug].otherBranchId = second.json().branch.id;

      // Onboarding leaves a branch's location zeroed until it is drawn on the
      // map. A kiosk punches at those coordinates, so set them as HR would.
      const placed = await asAdmin(slug, 'PUT', `/api/admin/geofence/${dealer[slug].branchId}`, {
        geofenceLat: 11.0168, geofenceLng: 76.9558, geofenceRadius: 150, strictMode: false,
      });
      expect(placed.statusCode, placed.body).toBe(200);

      const employee = await asAdmin(slug, 'POST', '/api/admin/employees', {
        name: `${slug} Staffer`, phone: `+9190000${slug === HOME.slug ? '11111' : '22222'}`,
        branchId: dealer[slug].branchId,
        departmentId: departments.departments[0].id,
        designationId: designations.designations[0].id,
        shiftId: shifts[0].id,
        joiningDate: '2026-01-01', salary: 20000, password: 'employee-app-password',
      });
      expect(employee.statusCode, employee.body).toBe(200);
      dealer[slug].employeeId = employee.json().employee.id;
      dealer[slug].employeeCode = employee.json().employee.employeeCode;
    }
  }, 90_000);

  afterAll(async () => {
    await app?.close();
  });

  describe('pairing a tablet', () => {
    it('hands the code over once, and never stores it where it can be read back', async () => {
      const created = await asAdmin(HOME.slug, 'POST', '/api/admin/kiosks', {
        name: 'Reception', branchId: dealer[HOME.slug].branchId,
      });
      expect(created.statusCode, created.body).toBe(201);
      expect(created.json().pairingCode).toMatch(/^[A-Z2-9]{4}-[A-Z2-9]{4}$/);
      expect(created.body, 'the pairing hash was serialised').not.toContain('pairingHash":"$2');

      const list = await asAdmin(HOME.slug, 'GET', '/api/admin/kiosks');
      const kiosk = (list.json().kiosks as { id: string; pairingPending: boolean }[])
        .find((k) => k.id === created.json().kiosk.id);
      expect(kiosk?.pairingPending, 'the console cannot see a code is outstanding').toBe(true);
      expect(list.body).not.toContain('pairingHash":"$2');
    });

    it('refuses a wrong code, and a code meant for another workspace', async () => {
      const created = await asAdmin(HOME.slug, 'POST', '/api/admin/kiosks', {
        name: 'Gate', branchId: dealer[HOME.slug].branchId,
      });
      const { pairingCode } = created.json();

      const wrong = await app.inject({
        method: 'POST', url: '/api/kiosk/pair', remoteAddress: freshIp(),
        payload: { workspace: HOME.slug, code: 'ZZZZ-ZZZZ' },
      });
      expect(wrong.statusCode).toBe(401);

      // The right code, aimed at the wrong dealership.
      const elsewhere = await app.inject({
        method: 'POST', url: '/api/kiosk/pair', remoteAddress: freshIp(),
        payload: { workspace: OTHER.slug, code: pairingCode },
      });
      expect(elsewhere.statusCode, 'a code paired a tablet in another dealership').toBe(401);
    });

    it('spends the code: the same one cannot pair a second tablet', async () => {
      const { pairingCode } = await pairKiosk(HOME.slug, 'Workshop door', dealer[HOME.slug].branchId);
      const again = await app.inject({
        method: 'POST', url: '/api/kiosk/pair', remoteAddress: freshIp(),
        payload: { workspace: HOME.slug, code: pairingCode },
      });
      expect(again.statusCode).toBe(401);
    });

    it('tells the tablet which branch it is standing in', async () => {
      const { token } = await pairKiosk(HOME.slug, 'Showroom', dealer[HOME.slug].branchId);
      const session = await asKiosk(token, 'GET', '/api/kiosk/session');
      expect(session.statusCode, session.body).toBe(200);
      expect(session.json().branch.id).toBe(dealer[HOME.slug].branchId);
      expect(session.json().liveness.enabled).toBe(false);
    });
  });

  describe('what a kiosk token can reach', () => {
    let token: string;
    beforeAll(async () => { ({ token } = await pairKiosk(HOME.slug, 'Scope test', dealer[HOME.slug].branchId)); });

    it('cannot open any of the dealer app', async () => {
      for (const url of ['/api/admin/employees', '/api/admin/payroll/preview/3/2026', '/api/attendance/today', '/api/admin/kiosks']) {
        const res = await asKiosk(token, 'GET', url);
        expect([401, 403], `${url} answered ${res.statusCode}`).toContain(res.statusCode);
      }
    });

    it('is turned away as a kiosk, not merely as the wrong role', async () => {
      // Without the scope check a kiosk token would be read as an ordinary
      // employee session and refused for incidental reasons. This pins the
      // reason: a device is not a person and cannot sign in as one.
      const res = await asKiosk(token, 'GET', '/api/attendance/today');
      expect(res.statusCode).toBe(403);
      expect(res.json().message).toMatch(/kiosk device cannot be used to sign in/i);
    });

    it('cannot reach the platform console', async () => {
      const res = await asKiosk(token, 'GET', '/api/platform/tenants');
      expect(res.statusCode).toBe(403);
    });

    it('cannot punch for another dealership’s employee', async () => {
      const res = await punch(token, dealer[OTHER.slug].employeeId);
      // Scoped away entirely: to this tablet that person does not exist.
      expect(res.statusCode).toBe(404);
    });

    it('cannot punch for someone at another branch of its own dealership', async () => {
      const moved = await asAdmin(HOME.slug, 'POST', '/api/admin/employees', {
        name: 'Other Branch Staffer', phone: '+919000033333',
        branchId: dealer[HOME.slug].otherBranchId,
        departmentId: (await asAdmin(HOME.slug, 'GET', '/api/admin/departments')).json().departments[0].id,
        designationId: (await asAdmin(HOME.slug, 'GET', '/api/admin/designations')).json().designations[0].id,
        shiftId: (await asAdmin(HOME.slug, 'GET', '/api/shifts')).json().shifts[0].id,
        joiningDate: '2026-01-01', salary: 20000, password: 'employee-app-password',
      });
      expect(moved.statusCode, moved.body).toBe(200);

      const lookup = await asKiosk(token, 'POST', '/api/kiosk/lookup', { code: moved.json().employee.employeeCode });
      expect(lookup.statusCode).toBe(403);
      expect(lookup.json().message).toMatch(/not registered at this branch/i);

      const res = await punch(token, moved.json().employee.id);
      expect(res.statusCode).toBe(403);
    });

    it('says the liveness check is unavailable rather than pretending it ran', async () => {
      const res = await asKiosk(token, 'POST', '/api/kiosk/liveness/session', {});
      expect(res.statusCode).toBe(503);
    });
  });

  describe('punching', () => {
    let token: string;
    let employeeId: string;
    let employeeCode: string;

    beforeAll(async () => {
      ({ token } = await pairKiosk(HOME.slug, 'Punch test', dealer[HOME.slug].branchId));
      employeeId = dealer[HOME.slug].employeeId;
      employeeCode = dealer[HOME.slug].employeeCode;
    });

    it('turns a typed code into a name, and says which way the punch goes', async () => {
      const res = await asKiosk(token, 'POST', '/api/kiosk/lookup', { code: employeeCode.toLowerCase() });
      expect(res.statusCode, res.body).toBe(200);
      expect(res.json().employee.id).toBe(employeeId);
      expect(res.json().nextAction).toBe('IN');
    });

    it('finds someone by the number alone, because the keypad has digits on it', async () => {
      // EMP001 typed as "1" — and as "001", the way it is printed on a badge.
      const digits = employeeCode.replace(/\D/g, '');
      for (const typed of [digits, String(parseInt(digits, 10))]) {
        const res = await asKiosk(token, 'POST', '/api/kiosk/lookup', { code: typed });
        expect(res.statusCode, `typing "${typed}": ${res.body}`).toBe(200);
        expect(res.json().employee.id).toBe(employeeId);
      }
    });

    it('refuses a code nobody has', async () => {
      const res = await asKiosk(token, 'POST', '/api/kiosk/lookup', { code: 'NOBODY-9999' });
      expect(res.statusCode).toBe(404);
    });

    it('marks the arrival, at the branch’s own coordinates', async () => {
      const res = await punch(token, employeeId);
      expect(res.statusCode, res.body).toBe(200);
      expect(res.json().action).toBe('IN');
      expect(res.json().employee.name).toContain('Staffer');

      const today = new Date();
      today.setHours(0, 0, 0, 0);
      const { row, branch } = await inTenant(HOME.slug, async () => ({
        row: await app.prisma.attendance.findFirstOrThrow({ where: { employeeId, date: today } }),
        branch: await app.prisma.branch.findFirstOrThrow({ where: { id: dealer[HOME.slug].branchId } }),
      }));
      expect(row.checkIn).toBeTruthy();
      // Not a browser's idea of where it is: the branch it was paired to.
      expect(row.checkInLat).toBe(branch.geofenceLat);
      expect(row.checkInLng).toBe(branch.geofenceLng);
      expect(row.geofenceStatus).toBe('INSIDE');
    });

    it('sends the same person out on the next punch', async () => {
      const lookup = await asKiosk(token, 'POST', '/api/kiosk/lookup', { code: employeeCode });
      expect(lookup.json().nextAction).toBe('OUT');

      const res = await punch(token, employeeId);
      expect(res.statusCode, res.body).toBe(200);
      expect(res.json().action).toBe('OUT');

      const today = new Date();
      today.setHours(0, 0, 0, 0);
      const row = await inTenant(HOME.slug, () =>
        app.prisma.attendance.findFirstOrThrow({ where: { employeeId, date: today } }));
      expect(row.checkOut).toBeTruthy();
    });

    it('refuses a punch with no photo at all', async () => {
      const res = await punch(token, employeeId, null);
      expect(res.statusCode).toBe(400);
    });

    it('says plainly when the branch has never been placed on the map', async () => {
      // The branch a workspace is provisioned with has its location zeroed.
      const { token: stranded } = await pairKiosk(HOME.slug, 'Unplaced branch', dealer[HOME.slug].otherBranchId);
      await inTenant(HOME.slug, () =>
        app.prisma.branch.update({
          where: { id: dealer[HOME.slug].otherBranchId },
          data: { geofenceLat: 0, geofenceLng: 0 },
        }));

      const staff = await asAdmin(HOME.slug, 'POST', '/api/admin/employees', {
        name: 'Unplaced Staffer', phone: '+919000044444',
        branchId: dealer[HOME.slug].otherBranchId,
        departmentId: (await asAdmin(HOME.slug, 'GET', '/api/admin/departments')).json().departments[0].id,
        designationId: (await asAdmin(HOME.slug, 'GET', '/api/admin/designations')).json().designations[0].id,
        shiftId: (await asAdmin(HOME.slug, 'GET', '/api/shifts')).json().shifts[0].id,
        joiningDate: '2026-01-01', salary: 20000, password: 'employee-app-password',
      });
      expect(staff.statusCode, staff.body).toBe(200);

      const res = await punch(stranded, staff.json().employee.id);
      expect(res.statusCode).toBe(409);
      expect(res.json().message).toMatch(/no location set yet/i);
      // And the console flags it rather than leaving someone to find out.
      const listed = (await asAdmin(HOME.slug, 'GET', '/api/admin/kiosks')).json().kiosks as
        { name: string; branchLocationSet: boolean }[];
      expect(listed.find((k) => k.name === 'Unplaced branch')?.branchLocationSet).toBe(false);
    });
  });

  describe('switching a tablet off', () => {
    it('stops it on the next request, not when its token expires', async () => {
      const { token, kioskId } = await pairKiosk(HOME.slug, 'Lost tablet', dealer[HOME.slug].branchId);
      expect((await asKiosk(token, 'GET', '/api/kiosk/session')).statusCode).toBe(200);

      const off = await asAdmin(HOME.slug, 'PATCH', `/api/admin/kiosks/${kioskId}`, { isActive: false });
      expect(off.statusCode, off.body).toBe(200);

      const after = await asKiosk(token, 'GET', '/api/kiosk/session');
      expect(after.statusCode).toBe(401);
      expect((await punch(token, dealer[HOME.slug].employeeId)).statusCode).toBe(401);
    });

    it('re-pairing retires the old tablet’s token', async () => {
      const { token, kioskId } = await pairKiosk(HOME.slug, 'Replaced tablet', dealer[HOME.slug].branchId);
      const fresh = await asAdmin(HOME.slug, 'POST', `/api/admin/kiosks/${kioskId}/pairing-code`);
      expect(fresh.statusCode, fresh.body).toBe(200);

      const rePaired = await app.inject({
        method: 'POST', url: '/api/kiosk/pair', remoteAddress: freshIp(),
        payload: { workspace: HOME.slug, code: fresh.json().pairingCode },
      });
      expect(rePaired.statusCode, rePaired.body).toBe(200);

      // The tablet that was replaced is now silent.
      expect((await asKiosk(token, 'GET', '/api/kiosk/session')).statusCode).toBe(401);
      expect((await asKiosk(rePaired.json().token, 'GET', '/api/kiosk/session')).statusCode).toBe(200);
    });
  });

  describe('one dealership’s kiosks are its own', () => {
    it('are invisible to another dealership’s administrator', async () => {
      await pairKiosk(OTHER.slug, 'Rival reception', dealer[OTHER.slug].branchId);

      const mine = (await asAdmin(HOME.slug, 'GET', '/api/admin/kiosks')).json().kiosks as { name: string }[];
      const theirs = (await asAdmin(OTHER.slug, 'GET', '/api/admin/kiosks')).json().kiosks as { name: string }[];

      expect(mine.some((k) => k.name === 'Rival reception')).toBe(false);
      expect(theirs.map((k) => k.name)).toEqual(['Rival reception']);
    });

    it('cannot be switched off from another dealership', async () => {
      const theirs = (await asAdmin(OTHER.slug, 'GET', '/api/admin/kiosks')).json().kiosks as { id: string }[];
      const res = await asAdmin(HOME.slug, 'PATCH', `/api/admin/kiosks/${theirs[0].id}`, { isActive: false });
      expect(res.statusCode).toBe(404);
    });
  });

  describe('the paper trail', () => {
    it('records issuing a pairing code and switching a tablet off', async () => {
      const res = await asAdmin(HOME.slug, 'GET', '/api/admin/audit?limit=200');
      expect(res.statusCode, res.body).toBe(200);
      const actions = (res.json().entries as { action: string }[]).map((e) => e.action);
      expect(actions).toContain('KIOSK_CREATED');
      expect(actions).toContain('KIOSK_PAIRING_CODE_ISSUED');
      expect(actions).toContain('KIOSK_DISABLED');
      expect(res.body, 'a pairing code reached the audit log').not.toMatch(/[A-Z2-9]{4}-[A-Z2-9]{4}/);
    });
  });
});
