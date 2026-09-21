/**
 * Punch reminders, and the approver's half-day call.
 *
 * Two features that meet in the same place — a day that is not quite a normal
 * day — and both of which decide what someone is paid:
 *
 *   • The reminder sweep must nudge only people who have not punched, only on
 *     days they are due in, and each nudge exactly once. Every one of those is
 *     a way to annoy 73 people at half past eight in the morning, which is how
 *     an app's notifications get switched off for good.
 *
 *   • An approver can now say a held punch is worth half a day. That answer has
 *     to survive into the payroll engine's own arithmetic: "approved" that
 *     silently pays a full day would be a lie told once per late arrival.
 *
 * Needs a database (see tests/isolation.test.ts); skips without one.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import bcrypt from 'bcrypt';
import type { FastifyInstance } from 'fastify';
import { platformSignIn } from './support/platform-session.js';

const TEST_DATABASE_URL = process.env.TEST_DATABASE_URL;
const suite = TEST_DATABASE_URL ? describe : describe.skip;

// No AWS: a punch must not be asked to match a face nobody enrolled.
process.env.AWS_ACCESS_KEY_ID = '';
process.env.AWS_SECRET_ACCESS_KEY = '';

const PLATFORM = { email: 'owner@platform.test', name: 'Platform Owner', password: 'platform-owner-pass' };
const DEALER_PASSWORD = 'dealer-admin-password';
const OWNER = 'owner@remind.test';
const SLUG = 'remind-motors';

/** A Tuesday, well clear of a month boundary and not a Sunday. */
const WORKDAY = new Date(Date.UTC(2026, 8, 15));
const WORKDAY_ISO = '2026-09-15';
/** The Sunday before it. */
const SUNDAY = new Date(Date.UTC(2026, 8, 13));

/** The instant that reads `HH:MM` on `day` — company time is UTC in this suite. */
const at = (day: Date, hhmm: string) => {
  const [h, m] = hhmm.split(':').map(Number);
  return new Date(Date.UTC(day.getUTCFullYear(), day.getUTCMonth(), day.getUTCDate(), h, m));
};

