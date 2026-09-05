import { describe, expect, it } from 'vitest';
import type { PrismaClient } from '@prisma/client';
import { computeMonthlyPayroll, type PayrollEmployee } from '../src/services/payroll/payroll-run.service.js';

/**
 * July 2026: 31 days, Sundays on the 5th, 12th, 19th and 26th (27 working days).
 * Salary ₹9,000 → ₹300/day (monthly / 30, per owner policy).
 */
const MONTH = 7;
const YEAR = 2026;

const EMPLOYEE: PayrollEmployee = {
  id: 'e1',
  salary: 9000,
  pfEnabled: false,
  esiEnabled: false,
  shift: { startTime: '09:00', endTime: '18:00', gracePeriod: 15, otAfterMinutes: 0 },
};

interface Punch {
  day: number;
  in: string;
  out?: string;
  status?: string;
  approvalStatus?: string | null;
}

interface LeaveRow {
  type: string;
  fromDay: number;
  toDay: number;
}

/** Minimal Prisma stand-in — computeMonthlyPayroll only reads attendance + leave. */
function fakePrisma(punches: Punch[], leaves: LeaveRow[] = []): PrismaClient {
  const utc = (day: number, hhmm: string) => {
    const [h, m] = hhmm.split(':').map(Number);
    return new Date(Date.UTC(YEAR, MONTH - 1, day, h, m));
  };
  const attendance = punches.map((p) => ({
    employeeId: EMPLOYEE.id,
    date: new Date(YEAR, MONTH - 1, p.day),
    checkIn: utc(p.day, p.in),
    checkOut: p.out ? utc(p.day, p.out) : null,
    status: p.status ?? 'PRESENT',
    approvalStatus: p.approvalStatus ?? null,
  }));
  const leaveRows = leaves.map((l) => ({
    employeeId: EMPLOYEE.id,
    type: l.type,
    status: 'APPROVED',
    fromDate: new Date(YEAR, MONTH - 1, l.fromDay),
    toDate: new Date(YEAR, MONTH - 1, l.toDay, 23, 59, 59),
  }));
  return {
    attendance: { findMany: async () => attendance },
    // Called twice: once for the year's CL usage, once for this month's leaves.
    leave: { findMany: async () => leaveRows },
  } as unknown as PrismaClient;
}

const run = (punches: Punch[], leaves: LeaveRow[] = []) =>
  computeMonthlyPayroll(fakePrisma(punches, leaves), EMPLOYEE, MONTH, YEAR, new Set());

