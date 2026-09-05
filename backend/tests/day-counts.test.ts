import { describe, expect, it } from 'vitest';
import type { PrismaClient } from '@prisma/client';
import { classifyDay } from '../src/services/attendance/day-classify.js';
import { computeMonthlyPayroll } from '../src/services/payroll/payroll-run.service.js';
import { buildMusterReport } from '../src/services/reports/muster-report.service.js';

/**
 * Present/absent must mean the same thing on every screen: the muster grid, the
 * payroll sheet and the payslip all classify days through day-classify, so
 * these tests pin the counting rules and the row arithmetic in one place.
 *
 * March 2026 is used throughout — a fully elapsed month with 31 days and five
 * Sundays (1, 8, 15, 22, 29).
 */

const MONTH = 3;
const YEAR = 2026;
const SHIFT = { startTime: '09:00', endTime: '18:00', gracePeriod: 15, otAfterMinutes: 0 };

const at = (day: number, hhmm: string) => {
  const [h, m] = hhmm.split(':').map(Number);
  return new Date(YEAR, MONTH - 1, day, h, m);
};
const dayDate = (day: number) => new Date(YEAR, MONTH - 1, day);

interface AttStub {
  employeeId: string;
  date: Date;
  checkIn: Date | null;
  checkOut: Date | null;
  status: string;
  approvalStatus: string | null;
  workingMinutes: number | null;
  punchMode: string;
}

/** A normal 09:00–18:00 duty day. */
const workDay = (day: number, over: Partial<AttStub> = {}): AttStub => ({
  employeeId: 'e1',
  date: dayDate(day),
  checkIn: at(day, '09:00'),
  checkOut: at(day, '18:00'),
  status: 'PRESENT',
  approvalStatus: null,
  workingMinutes: 540,
  punchMode: 'GEO',
  ...over,
});

const EMP = {
  id: 'e1',
  employeeCode: 'E1',
  name: 'Test Employee',
  salary: 30_000, // ₹1,000/day (salary / 30)
  pfEnabled: false,
  esiEnabled: false,
  joiningDate: new Date(YEAR, MONTH - 1, 1),
  shift: SHIFT,
  branch: { name: 'HQ' },
  department: { name: 'Service' },
  designation: { name: 'Technician' },
};

/** Minimal Prisma stand-in — these services only read the four tables below. */
const fakePrisma = (opts: { atts?: AttStub[]; leaves?: unknown[]; holidays?: Date[]; employee?: object }) =>
  ({
    employee: { findMany: async () => [opts.employee ?? EMP] },
    attendance: { findMany: async () => opts.atts ?? [] },
    leave: { findMany: async () => opts.leaves ?? [] },
    holiday: { findMany: async () => (opts.holidays ?? []).map((d) => ({ date: d })) },
    // findFirst, not findUnique: settings are one row per tenant now, found by
    // the tenant filter rather than by the old literal id "company".
    companySettings: { findFirst: async () => null },
  }) as unknown as PrismaClient;

describe('classifyDay', () => {
  const holidays = new Set<string>();

  it('counts nothing before the employee joined', () => {
    const d = classifyDay({ date: dayDate(3), holidays, joiningDate: dayDate(10), now: dayDate(31) });
    expect(d.code).toBe('');
    expect(d.counts).toBe(false);
  });

  it('counts nothing for a date that has not happened yet', () => {
    const d = classifyDay({ date: dayDate(20), holidays, now: dayDate(10) });
    expect(d.code).toBe('');
    expect(d.counts).toBe(false);
  });

  it('marks Sundays as a paid weekly off, worked or not', () => {
    const now = dayDate(31);
    expect(classifyDay({ date: dayDate(8), holidays, now }).code).toBe('WO');
    expect(classifyDay({ date: dayDate(8), att: workDay(8), shift: SHIFT, holidays, now }).code).toBe('WO*');
  });

  it('keeps a punch awaiting sign-off out of the worked days', () => {
    const att = workDay(4, { approvalStatus: 'PENDING' });
    const d = classifyDay({ date: dayDate(4), att, shift: SHIFT, holidays, now: dayDate(31) });
    expect(d.code).toBe('PN');
    expect(d.worked).toBe(false);
    expect(d.pending).toBe(true);
  });

  it('separates unpaid LOP leave from paid leave', () => {
    const now = dayDate(31);
    const leave = (type: string) => [{ type, fromDate: dayDate(4), toDate: dayDate(4) }];
    expect(classifyDay({ date: dayDate(4), holidays, leaves: leave('LOP'), now }).code).toBe('LOP');
    expect(classifyDay({ date: dayDate(4), holidays, leaves: leave('SL'), now }).code).toBe('LV');
  });
});

