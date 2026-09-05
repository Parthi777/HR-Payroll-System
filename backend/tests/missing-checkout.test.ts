import { beforeEach, describe, expect, it } from 'vitest';
import type { PrismaClient } from '@prisma/client';
import { findOpenPunch, markCheckIn, markManualPunch } from '../src/services/attendance/attendance.service.js';
import type { AppError } from '../src/utils/AppError.js';
import { enterContext } from '../src/context/tenant-context.js';

// Services stamp the owning tenant on every row they create, so they need a
// tenant context — in production `authenticate()` establishes one before any
// handler runs. Entering one here mirrors that; the guard itself stays live and
// tenancy-extension.test.ts still asserts that a *missing* context throws.
beforeEach(() => {
  enterContext({ kind: 'TENANT', tenantId: 'test-tenant', subjectId: 'test-subject', role: 'SUPER_ADMIN' });
});


/**
 * Forgetting to check out leaves a day open. That day has to be sent for
 * approval before the employee can check in again — otherwise it sits there
 * unpaid and nobody notices until payroll.
 */

const EMPLOYEE_ID = 'e1';
const SHIFT = { startTime: '09:00', endTime: '18:00', gracePeriod: 15, isNightShift: false };

interface Row {
  /** Days before today. 0 = today, 1 = yesterday. */
  daysAgo: number;
  in: string | null;
  out?: string | null;
  status?: string;
}

/** Midnight `daysAgo` days back, or that day at a wall-clock time. */
function dayAt(daysAgo: number, hhmm: string | null): Date {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  d.setDate(d.getDate() - daysAgo);
  if (!hhmm) return d;
  const [h, m] = hhmm.split(':').map(Number);
  return new Date(d.getFullYear(), d.getMonth(), d.getDate(), h, m);
}