describe('computeMonthlyPayroll', () => {
  it('pays Sundays as weekly-offs even with no attendance at all', async () => {
    const r = await run([]);
    expect(r.daysInMonth).toBe(31);
    expect(r.offDays).toBe(4); // four Sundays
    expect(r.paidDays).toBe(4);
    expect(r.absentDays).toBe(27);
    expect(r.netSalary).toBe(1200); // 4 × ₹300
  });

  it('counts a half day as 0.5 present AND 0.5 absent', async () => {
    // Two full absences plus one half day must report 2.5 absent days.
    const punches: Punch[] = [];
    for (let d = 1; d <= 31; d++) {
      const dow = new Date(YEAR, MONTH - 1, d).getDay();
      if (dow === 0) continue; // Sunday
      if (d === 2 || d === 3) continue; // two absences
      if (d === 6) punches.push({ day: d, in: '09:00', out: '13:15' }); // half day (left midday)
      else punches.push({ day: d, in: '09:00', out: '18:00' });
    }
    const r = await run(punches);
    expect(r.halfDays).toBe(1);
    expect(r.absentDays).toBe(2.5);
    expect(r.presentDays).toBe(24.5); // 27 working days − 2 absent − 0.5
    expect(r.paidDays).toBe(28.5); // 24.5 worked + 4 Sundays
  });

  it('re-derives a half day from the punch times, not the stored status', async () => {
    // Stored as PRESENT, but the check-out lands inside the midday window.
    const r = await run([{ day: 1, in: '09:00', out: '13:00', status: 'PRESENT' }]);
    expect(r.halfDays).toBe(1);
    expect(r.presentDays).toBe(0.5);
  });

  it('pays a full extra day for Sunday duty, even for a half day', async () => {
    // 5 July 2026 is a Sunday; work only until 13:00 (a half day on a weekday).
    const r = await run([{ day: 5, in: '09:00', out: '13:00' }]);
    expect(r.sundayDays).toBe(1);
    expect(r.sundayPay).toBe(300); // one FULL day, not 150
    // The Sunday itself stays a paid weekly-off and is not counted absent.
    expect(r.absentDays).toBe(27);
    expect(r.halfDays).toBe(0);
  });

  it('accrues OT past the shift close and pays 10 OT hours as one day', async () => {
    // Five days of 09:00→23:00 = 5 h OT each = 25 OT hours → 2.5 days.
    const r = await run([1, 2, 3, 6, 7].map((day) => ({ day, in: '09:00', out: '23:00' })));
    expect(r.otHours).toBe(25);
    expect(r.otDays).toBe(2.5);
    expect(r.otPay).toBe(750); // 2.5 × ₹300
  });

  it('does not pay a punch that is still awaiting approval', async () => {
    const r = await run([{ day: 1, in: '09:00', out: '18:00', approvalStatus: 'PENDING' }]);
    expect(r.presentDays).toBe(0);
    expect(r.absentDays).toBe(27);
    // The same punch, approved, is paid.
    const ok = await run([{ day: 1, in: '09:00', out: '18:00', approvalStatus: 'APPROVED' }]);
    expect(ok.presentDays).toBe(1);
    expect(ok.absentDays).toBe(26);
  });

  it('pays casual leave inside the yearly quota and reports the days used', async () => {
    const r = await run([], [{ type: 'CL', fromDay: 1, toDay: 2 }]);
    expect(r.clDays).toBe(2);
    expect(r.paidDays).toBe(6); // 4 Sundays + 2 paid CL days
    expect(r.absentDays).toBe(25);
  });

  it('withholds money for unpaid days and reconciles against paid days', async () => {
    const r = await run([{ day: 1, in: '09:00', out: '18:00' }]);
    // Every day of the month is either paid or unpaid — nothing falls through.
    expect(r.paidDays + r.absentDays + r.lopDays).toBe(r.daysInMonth);
    expect(r.leaveDeduction).toBe(Math.round(r.perDaySalary * (r.absentDays + r.lopDays) * 100) / 100);
  });

  it('applies PF and ESI only when the employee is flagged for them', async () => {
    const punches = [{ day: 1, in: '09:00', out: '18:00' }];
    const plain = await computeMonthlyPayroll(fakePrisma(punches), EMPLOYEE, MONTH, YEAR, new Set());
    expect(plain.pf).toBe(0);
    expect(plain.esi).toBe(0);

    const withDeductions = await computeMonthlyPayroll(
      fakePrisma(punches),
      { ...EMPLOYEE, pfEnabled: true, esiEnabled: true },
      MONTH,
      YEAR,
      new Set(),
    );
    expect(withDeductions.pf).toBeGreaterThan(0);
    expect(withDeductions.esi).toBeGreaterThan(0);
    expect(withDeductions.netSalary).toBeLessThan(plain.netSalary);
  });

  it('treats configured holidays as paid days off', async () => {
    const jul4 = new Date(YEAR, MONTH - 1, 4);
    const holidays = new Set([`${jul4.getFullYear()}-${jul4.getMonth()}-${jul4.getDate()}`]);
    const r = await computeMonthlyPayroll(fakePrisma([]), EMPLOYEE, MONTH, YEAR, holidays);
    expect(r.offDays).toBe(5); // 4 Sundays + 1 holiday
    expect(r.absentDays).toBe(26);
  });
});