describe('muster totals', () => {
  it('reconciles: present + absent + WO + HL + LV + LOP = days served', async () => {
    const atts = [
      workDay(2),
      workDay(3),
      workDay(4, { checkIn: at(4, '13:00'), status: 'HALF_DAY', workingMinutes: 300 }), // half day
      workDay(5, { approvalStatus: 'PENDING' }), // held for sign-off
      workDay(8), // Sunday duty
    ];
    const leaves = [{ employeeId: 'e1', type: 'SL', fromDate: dayDate(6), toDate: dayDate(6) }];
    const report = await buildMusterReport(fakePrisma({ atts, leaves }), MONTH, YEAR);
    const e = report.employees[0];

    expect(e.servedDays).toBe(31);
    expect(e.present).toBe(2.5); // two full days + a half day (Sunday duty counts under WO*)
    expect(e.sundayDuty).toBe(1);
    expect(e.pending).toBe(1);
    expect(e.leave).toBe(1);
    expect(e.weeklyOff).toBe(5); // Sundays 1, 8, 15, 22, 29
    expect(e.present + e.absent + e.weeklyOff + e.holidays + e.leave + e.lop).toBe(e.servedDays);
  });

  it('never counts days before joining as absent', async () => {
    const employee = { ...EMP, joiningDate: dayDate(23) };
    const report = await buildMusterReport(fakePrisma({ atts: [], employee }), MONTH, YEAR);
    const e = report.employees[0];

    expect(e.servedDays).toBe(9); // the 23rd (a Monday) to the 31st
    expect(e.weeklyOff).toBe(1); // only the 29th — the earlier Sundays fall before joining
    expect(e.absent).toBe(8); // the eight working days served, none of them worked
  });

  it('leaves LOP out of the paid days', async () => {
    const leaves = [{ employeeId: 'e1', type: 'LOP', fromDate: dayDate(2), toDate: dayDate(3) }];
    const report = await buildMusterReport(fakePrisma({ leaves }), MONTH, YEAR);
    const e = report.employees[0];

    expect(e.lop).toBe(2);
    expect(e.leave).toBe(0);
    expect(e.paidDays).toBe(e.present + e.weeklyOff + e.holidays); // LOP excluded
  });
});

describe('payroll agrees with the muster', () => {
  const run = (atts: AttStub[] = [], leaves: unknown[] = [], employee = EMP) =>
    computeMonthlyPayroll(fakePrisma({ atts, leaves, employee }), employee, MONTH, YEAR, new Set());

  it('reports the same present and absent days as the grid', async () => {
    const atts = [
      workDay(2),
      workDay(3),
      workDay(4, { checkIn: at(4, '13:00'), status: 'HALF_DAY', workingMinutes: 300 }),
      workDay(5, { approvalStatus: 'PENDING' }),
      workDay(8), // Sunday duty — paid extra, counted outside present on both sides
    ];
    const pay = await run(atts);
    const muster = (await buildMusterReport(fakePrisma({ atts }), MONTH, YEAR)).employees[0];

    expect(pay.presentDays).toBe(muster.present);
    expect(pay.absentDays).toBe(muster.absent);
    expect(pay.pendingDays).toBe(muster.pending);
    expect(pay.sundayDays).toBe(muster.sundayDuty);
    expect(pay.servedDays).toBe(muster.servedDays);
  });

  it('holds pay for a punch awaiting approval and keeps the day out of present', async () => {
    const pay = await run([workDay(2, { approvalStatus: 'PENDING' })]);
    expect(pay.presentDays).toBe(0);
    expect(pay.pendingDays).toBe(1);
    expect(pay.absentDays).toBeGreaterThanOrEqual(1);
  });

  it('pays a mid-month joiner pro-rata instead of marking the earlier days absent', async () => {
    const employee = { ...EMP, joiningDate: dayDate(23) };
    // Works every day from the 23rd to the 31st except the Sunday (29th).
    const atts = [23, 24, 25, 26, 27, 28, 30, 31].map((d) => workDay(d));
    const pay = await run(atts, [], employee);

    expect(pay.servedDays).toBe(9);
    expect(pay.absentDays).toBe(0);
    expect(pay.paidDays).toBe(9); // 8 worked days + the Sunday weekly-off
    expect(pay.netSalary).toBe(9000); // ₹1,000/day
  });

  it('keeps paidDays + absentDays + lopDays equal to the days served', async () => {
    const atts = [
      workDay(2),
      workDay(4, { checkIn: at(4, '13:00'), status: 'HALF_DAY', workingMinutes: 300 }),
      workDay(5, { approvalStatus: 'PENDING' }),
    ];
    const leaves = [{ employeeId: 'e1', type: 'LOP', fromDate: dayDate(9), toDate: dayDate(10) }];
    const pay = await run(atts, leaves);

    expect(pay.paidDays + pay.absentDays + pay.lopDays).toBe(pay.servedDays);
  });
});
