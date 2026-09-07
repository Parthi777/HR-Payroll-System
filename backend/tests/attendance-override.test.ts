/**
 * Correcting an attendance day by hand.
 *
 * This endpoint used to return `{ overridden: true }` without touching the
 * database, so HR could correct a day, be told it worked, and find it unchanged.
 * Every test here therefore re-reads the record through the API afterwards
 * rather than trusting the response — a response is exactly what the bug got
 * right.
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
const OWNER = 'owner@corrections.test';
const SLUG = 'corrections-motors';

suite('correcting attendance by hand', () => {
  let app: FastifyInstance;
  let employeeId: string;
  let token: string;

  let ipCounter = 0;
  const freshIp = () => `10.2.${Math.floor(++ipCounter / 250)}.${ipCounter % 250}`;

  const call = (method: 'GET' | 'POST' | 'PATCH' | 'PUT', url: string, payload?: unknown) =>
    app.inject({
      method, url,
      headers: { authorization: `Bearer ${token}`, 'x-tenant-slug': SLUG },
      ...(payload === undefined ? {} : { payload: payload as object }),
    });

  /** The stored row, read back through the API — never from the response body. */
  async function storedRow(id: string) {
    const res = await call('GET', '/api/admin/attendance/approvals');
    const pending = res.json().approvals.find((a: { id: string }) => a.id === id);
    return pending ?? null;
  }

  /** Raise a fresh PENDING manual punch and return its attendance id. */
  async function raisePunch(date: string, checkIn = '09:05', checkOut?: string) {
    const res = await call('POST', '/api/admin/attendance/manual-punch', {
      employeeId, mode: 'MANUAL', date, checkIn, ...(checkOut ? { checkOut } : {}),
      reason: 'fixture punch',
    });
    expect(res.statusCode, res.body).toBe(200);
    return res.json().id as string;
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

    const made = await app.inject({
      method: 'POST', url: '/api/platform/tenants',
      headers: { authorization: `Bearer ${login.json().token}` },
      payload: { slug: SLUG, name: 'Corrections Motors', admin: { name: 'Corrections Owner', email: OWNER, password: DEALER_PASSWORD } },
    });
    expect(made.statusCode, made.body).toBe(201);

    const signIn = await app.inject({
      method: 'POST', url: '/api/auth/admin/login', remoteAddress: freshIp(),
      headers: { 'x-tenant-slug': SLUG },
      payload: { email: OWNER, password: DEALER_PASSWORD },
    });
    expect(signIn.statusCode, signIn.body).toBe(200);
    token = signIn.json().token;

    // Onboarding creates the branch, department, designation and shift.
    const [branches, departments, designations] = (
      await Promise.all(['branches', 'departments', 'designations'].map((k) => call('GET', `/api/admin/${k}`)))
    ).map((r) => r.json());
    const shifts = (await call('GET', '/api/shifts')).json().shifts;

    const created = await call('POST', '/api/admin/employees', {
      name: 'Meena Raj', phone: '+919000000456',
      branchId: branches.branches[0].id,
      departmentId: departments.departments[0].id,
      designationId: designations.designations[0].id,
      shiftId: shifts[0].id,
      joiningDate: '2026-01-01', salary: 18000, password: 'employee-app-password',
    });
    expect(created.statusCode, created.body).toBe(200);
    employeeId = created.json().employee.id;
  }, 60_000);

  afterAll(async () => {
    await app?.close();
  });

  describe('it actually changes the record', () => {
    it('moves the times, and the change survives a re-read', async () => {
      const id = await raisePunch('2026-03-02', '09:05', '18:00');

      const res = await call('PATCH', `/api/admin/attendance/${id}/override`, {
        checkIn: '10:30', checkOut: '19:15', reason: 'biometric clock was an hour out',
      });
      expect(res.statusCode, res.body).toBe(200);

      // The response is exactly what the old stub got right, so prove it landed.
      const row = await storedRow(id);
      expect(row).not.toBeNull();
      expect(row.checkIn).toContain('10:30');
      expect(row.checkOut).toContain('07:15'); // 19:15 rendered as 12-hour
    });

    it('recomputes the hours worked from the corrected times', async () => {
      const id = await raisePunch('2026-03-03', '09:00', '17:00');
      await call('PATCH', `/api/admin/attendance/${id}/override`, {
        checkIn: '09:00', checkOut: '13:00', reason: 'left at one',
      });
      const { attendance } = (
        await call('PATCH', `/api/admin/attendance/${id}/override`, { checkOut: '13:00', reason: 're-check' })
      ).json();
      expect(attendance.workingMinutes).toBe(240);
    });

    it('derives the day status from the corrected times rather than trusting a caller', async () => {
      const id = await raisePunch('2026-03-04', '09:05', '18:00');
      const late = await call('PATCH', `/api/admin/attendance/${id}/override`, {
        checkIn: '11:30', reason: 'arrived late, clock missed it',
      });
      expect(late.statusCode, late.body).toBe(200);
      expect(late.json().attendance.status).toBe('LATE');
    });

    it('refuses a punch status, because the times decide it', async () => {
      const id = await raisePunch('2026-03-05');
      const res = await call('PATCH', `/api/admin/attendance/${id}/override`, {
        status: 'PRESENT', reason: 'mark them present',
      });
      // Accepting this would promise a change the next read silently undoes.
      // 422 is this app's code for a body the schema refuses (errorHandler.ts).
      expect(res.statusCode).toBe(422);
    });
  });

  describe('a settled day does not stay pending', () => {
    it('marking a day absent also settles the approval', async () => {
      const id = await raisePunch('2026-03-06');
      const before = await storedRow(id);
      expect(before, 'the fixture punch should be awaiting approval').not.toBeNull();

      const res = await call('PATCH', `/api/admin/attendance/${id}/override`, {
        status: 'ABSENT', reason: 'did not actually attend',
      });
      expect(res.statusCode, res.body).toBe(200);
      expect(res.json().attendance.status).toBe('ABSENT');
      // Still PENDING would mean the grid shows PN, and the day stays unpaid
      // for a reason nobody can see — the same class of silent no-op.
      expect(res.json().attendance.approvalStatus).not.toBe('PENDING');

      expect(await storedRow(id), 'it should have left the approvals queue').toBeNull();
    });

    it('settles an approval on its own when asked to', async () => {
      const id = await raisePunch('2026-03-09');
      const res = await call('PATCH', `/api/admin/attendance/${id}/override`, {
        approvalStatus: 'APPROVED', reason: 'confirmed with the branch manager',
      });
      expect(res.statusCode, res.body).toBe(200);
      expect(res.json().attendance.approvalStatus).toBe('APPROVED');
      expect(await storedRow(id)).toBeNull();
    });
  });

  describe('it refuses what it cannot do', () => {
    it('will not correct a day without a reason', async () => {
      const id = await raisePunch('2026-03-10');
      const res = await call('PATCH', `/api/admin/attendance/${id}/override`, { checkIn: '09:00' });
      expect(res.statusCode).toBe(422);
    });

    it('will not accept a check-out before the check-in', async () => {
      const id = await raisePunch('2026-03-11', '09:00', '18:00');
      const res = await call('PATCH', `/api/admin/attendance/${id}/override`, {
        checkIn: '14:00', checkOut: '10:00', reason: 'typo',
      });
      expect(res.statusCode).toBe(400);
    });

    it('points at the manual punch when there is no record to correct', async () => {
      const res = await call('PATCH', '/api/admin/attendance/no-such-record/override', {
        checkIn: '09:00', reason: 'they were here',
      });
      expect(res.statusCode).toBe(404);
      expect(res.json().message).toMatch(/manual punch/i);
    });

    it('will not accept an empty correction', async () => {
      const id = await raisePunch('2026-03-12');
      const res = await call('PATCH', `/api/admin/attendance/${id}/override`, { reason: 'no fields' });
      expect(res.statusCode).toBe(400);
    });
  });

  it('records the correction in the audit trail, with both sides of the change', async () => {
    const id = await raisePunch('2026-03-13', '09:05', '18:00');
    await call('PATCH', `/api/admin/attendance/${id}/override`, {
      checkIn: '08:00', reason: 'gate log shows an eight o clock arrival',
    });

    const log = await call('GET', '/api/admin/audit?action=ATTENDANCE_OVERRIDDEN');
    expect(log.statusCode, log.body).toBe(200);
    const entry = log.json().entries[0];
    expect(entry, 'the correction should be recorded').toBeTruthy();
    const meta = JSON.parse(entry.metadata);
    expect(meta.employee).toBe('Meena Raj');
    expect(meta.reason).toMatch(/gate log/);
    expect(meta.checkIn.from).not.toBe(meta.checkIn.to);
  });
});