/** The yyyy-MM-dd the API hands back for that day. */
function isoOf(daysAgo: number): string {
  const d = dayAt(daysAgo, null);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

/**
 * Prisma stand-in that actually applies the where clause the open-day lookup
 * relies on, so these tests pin *which* days count as open — not just the
 * mapping of whichever row comes back.
 */
function fakePrisma(rows: Row[]): PrismaClient {
  const attendance = rows.map((r, i) => ({
    id: `a${i}`,
    employeeId: EMPLOYEE_ID,
    date: dayAt(r.daysAgo, null),
    checkIn: r.in ? dayAt(r.daysAgo, r.in) : null,
    checkOut: r.out ? dayAt(r.daysAgo, r.out) : null,
    status: r.status ?? 'PRESENT',
    geofenceStatus: 'INSIDE',
    employee: { shift: SHIFT },
  }));

  return {
    attendance: {
      findMany: async ({ where }: { where: Record<string, any> }) =>
        attendance
          .filter(
            (a) =>
              a.date >= where.date.gte &&
              a.date < where.date.lt &&
              a.checkIn !== null &&
              a.checkOut === null &&
              !where.status.notIn.includes(a.status),
          )
          .sort((x, y) => x.date.getTime() - y.date.getTime()),
      findUnique: async ({ where }: { where: { employeeId_date: { date: Date } } }) =>
        attendance.find((a) => a.date.getTime() === where.employeeId_date.date.getTime()) ?? null,
      upsert: async ({ create, update }: { create: object; update: object }) => ({
        id: 'a-new',
        employeeId: EMPLOYEE_ID,
        workingMinutes: null,
        faceMatchScore: null,
        ...create,
        ...update,
      }),
    },
    employee: {
      findUnique: async () => ({
        id: EMPLOYEE_ID,
        name: 'Ravi',
        status: 'ACTIVE',
        branchId: 'b1',
        reportingManagerId: null,
        faceTemplateId: null,
        shift: SHIFT,
        branch: { id: 'b1', name: 'Bhavani', strictMode: false, geofenceLat: 0, geofenceLng: 0, geofenceRadius: 100 },
      }),
    },
    // No approvers configured → notifyAdmins short-circuits.
    adminUser: { findMany: async () => [] },
    // No settings row → the platform defaults apply, which is what a dealer
    // that has not customised its policy actually gets.
    tenantSettings: { findFirst: async () => null },
  } as unknown as PrismaClient;
}

/** Run `fn` and hand back the AppError it threw (failing if it didn't throw). */
async function thrownBy(fn: () => Promise<unknown>): Promise<AppError> {
  try {
    await fn();
  } catch (e) {
    return e as AppError;
  }
  throw new Error('expected the call to throw, but it resolved');
}

describe('findOpenPunch', () => {
  it('is null when every past day was checked out of', async () => {
    const p = fakePrisma([
      { daysAgo: 1, in: '09:00', out: '18:00' },
      { daysAgo: 2, in: '09:05', out: '18:10' },
    ]);
    expect(await findOpenPunch(p, EMPLOYEE_ID)).toBeNull();
  });

  it('ignores today — the employee is still at work', async () => {
    const p = fakePrisma([{ daysAgo: 0, in: '09:00' }]);
    expect(await findOpenPunch(p, EMPLOYEE_ID)).toBeNull();
  });

  it('flags yesterday when the check-out never came', async () => {
    const p = fakePrisma([{ daysAgo: 1, in: '09:02' }]);
    const open = await findOpenPunch(p, EMPLOYEE_ID);
    expect(open?.date).toBe(isoOf(1));
    expect(open?.openDays).toBe(1);
    expect(open?.shiftEnd).toBe('18:00'); // the picker's default
  });

  it('reports the oldest open day first and counts the rest', async () => {
    const p = fakePrisma([
      { daysAgo: 1, in: '09:00' },
      { daysAgo: 3, in: '09:00' },
    ]);
    const open = await findOpenPunch(p, EMPLOYEE_ID);
    expect(open?.date).toBe(isoOf(3));
    expect(open?.openDays).toBe(2);
  });

  it('ignores days an admin already settled as absent or leave', async () => {
    const p = fakePrisma([
      { daysAgo: 1, in: '09:00', status: 'ABSENT' },
      { daysAgo: 2, in: '09:00', status: 'ON_LEAVE' },
    ]);
    expect(await findOpenPunch(p, EMPLOYEE_ID)).toBeNull();
  });

  it('ignores rows older than the lookback window', async () => {
    const p = fakePrisma([{ daysAgo: 40, in: '09:00' }]);
    expect(await findOpenPunch(p, EMPLOYEE_ID)).toBeNull();
  });
});

describe('check-in gate', () => {
  it('blocks the next check-in with a 409 the app can act on', async () => {
    const err = await thrownBy(() => markCheckIn(fakePrisma([{ daysAgo: 1, in: '09:02' }]), EMPLOYEE_ID, null, 11.4, 77.6));
    expect(err.statusCode).toBe(409);
    expect(err.details).toMatchObject({ code: 'MISSING_CHECKOUT', date: isoOf(1), openDays: 1 });
    expect(err.message).toMatch(/check-out time/i);
  });

  it('lets the check-in through once nothing is open', async () => {
    // Past the open-day gate, so the next complaint is the missing GPS fix.
    const err = await thrownBy(() =>
      markCheckIn(fakePrisma([{ daysAgo: 1, in: '09:02', out: '18:00' }]), EMPLOYEE_ID, null, 0, 0),
    );
    expect(err.statusCode).toBe(400);
    expect(err.message).toMatch(/Location\/GPS/);
  });

  it('will not let a manual punch hop over the open day', async () => {
    const err = await thrownBy(() =>
      markManualPunch(fakePrisma([{ daysAgo: 2, in: '09:00' }]), {
        employeeId: EMPLOYEE_ID,
        mode: 'MANUAL',
        checkIn: '09:00',
        reason: 'forgot',
        date: new Date(),
      }),
    );
    expect(err.statusCode).toBe(409);
    expect(err.details).toMatchObject({ code: 'MISSING_CHECKOUT' });
  });

  it('accepts the punch that settles the open day, and holds it for approval', async () => {
    const p = fakePrisma([{ daysAgo: 2, in: '09:00' }]);
    const result = await markManualPunch(p, {
      employeeId: EMPLOYEE_ID,
      mode: 'MANUAL',
      checkOut: '18:00',
      reason: 'forgot to check out',
      date: dayAt(2, null),
    });
    expect(result.approvalStatus).toBe('PENDING');
  });

  it('never blocks HR raising a punch on the employee behalf', async () => {
    const p = fakePrisma([{ daysAgo: 2, in: '09:00' }]);
    const result = await markManualPunch(p, {
      employeeId: EMPLOYEE_ID,
      mode: 'MANUAL',
      checkIn: '09:00',
      checkOut: '18:00',
      reason: 'system was down',
      date: new Date(),
      raisedByAdminId: 'admin1',
    });
    expect(result.approvalStatus).toBe('PENDING');
  });
});