describe('payroll policy is per dealer', () => {
  const fullMonth = () => {
    const punches: Punch[] = [];
    for (let d = 1; d <= 31; d++) {
      if (new Date(YEAR, MONTH - 1, d).getDay() === 0) continue; // Sunday
      punches.push({ day: d, in: '09:00', out: '18:00' });
    }
    return punches;
  };

  it('divides the monthly salary by the dealer’s own divisor', async () => {
    const base = await computeMonthlyPayroll(fakePrisma(fullMonth()), EMPLOYEE, MONTH, YEAR, new Set());
    expect(base.perDaySalary).toBe(300); // 9000 / 30, the platform default

    const byDaysInMonth = await computeMonthlyPayroll(
      fakePrisma(fullMonth()), EMPLOYEE, MONTH, YEAR, new Set(),
      { monthDivisor: 31, clPerYear: 12, otHoursPerDay: 10, lateShiftAt: 5, lateWithholdOver: 8, payDay: 5, payDayLate: 8 },
    );
    // 9000 / 31 — a dealer that pays by the real length of the month.
    // The engine rounds to paise, so compare at 2 decimal places.
    expect(byDaysInMonth.perDaySalary).toBeCloseTo(9000 / 31, 2);
    expect(byDaysInMonth.perDaySalary).not.toBe(base.perDaySalary);
  });

  it('honours the dealer’s pay-day rules', async () => {
    const lates = fullMonth().map((p, i) => (i < 6 ? { ...p, in: '11:00' } : p));
    const strict = await computeMonthlyPayroll(
      fakePrisma(lates), EMPLOYEE, MONTH, YEAR, new Set(),
      { monthDivisor: 30, clPerYear: 12, otHoursPerDay: 10, lateShiftAt: 5, lateWithholdOver: 8, payDay: 5, payDayLate: 8 },
    );
    const lenient = await computeMonthlyPayroll(
      fakePrisma(lates), EMPLOYEE, MONTH, YEAR, new Set(),
      { monthDivisor: 30, clPerYear: 12, otHoursPerDay: 10, lateShiftAt: 99, lateWithholdOver: 99, payDay: 5, payDayLate: 8 },
    );
    // Same punches, different dealer rules → a different pay date.
    expect(strict.payDate?.getDate()).toBe(8);
    expect(lenient.payDate?.getDate()).toBe(5);
  });
});

describe('a company-wide run does not query per employee', () => {
  /** Counts queries so the N+1 fix is measured, not assumed. */
  function countingPrisma(punches: Punch[], counts: { attendance: number; leave: number }) {
    const base = fakePrisma(punches) as unknown as {
      attendance: { findMany: () => Promise<unknown[]> };
      leave: { findMany: () => Promise<unknown[]> };
    };
    return {
      attendance: {
        findMany: async () => {
          counts.attendance += 1;
          return base.attendance.findMany();
        },
      },
      leave: {
        findMany: async () => {
          counts.leave += 1;
          return base.leave.findMany();
        },
      },
    } as unknown as PrismaClient;
  }

  const punches: Punch[] = [{ day: 1, in: '09:00', out: '18:00' }];

  it('reads three times per employee when nothing is preloaded', async () => {
    const counts = { attendance: 0, leave: 0 };
    await computeMonthlyPayroll(countingPrisma(punches, counts), EMPLOYEE, MONTH, YEAR, new Set());
    expect(counts.attendance).toBe(1);
    expect(counts.leave).toBe(2); // CL-for-the-year, and this month's leaves
  });

  it('reads nothing when the month is preloaded', async () => {
    const counts = { attendance: 0, leave: 0 };
    const preloaded = {
      attendance: [],
      clLeavesThisYear: [],
      monthLeaves: [],
    };
    await computeMonthlyPayroll(
      countingPrisma(punches, counts), EMPLOYEE, MONTH, YEAR, new Set(),
      undefined, undefined, preloaded,
    );
    expect(counts.attendance, 'preloaded data must not be re-fetched').toBe(0);
    expect(counts.leave).toBe(0);
  });

  it('produces the same figures preloaded as it does querying', async () => {
    const month = [1, 2, 3, 6, 7].map((day) => ({ day, in: '09:00', out: '18:00' }));
    const queried = await computeMonthlyPayroll(fakePrisma(month), EMPLOYEE, MONTH, YEAR, new Set());

    // The same rows the loader would have handed over.
    const rows = (await (fakePrisma(month) as unknown as {
      attendance: { findMany: () => Promise<never[]> };
    }).attendance.findMany());
    const preloadedResult = await computeMonthlyPayroll(
      fakePrisma([]), EMPLOYEE, MONTH, YEAR, new Set(),
      undefined, undefined, { attendance: rows, clLeavesThisYear: [], monthLeaves: [] },
    );

    expect(preloadedResult.presentDays).toBe(queried.presentDays);
    expect(preloadedResult.netSalary).toBe(queried.netSalary);
    expect(preloadedResult.paidDays).toBe(queried.paidDays);
  });
});
