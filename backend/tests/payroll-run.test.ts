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

/** The same month, for an employee paid only for the days they worked. */
const runPresentOnly = (punches: Punch[], leaves: LeaveRow[] = []) =>
  computeMonthlyPayroll(
    fakePrisma(punches, leaves),
    { ...EMPLOYEE, payrollBasis: 'PRESENT_DAYS' },
    MONTH, YEAR, new Set(),
  );

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

  it('pays no overtime on a Sunday — the extra day is the rate for Sunday duty', async () => {
    // 5 July 2026 is a Sunday. Nine hours past the 18:00 close would once have
    // added 9 OT hours on top of the extra day, paying the same hours twice.
    const r = await run([{ day: 5, in: '09:00', out: '23:00' }]);
    expect(r.sundayDays).toBe(1);
    expect(r.sundayPay).toBe(300); // the whole of what Sunday duty pays
    expect(r.otHours).toBe(0);
    expect(r.otPay).toBe(0);
  });

  it('still pays overtime on a worked holiday, which earns no extra day', async () => {
    // 8 July 2026 declared a holiday. Unlike a Sunday it adds no extra day, so
    // without OT a holiday worked would pay exactly what staying home pays.
    const holidays = new Set(['2026-6-8']); // dayKey: year-monthIndex-day
    const r = await computeMonthlyPayroll(
      fakePrisma([{ day: 8, in: '09:00', out: '23:00' }]),
      EMPLOYEE, MONTH, YEAR, holidays,
    );
    expect(r.sundayDays).toBe(0); // a holiday is not Sunday duty
    expect(r.otHours).toBe(5); // 18:00 -> 23:00
    expect(r.otPay).toBe(150); // 0.5 day
  });

  it('counts a weekday’s overtime while ignoring a Sunday’s', async () => {
    // Both days run to 23:00; only Wednesday the 1st should contribute OT.
    const r = await run([
      { day: 1, in: '09:00', out: '23:00' },
      { day: 5, in: '09:00', out: '23:00' },
    ]);
    expect(r.otHours).toBe(5);
    expect(r.sundayDays).toBe(1);
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
      { monthDivisor: 31, clPerYear: 12, otHoursPerDay: 10, lateShiftAt: 5, payDay: 5, payDayLate: 8 },
    );
    // 9000 / 31 — a dealer that pays by the real length of the month.
    // The engine rounds to paise, so compare at 2 decimal places.
    expect(byDaysInMonth.perDaySalary).toBeCloseTo(9000 / 31, 2);
    expect(byDaysInMonth.perDaySalary).not.toBe(base.perDaySalary);
  });

  it('does not count a late arrival on a Sunday against the employee', async () => {
    // 5, 12, 19 and 26 July 2026 are Sundays. Turning up at 11:00 to help out
    // on all four used to read as four late punches — on days nobody is rostered
    // for — and fed the discipline policy that moves the pay date.
    const r = await run([5, 12, 19, 26].map((day) => ({ day, in: '11:00', out: '18:00' })));
    expect(r.lateDays).toBe(0);
    expect(r.sundayDays).toBe(4); // still paid as Sunday duty
  });

  it('does not count a late arrival on a holiday either', async () => {
    const holidays = new Set(['2026-6-8']); // dayKey: year-monthIndex-day
    const r = await computeMonthlyPayroll(
      fakePrisma([{ day: 8, in: '11:00', out: '18:00' }]),
      EMPLOYEE, MONTH, YEAR, holidays,
    );
    expect(r.lateDays).toBe(0);
  });

  it('still counts late arrivals on working days', async () => {
    // The guard must not swallow the policy it is narrowing.
    const r = await run([1, 2, 3].map((day) => ({ day, in: '11:00', out: '18:00' })));
    expect(r.lateDays).toBe(3);
  });

  it('does not let Sunday arrivals push the pay date out', async () => {
    // Four Sundays plus two weekday lates: six "late" punches under the old
    // rule, over a threshold of five, so the salary was dated the 8th instead
    // of the 5th. Only the two weekday punches should count.
    const punches = [
      ...[5, 12, 19, 26].map((day) => ({ day, in: '11:00', out: '18:00' })),
      ...[1, 2].map((day) => ({ day, in: '11:00', out: '18:00' })),
    ];
    const r = await computeMonthlyPayroll(
      fakePrisma(punches), EMPLOYEE, MONTH, YEAR, new Set(),
      { monthDivisor: 30, clPerYear: 12, otHoursPerDay: 10, lateShiftAt: 5, payDay: 5, payDayLate: 8 },
    );
    expect(r.lateDays).toBe(2);
    expect(r.payDate?.getDate()).toBe(5);
  });

  it('honours the dealer’s pay-day rules', async () => {
    const lates = fullMonth().map((p, i) => (i < 6 ? { ...p, in: '11:00' } : p));
    const strict = await computeMonthlyPayroll(
      fakePrisma(lates), EMPLOYEE, MONTH, YEAR, new Set(),
      { monthDivisor: 30, clPerYear: 12, otHoursPerDay: 10, lateShiftAt: 5, payDay: 5, payDayLate: 8 },
    );
    const lenient = await computeMonthlyPayroll(
      fakePrisma(lates), EMPLOYEE, MONTH, YEAR, new Set(),
      { monthDivisor: 30, clPerYear: 12, otHoursPerDay: 10, lateShiftAt: 99, payDay: 5, payDayLate: 8 },
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

/**
 * Two payroll structures in one dealership.
 *
 * MONTHLY is a monthly salary: weekly-offs and approved leave are paid, and
 * unpaid days are deducted. PRESENT_DAYS pays for days actually worked —
 * an unworked Sunday, holiday or leave day pays nothing.
 *
 * July 2026 has 31 days and four Sundays (5, 12, 19, 26), so 27 working days.
 * Salary ₹9,000 → ₹300/day.
 */
describe('payroll basis', () => {
  /** Every working day of July worked in full. */
  const everyWorkingDay = () => {
    const punches: Punch[] = [];
    for (let day = 1; day <= 31; day++) {
      if (new Date(YEAR, MONTH - 1, day).getDay() === 0) continue; // Sunday
      punches.push({ day, in: '09:00', out: '18:00' });
    }
    return punches;
  };

  it('defaults to MONTHLY, so an employee with no basis is paid as before', async () => {
    const r = await run([]);
    expect(r.payrollBasis).toBe('MONTHLY');
    expect(r.paidDays).toBe(4); // the four Sundays, paid
    expect(r.unpaidDays).toBe(0);
  });

  it('pays a monthly employee for the whole month when every working day is worked', async () => {
    const r = await run(everyWorkingDay());
    expect(r.paidDays).toBe(31); // 27 worked + 4 paid Sundays
    expect(r.basePay).toBe(9300); // 31 × ₹300 — a 31-day month over a 30-day divisor
  });

  it('pays a present-days employee only for the days worked', async () => {
    const r = await runPresentOnly(everyWorkingDay());
    expect(r.payrollBasis).toBe('PRESENT_DAYS');
    expect(r.paidDays).toBe(27); // the Sundays pay nothing
    expect(r.unpaidDays).toBe(4); // and are not absences either
    expect(r.absentDays).toBe(0);
    expect(r.basePay).toBe(8100); // 27 × ₹300
  });

  it('pays a present-days employee nothing for a Sunday they did not work', async () => {
    const r = await runPresentOnly([]);
    expect(r.paidDays).toBe(0);
    expect(r.unpaidDays).toBe(4); // four Sundays, unworked
    expect(r.absentDays).toBe(27); // the working days they did not attend
    expect(r.basePay).toBe(0);
  });

  it('still pays a present-days employee the extra day for working a Sunday', async () => {
    // 5 July is a Sunday. Working it pays the day itself plus the Sunday extra.
    const r = await runPresentOnly([{ day: 5, in: '09:00', out: '18:00' }]);
    expect(r.paidDays).toBe(1); // the day worked
    expect(r.sundayDays).toBe(1);
    expect(r.sundayPay).toBe(300); // the extra day, same on both bases
    expect(r.unpaidDays).toBe(3); // the other three Sundays
  });

  it('does not pay approved leave on the present-days basis', async () => {
    // 1-3 July: casual leave, approved and inside quota.
    const r = await runPresentOnly([], [{ type: 'CL', fromDay: 1, toDay: 3 }]);
    expect(r.clDays).toBe(3); // the quota is still consumed, so the balance reads right
    expect(r.paidDays).toBe(0); // but it buys time off, not pay
    expect(r.unpaidDays).toBe(7); // 3 leave days + 4 unworked Sundays
  });

  it('does pay the same leave on the monthly basis', async () => {
    const r = await run([], [{ type: 'CL', fromDay: 1, toDay: 3 }]);
    expect(r.clDays).toBe(3);
    expect(r.paidDays).toBe(7); // 3 leave + 4 Sundays
    expect(r.unpaidDays).toBe(0);
  });

  it('keeps LOP unpaid on both bases', async () => {
    const monthly = await run([], [{ type: 'LOP', fromDay: 1, toDay: 2 }]);
    const present = await runPresentOnly([], [{ type: 'LOP', fromDay: 1, toDay: 2 }]);
    expect(monthly.lopDays).toBe(2);
    expect(present.lopDays).toBe(2);
  });

  it('balances its days on both bases', async () => {
    // The invariant, generalised: everything inside the served window is
    // either paid, absent, LOP, or explicitly unpaid.
    for (const r of [await run(everyWorkingDay()), await runPresentOnly(everyWorkingDay())]) {
      expect(r.paidDays + r.absentDays + r.lopDays + r.unpaidDays).toBe(r.servedDays);
    }
  });

  it('lets the dealer default decide when the employee has none', async () => {
    const policy = {
      defaultPayrollBasis: 'PRESENT_DAYS' as const,
      monthDivisor: 30, clPerYear: 12, otHoursPerDay: 10, lateShiftAt: 5, payDay: 5, payDayLate: 8,
    };
    const r = await computeMonthlyPayroll(
      fakePrisma(everyWorkingDay()), EMPLOYEE, MONTH, YEAR, new Set(), policy,
    );
    expect(r.payrollBasis).toBe('PRESENT_DAYS');
    expect(r.paidDays).toBe(27);
  });

  it('lets an employee override the dealer default', async () => {
    const policy = {
      defaultPayrollBasis: 'PRESENT_DAYS' as const,
      monthDivisor: 30, clPerYear: 12, otHoursPerDay: 10, lateShiftAt: 5, payDay: 5, payDayLate: 8,
    };
    const r = await computeMonthlyPayroll(
      fakePrisma(everyWorkingDay()), { ...EMPLOYEE, payrollBasis: 'MONTHLY' }, MONTH, YEAR, new Set(), policy,
    );
    expect(r.payrollBasis).toBe('MONTHLY');
    expect(r.paidDays).toBe(31);
  });
});