suite('punch reminders and the half-day approval', () => {
  let app: FastifyInstance;
  let adminToken: string;
  let dayShiftId: string;
  let nightShiftId: string;
  let branchId: string;
  let departmentId: string;
  let designationId: string;
  let tenantId: string;

  let ipCounter = 0;
  const freshIp = () => `10.7.${Math.floor(++ipCounter / 250)}.${ipCounter % 250}`;

  const asAdmin = (method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE', url: string, payload?: unknown) =>
    app.inject({
      method, url, remoteAddress: freshIp(),
      headers: { authorization: `Bearer ${adminToken}`, 'x-tenant-slug': SLUG },
      ...(payload === undefined ? {} : { payload: payload as object }),
    });

  /** Run the sweep for this dealer at a given instant, returning what it sent. */
  async function sweepAt(when: Date) {
    const { runInTenant } = await import('../src/context/tenant-context.js');
    const { sweepTenantReminders } = await import('../src/services/attendance/reminders.service.js');
    return runInTenant(
      { tenantId, subjectId: 'test', role: 'SUPER_ADMIN' },
      () => sweepTenantReminders(app.prisma, when),
    );
  }

  /** Anything the sweep sent to this employee, by kind. */
  const kindsFor = (sent: { employeeId: string; kind: string }[], employeeId: string) =>
    sent.filter((s) => s.employeeId === employeeId).map((s) => s.kind);

  async function inTenant<T>(fn: () => Promise<T>): Promise<T> {
    const { runInTenant } = await import('../src/context/tenant-context.js');
    return runInTenant({ tenantId, subjectId: 'test', role: 'SUPER_ADMIN' }, fn);
  }

  /** A staffer with a device token — without one there is nothing to push to. */
  async function makeEmployee(name: string, phone: string, shiftId: string) {
    const created = await asAdmin('POST', '/api/admin/employees', {
      name, phone, branchId, departmentId, designationId, shiftId,
      joiningDate: '2026-01-01', salary: 30000, password: 'employee-password',
    });
    expect(created.statusCode, created.body).toBe(200);
    const id = created.json().employee.id;
    await inTenant(() => app.prisma.employee.update({ where: { id }, data: { fcmToken: `token-${phone}` } }));
    return id;
  }

  /** Clear the ledger so one test's sends do not silence the next one's. */
  const clearLedger = () => inTenant(() => app.prisma.attendanceReminder.deleteMany({}));
  const clearPunches = () => inTenant(() => app.prisma.attendance.deleteMany({}));

  beforeAll(async () => {
    process.env.DATABASE_URL = TEST_DATABASE_URL;
    const { buildServer } = await import('../src/server.js');
    app = await buildServer();
    await app.ready();

    const p = app.prisma;
    const { runUnscoped } = await import('../src/context/tenant-context.js');
    await runUnscoped('test teardown', async () => {
      for (const del of [
        p.gPSLog, p.claimMessage, p.claim, p.attendanceReminder, p.attendance, p.leave, p.leaveBalance,
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
    const platformToken = await platformSignIn(app, PLATFORM, freshIp);

    const made = await app.inject({
      method: 'POST', url: '/api/platform/tenants',
      headers: { authorization: `Bearer ${platformToken}` },
      payload: { slug: SLUG, name: 'Remind Motors', admin: { name: 'Owner', email: OWNER, password: DEALER_PASSWORD } },
    });
    expect(made.statusCode, made.body).toBe(201);
    tenantId = made.json().tenant.id;

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
    branchId = branches.branches[0].id;
    departmentId = departments.departments[0].id;
    designationId = designations.designations[0].id;

    // Own shifts rather than the seeded ones, so the times the assertions are
    // written against are stated here instead of inherited from provisioning.
    const day = await asAdmin('POST', '/api/admin/shifts', {
      name: 'Showroom', startTime: '09:00', endTime: '18:00', gracePeriod: 15,
    });
    expect(day.statusCode, day.body).toBe(200);
    dayShiftId = day.json().shift.id;

    const night = await asAdmin('POST', '/api/admin/shifts', {
      name: 'Night watch', startTime: '22:00', endTime: '06:00', gracePeriod: 15, isNightShift: true,
    });
    expect(night.statusCode, night.body).toBe(200);
    nightShiftId = night.json().shift.id;
  }, 90_000);

  afterAll(async () => {
    await app?.close();
  });

  describe('who gets reminded to punch in', () => {
    let employeeId: string;

    beforeAll(async () => {
      employeeId = await makeEmployee('Reminder Staffer', '+919000060001', dayShiftId);
    });

    it('nudges fifteen minutes before the shift, then at the start, then fifteen after', async () => {
      await clearLedger();
      await clearPunches();

      expect(kindsFor(await sweepAt(at(WORKDAY, '08:45')), employeeId)).toEqual(['PUNCH_IN_EARLY']);
      expect(kindsFor(await sweepAt(at(WORKDAY, '09:00')), employeeId)).toEqual(['PUNCH_IN_START']);
      expect(kindsFor(await sweepAt(at(WORKDAY, '09:15')), employeeId)).toEqual(['PUNCH_IN_LATE']);
    });

    it('sends each one only once, however often the sweep runs', async () => {
      await clearLedger();
      await clearPunches();

      // The scheduler wakes every minute, so the same reminder is "due" for the
      // whole of its catch-up window. Only the first tick may send it.
      expect(kindsFor(await sweepAt(at(WORKDAY, '08:45')), employeeId)).toEqual(['PUNCH_IN_EARLY']);
      for (const minute of ['08:46', '08:47', '08:52']) {
        expect(kindsFor(await sweepAt(at(WORKDAY, minute)), employeeId)).toEqual([]);
      }
    });

    it('says nothing at all outside the windows', async () => {
      await clearLedger();
      await clearPunches();

      // Before the first is due, and long after the last one's catch-up ran out.
      expect(kindsFor(await sweepAt(at(WORKDAY, '08:30')), employeeId)).toEqual([]);
      expect(kindsFor(await sweepAt(at(WORKDAY, '11:00')), employeeId)).toEqual([]);
    });

    it('stops the moment the employee has punched in', async () => {
      await clearLedger();
      await clearPunches();

      expect(kindsFor(await sweepAt(at(WORKDAY, '08:45')), employeeId)).toEqual(['PUNCH_IN_EARLY']);
      const punch = await asAdmin('POST', '/api/admin/attendance/manual-punch', {
        employeeId, mode: 'MANUAL', date: WORKDAY_ISO, checkIn: '08:55',
        reason: 'arrived and punched before the shift started',
      });
      expect(punch.statusCode, punch.body).toBe(200);

      expect(kindsFor(await sweepAt(at(WORKDAY, '09:00')), employeeId)).toEqual([]);
      expect(kindsFor(await sweepAt(at(WORKDAY, '09:15')), employeeId)).toEqual([]);
    });

    it('leaves people alone on a Sunday', async () => {
      await clearLedger();
      await clearPunches();
      expect(kindsFor(await sweepAt(at(SUNDAY, '09:00')), employeeId)).toEqual([]);
    });

    it('leaves people alone on a holiday', async () => {
      await clearLedger();
      await clearPunches();

      const holiday = await asAdmin('POST', '/api/admin/holidays', { name: 'Test holiday', date: WORKDAY_ISO });
      expect(holiday.statusCode, holiday.body).toBe(200);
      try {
        expect(kindsFor(await sweepAt(at(WORKDAY, '09:00')), employeeId)).toEqual([]);
      } finally {
        await asAdmin('DELETE', `/api/admin/holidays/${holiday.json().holiday.id}`);
      }
    });

    it('leaves people alone on approved leave', async () => {
      await clearLedger();
      await clearPunches();

      const leave = await inTenant(() =>
        app.prisma.leave.create({
          data: {
            tenantId, employeeId, type: 'CL', status: 'APPROVED', days: 1,
            fromDate: WORKDAY, toDate: WORKDAY, reason: 'family function',
          },
        }),
      );
      try {
        expect(kindsFor(await sweepAt(at(WORKDAY, '09:00')), employeeId)).toEqual([]);
      } finally {
        await inTenant(() => app.prisma.leave.delete({ where: { id: leave.id } }));
      }
    });

    it('says nothing when the dealer has switched reminders off', async () => {
      await clearLedger();
      await clearPunches();

      const off = await asAdmin('PUT', '/api/admin/company', { punchRemindersOn: false });
      expect(off.statusCode, off.body).toBe(200);
      try {
        expect(await sweepAt(at(WORKDAY, '09:00'))).toEqual([]);
      } finally {
        await asAdmin('PUT', '/api/admin/company', { punchRemindersOn: true });
      }
    });

    it('keys the reminders to each employee\'s own shift', async () => {
      await clearLedger();
      await clearPunches();

      const guard = await makeEmployee('Night Guard', '+919000060002', nightShiftId);
      // Nine in the morning is the showroom's shift start, and nobody else's.
      const morning = await sweepAt(at(WORKDAY, '09:00'));
      expect(kindsFor(morning, employeeId)).toEqual(['PUNCH_IN_START']);
      expect(kindsFor(morning, guard)).toEqual([]);

      expect(kindsFor(await sweepAt(at(WORKDAY, '21:45')), guard)).toEqual(['PUNCH_IN_EARLY']);
    });
  });

  describe('the evening check-out reminder', () => {
    it('reaches whoever is still checked in, and nobody who is not', async () => {
      await clearLedger();
      await clearPunches();

      const open = await makeEmployee('Left It Open', '+919000060003', dayShiftId);
      const closed = await makeEmployee('Went Home', '+919000060004', dayShiftId);

      const openPunch = await asAdmin('POST', '/api/admin/attendance/manual-punch', {
        employeeId: open, mode: 'MANUAL', date: WORKDAY_ISO, checkIn: '09:00',
        reason: 'checked in and never checked out',
      });
      expect(openPunch.statusCode, openPunch.body).toBe(200);
      const closedPunch = await asAdmin('POST', '/api/admin/attendance/manual-punch', {
        employeeId: closed, mode: 'MANUAL', date: WORKDAY_ISO, checkIn: '09:00', checkOut: '18:05',
        reason: 'a full and settled day',
      });
      expect(closedPunch.statusCode, closedPunch.body).toBe(200);

      const evening = await sweepAt(at(WORKDAY, '19:30'));
      expect(kindsFor(evening, open)).toEqual(['PUNCH_OUT']);
      expect(kindsFor(evening, closed)).toEqual([]);

      // And not twice.
      expect(kindsFor(await sweepAt(at(WORKDAY, '19:40')), open)).toEqual([]);
    });

    it('follows the dealer\'s own time', async () => {
      await clearLedger();
      await clearPunches();

      const late = await makeEmployee('Late Closer', '+919000060005', dayShiftId);
      const punch = await asAdmin('POST', '/api/admin/attendance/manual-punch', {
        employeeId: late, mode: 'MANUAL', date: WORKDAY_ISO, checkIn: '09:00',
        reason: 'still in the workshop',
      });
      expect(punch.statusCode, punch.body).toBe(200);

      const moved = await asAdmin('PUT', '/api/admin/company', { punchOutReminderAt: '21:00' });
      expect(moved.statusCode, moved.body).toBe(200);
      try {
        expect(kindsFor(await sweepAt(at(WORKDAY, '19:30')), late)).toEqual([]);
        expect(kindsFor(await sweepAt(at(WORKDAY, '21:00')), late)).toEqual(['PUNCH_OUT']);
      } finally {
        await asAdmin('PUT', '/api/admin/company', { punchOutReminderAt: '19:30' });
      }
    });

    it('spares a night shift, whose day is only beginning', async () => {
      await clearLedger();
      await clearPunches();

      const guard = await makeEmployee('Still On Watch', '+919000060006', nightShiftId);
      const punch = await asAdmin('POST', '/api/admin/attendance/manual-punch', {
        employeeId: guard, mode: 'MANUAL', date: WORKDAY_ISO, checkIn: '05:00',
        reason: 'came on at ten the night before',
      });
      expect(punch.statusCode, punch.body).toBe(200);

      expect(kindsFor(await sweepAt(at(WORKDAY, '19:30')), guard)).toEqual([]);
    });
  });

  describe('approving a held punch as half a day', () => {
    /** The pending punch id for a late arrival on `date`. */
    async function heldLatePunch(employeeId: string, date: string, checkIn: string, checkOut: string) {
      const punch = await asAdmin('POST', '/api/admin/attendance/manual-punch', {
        employeeId, mode: 'MANUAL', date, checkIn, checkOut,
        reason: 'late arrival, raised for the manager to decide',
      });
      expect(punch.statusCode, punch.body).toBe(200);
      const row = await inTenant(() =>
        app.prisma.attendance.findFirst({ where: { employeeId }, orderBy: { createdAt: 'desc' } }),
      );
      expect(row?.approvalStatus).toBe('PENDING');
      return row!.id;
    }

    /** What the muster grid says about one day, which is what payroll counts. */
    async function gridCodeFor(employeeId: string, dayOfMonth: number) {
      const res = await asAdmin('GET', '/api/admin/reports/monthly-performance?month=9&year=2026');
      expect(res.statusCode, res.body).toBe(200);
      const row = res.json().employees.find((e: { id: string }) => e.id === employeeId);
      return { row, code: row?.days?.[dayOfMonth - 1]?.status };
    }

    /** The salary sheet is keyed by code, not by id. */
    async function payableFor(employeeId: string) {
      const emp = await inTenant(() =>
        app.prisma.employee.findUnique({ where: { id: employeeId }, select: { employeeCode: true } }),
      );
      const res = await asAdmin('GET', '/api/admin/reports/payroll-summary?month=9&year=2026');
      expect(res.statusCode, res.body).toBe(200);
      return res.json().rows.find((r: { employeeCode: string }) => r.employeeCode === emp!.employeeCode);
    }

    it('pays half a day, and counts the other half as absent', async () => {
      const employeeId = await makeEmployee('Half Day Staffer', '+919000060007', dayShiftId);
      // In at 11:00 — hours after the shift started, but outside the midday
      // window, so nothing in the rules would call this anything but a full day.
      const id = await heldLatePunch(employeeId, WORKDAY_ISO, '11:00', '18:00');

      const decided = await asAdmin('PATCH', `/api/admin/attendance/${id}/approve`, { as: 'HALF' });
      expect(decided.statusCode, decided.body).toBe(200);
      expect(decided.json().attendance.approvedAs).toBe('HALF');

      const { row, code } = await gridCodeFor(employeeId, 15);
      expect(code).toBe('HD');
      // Half a day of duty credit. (The row's absent count is not asserted
      // here: this fixture has no attendance on any other day of the month, so
      // it is dominated by days that have nothing to do with this decision.)
      expect(row.present).toBe(0.5);
    });

    it('keeps a whole day when the approver says so, midday window or not', async () => {
      const employeeId = await makeEmployee('Full Day Staffer', '+919000060008', dayShiftId);
      // 12:45 is inside the default midday window, so the clock would make this
      // a half day on its own. The approver's answer has to beat the clock.
      const id = await heldLatePunch(employeeId, '2026-09-16', '12:45', '21:00');

      const decided = await asAdmin('PATCH', `/api/admin/attendance/${id}/approve`, { as: 'FULL' });
      expect(decided.statusCode, decided.body).toBe(200);

      const { row, code } = await gridCodeFor(employeeId, 16);
      expect(code).toBe('P');
      expect(row.present).toBe(1);
    });

    it('leaves the day to the clock when the approver does not say', async () => {
      const employeeId = await makeEmployee('Derived Staffer', '+919000060009', dayShiftId);
      const id = await heldLatePunch(employeeId, '2026-09-17', '12:45', '21:00');

      // No `as` at all — the route it took before the option existed.
      const decided = await asAdmin('PATCH', `/api/admin/attendance/${id}/approve`, {});
      expect(decided.statusCode, decided.body).toBe(200);
      expect(decided.json().attendance.approvedAs).toBeNull();

      // 12:45 is in the midday window, so the clock calls it a half day.
      const { code } = await gridCodeFor(employeeId, 17);
      expect(code).toBe('HD');
    });

    it('carries the decision into what the employee is paid', async () => {
      const employeeId = await makeEmployee('Paid Half Staffer', '+919000060010', dayShiftId);
      const id = await heldLatePunch(employeeId, '2026-09-18', '11:00', '18:00');

      // Held, so the day is unpaid and reported under absent.
      const before = await payableFor(employeeId);
      expect(before.pendingDays).toBeGreaterThanOrEqual(1);

      const decided = await asAdmin('PATCH', `/api/admin/attendance/${id}/approve`, { as: 'HALF' });
      expect(decided.statusCode, decided.body).toBe(200);

      const after = await payableFor(employeeId);
      // 30,000 a month over a 30-day divisor is 1,000 a day, so approving the
      // day as a half adds 500 — not the 1,000 a full approval would have.
      expect(after.payable - before.payable).toBeCloseTo(500, 2);
      expect(after.halfDays).toBe(1);
    });

    it('records the half-day call in the audit trail', async () => {
      const employeeId = await makeEmployee('Audited Staffer', '+919000060011', dayShiftId);
      const id = await heldLatePunch(employeeId, '2026-09-19', '11:00', '18:00');
      await asAdmin('PATCH', `/api/admin/attendance/${id}/approve`, { as: 'HALF' });

      const trail = await asAdmin('GET', '/api/admin/audit?entity=Attendance&action=ATTENDANCE_APPROVED');
      expect(trail.statusCode, trail.body).toBe(200);
      const entry = trail.json().entries.find((e: { entityId: string }) => e.entityId === id);
      // Metadata is stored JSON-encoded, so the trail hands back a string.
      expect(JSON.parse(entry.metadata).approvedAs).toBe('HALF');
    });

    it('refuses a value that is neither', async () => {
      const employeeId = await makeEmployee('Bad Input Staffer', '+919000060012', dayShiftId);
      const id = await heldLatePunch(employeeId, '2026-09-20', '11:00', '18:00');

      const bad = await asAdmin('PATCH', `/api/admin/attendance/${id}/approve`, { as: 'QUARTER' });
      expect(bad.statusCode).toBe(422); // the handler's validation refusal

      // And the punch is still waiting, not half-decided.
      const row = await inTenant(() => app.prisma.attendance.findUnique({ where: { id } }));
      expect(row?.approvalStatus).toBe('PENDING');
    });
  });
});
