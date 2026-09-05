import type { PrismaClient } from '@prisma/client';
import { calculatePF, calculateESI } from './payroll.service.js';
import { classifyDay, overtimeMinutes } from '../attendance/day-classify.js';
import { dayKey } from '../../utils/time.js';
import { requireTenantId } from '../../context/tenant-context.js';
import { defaultPolicy, getTenantPolicy, type PayrollPolicy } from '../settings/tenant-settings.service.js';
import { DEFAULT_HALF_DAY_WINDOW, type HalfDayWindow } from '../attendance/attendance-policy.js';

/**
 * Payroll rules (owner-specified):
 *  - Per-day salary = monthly salary / 30 (e.g. ₹9,000 → ₹300/day), regardless
 *    of the month's length.
 *  - Sundays and configured holidays are paid weekly-offs.
 *  - Casual Leave (CL) is paid up to the tenant's CL quota (12 by default) per calendar year;
 *    CL beyond the quota becomes LOP. SL/EL stay paid; LOP is unpaid.
 *  - Working a Sunday earns one EXTRA full day's salary on top of the paid
 *    weekly-off — even for a half day, a Sunday pays a full day of OT.
 *  - Half day (check-in or check-out inside the midday window — see
 *    attendance-policy) pays 0.5 and adds 0.5 to the absent-day count, so two
 *    absences plus one half day report as 2.5.
 *  - Overtime: duty time worked past the shift's close time + its OT grace
 *    (Shift.otAfterMinutes) accumulates as OT hours; every 10 OT hours (per tenant)
 *    OT hours pays one extra day, pro-rated (15 OT hours → 1.5 days).
 *  - Punches that need sign-off (out-of-geofence, late, manual/selfie) count
 *    only once approved; PENDING / REJECTED attendance is not paid (a pending
 *    day sits under absentDays until it is approved).
 *  - Days before the employee's joining date are outside the month's service
 *    window: never absent, never paid. A mid-month joiner is paid pro-rata.
 *  - Late marking uses the shift grace period (default 15 min) at check-in.
 *  - Late-punch discipline (configurable via PAYROLL_* env vars): salary is
 *    normally dated the 5th of the next month; the tenant's late threshold (5 by default) or more late
 *    punches moves it to the 8th; more than the withhold threshold (8 by default) late punches
 *    WITHHOLDS the slip — the amounts are still computed and visible, but the
 *    employee PDF is blocked until HR releases it.
 */
/**
 * Payroll rules are per dealer now (TenantSettings), but every one of them has
 * a platform default so a caller that does not care — and every existing test —
 * behaves exactly as before. `computeMonthlyPayroll` takes the policy as a
 * trailing optional argument for the same reason.
 *
 * (The OT threshold stays per-shift: Shift.otAfterMinutes, after shift close.)
 */
const DEFAULT_PAYROLL_POLICY: PayrollPolicy = defaultPolicy().payroll;

const DAY_MS = 86_400_000;
const round2 = (n: number) => Math.round(n * 100) / 100;

/** The employee shape the monthly calculation needs. */
export interface PayrollEmployee {
  id: string;
  salary: number;
  pfEnabled: boolean;
  esiEnabled: boolean;
  joiningDate?: Date | null;
  shift?: { startTime: string; endTime: string; gracePeriod?: number | null; otAfterMinutes?: number | null } | null;
}

/** Everything the payslip and the payroll report need for one employee-month. */
export interface MonthlyPayroll {
  daysInMonth: number;
  /**
   * Days of the month inside the employee's service that have already happened.
   * Equals daysInMonth for a full month; shorter for a mid-month joiner or a
   * month still in progress. The invariant is
   * paidDays + absentDays + lopDays === servedDays.
   */
  servedDays: number;
  /** Sundays + configured holidays inside the served window (paid weekly-offs). */
  offDays: number;
  presentDays: number; // fractional — a half day counts 0.5
  halfDays: number; // number of half days (whole count)
  absentDays: number; // fractional — half days and pending punches included
  pendingDays: number; // the awaiting-sign-off subset of absentDays
  lopDays: number;
  clDays: number; // casual leave consumed inside this month
  paidDays: number;
  lateDays: number;
  sundayDays: number; // Sundays worked — each pays one extra full day
  sundayPay: number;
  otHours: number;
  otDays: number;
  otPay: number;
  perDaySalary: number;
  basePay: number;
  leaveDeduction: number; // withheld for unpaid days (absent + LOP)
  grossSalary: number;
  pf: number;
  esi: number;
  netSalary: number;
  payDate: Date;
  withheld: boolean;
}

/**
 * Compute one employee's month. Pure with respect to the DB writes — the
 * payroll run persists the result, the payroll report renders it directly, so
 * a report never disagrees with the payslip and doesn't need a run first.
 */
export async function computeMonthlyPayroll(
  prisma: PrismaClient,
  emp: PayrollEmployee,
  month: number,
  year: number,
  holidaySet: Set<string>,
  policy: PayrollPolicy = DEFAULT_PAYROLL_POLICY,
  halfDayWindow: HalfDayWindow = DEFAULT_HALF_DAY_WINDOW,
): Promise<MonthlyPayroll> {
  const start = new Date(year, month - 1, 1);
  const end = new Date(year, month, 1);
  const daysInMonth = new Date(year, month, 0).getDate();
  const now = new Date();

  const atts = await prisma.attendance.findMany({
    where: { employeeId: emp.id, date: { gte: start, lt: end } },
  });
  const attByDay = new Map(atts.map((a) => [dayKey(a.date), a]));

  // CL quota already used this year BEFORE this month (approved CL only).
  const clLeavesThisYear = await prisma.leave.findMany({
    where: { employeeId: emp.id, type: 'CL', status: 'APPROVED' },
  });
  const yearStart = new Date(year, 0, 1);
  let clUsed = 0;
  for (const lv of clLeavesThisYear) {
    clUsed += overlapDays(lv.fromDate, lv.toDate, yearStart, start);
  }

  // Approved leaves overlapping this month, resolved per-day below.
  const leaves = await prisma.leave.findMany({
    where: { employeeId: emp.id, status: 'APPROVED', fromDate: { lt: end }, toDate: { gte: start } },
  });

  let paidDays = 0; // present + paid leave + paid weekly-offs/holidays
  let presentDays = 0;
  let halfDays = 0;
  let absentDays = 0;
  let pendingDays = 0;
  let lopDays = 0;
  let clDays = 0; // CL consumed inside this month
  let offDays = 0;
  let servedDays = 0;
  let sundayDays = 0; // each pays one EXTRA day
  let otMinutes = 0;
  let lateDays = 0; // late punches this month (discipline policy)

  for (let dn = 1; dn <= daysInMonth; dn++) {
    const d = new Date(year, month - 1, dn);
    const att = attByDay.get(dayKey(d));
    // Classified by the same rules the muster grid and the reports use, so a
    // day can never be paid here and shown absent there.
    const day = classifyDay({
      halfDayWindow,
      date: d,
      att,
      shift: emp.shift,
      leaves,
      holidays: holidaySet,
      joiningDate: emp.joiningDate,
      now,
    });

    // OT = duty time worked PAST the shift close + the shift's OT grace (minutes).
    // Based on the actual check-out clock time, so leaving late earns OT.
    if (day.worked) otMinutes += overtimeMinutes(att!.checkOut, emp.shift);

    // Before joining, or not yet happened — no pay, no absence.
    if (!day.counts) continue;
    servedDays += 1;
    if (day.late) lateDays += 1;

    if (day.isOff) {
      offDays += 1;
      paidDays += 1; // weekly-off / holiday is paid
      // Sunday duty = +1 extra day, at full rate even when only a half day was worked.
      if (day.isSunday && day.worked) sundayDays += 1;
      continue;
    }

    if (day.worked) {
      if (day.status === 'HALF_DAY') {
        halfDays += 1;
        paidDays += 0.5;
        presentDays += 0.5;
        absentDays += 0.5; // the unworked half reads as absent (2 absents + 1 half → 2.5)
      } else {
        paidDays += 1;
        presentDays += 1;
      }
      continue;
    }

    // Held for sign-off: unpaid until approved, so it counts as an absence for
    // this run — approving the punch and re-running pays it.
    if (day.pending) {
      pendingDays += 1;
      absentDays += 1;
      continue;
    }

    const lv = day.leave;
    if (lv) {
      if (lv.type === 'LOP') {
        lopDays += 1;
      } else if (lv.type === 'CL') {
        if (clUsed < policy.clPerYear) {
          clUsed += 1;
          clDays += 1;
          paidDays += 1;
        } else {
          lopDays += 1; // CL quota exhausted → LOP
        }
      } else if (lv.type === 'HALF_DAY') {
        paidDays += 0.5;
        lopDays += 0.5;
      } else {
        paidDays += 1; // SL / EL paid
      }
      continue;
    }

    absentDays += 1;
  }

  const otHours = round2(otMinutes / 60);
  const otDays = round2(otHours / policy.otHoursPerDay); // pro-rated: 15h → 1.5 days

  const perDaySalary = round2(emp.salary / policy.monthDivisor);
  const basePay = round2((emp.salary / policy.monthDivisor) * paidDays);
  const otPay = round2((emp.salary / policy.monthDivisor) * otDays);
  const sundayPay = round2((emp.salary / policy.monthDivisor) * sundayDays);
  const leaveDeduction = round2((emp.salary / policy.monthDivisor) * (absentDays + lopDays));

  const grossSalary = round2(basePay + otPay + sundayPay);
  const pf = emp.pfEnabled ? calculatePF(basePay) : 0; // 12%, capped ₹1800
  const esi = emp.esiEnabled ? calculateESI(grossSalary) : 0; // 0.75% if gross <= ₹21,000
  const netSalary = round2(Math.max(0, grossSalary - pf - esi));

  // Late-punch policy: pay date shifts at policy.lateShiftAt lates; slip withheld
  // beyond policy.lateWithholdOver. `month` is 1-based, so Date(year, month, d)
  // lands on day d of the FOLLOWING month (July salary → Aug 5/8).
  const payDate = new Date(year, month, lateDays >= policy.lateShiftAt ? policy.payDayLate : policy.payDay);

  return {
    daysInMonth,
    servedDays,
    offDays,
    presentDays: round2(presentDays),
    halfDays,
    absentDays: round2(absentDays),
    pendingDays,
    lopDays: round2(lopDays),
    clDays,
    paidDays: round2(paidDays),
    lateDays,
    sundayDays,
    sundayPay,
    otHours,
    otDays,
    otPay,
    perDaySalary,
    basePay,
    leaveDeduction,
    grossSalary,
    pf,
    esi,
    netSalary,
    payDate,
    withheld: lateDays > policy.lateWithholdOver,
  };
}

/** Sundays + configured holidays for the month, as a day-key set. */
export async function monthHolidaySet(prisma: PrismaClient, month: number, year: number): Promise<Set<string>> {
  const holidays = await prisma.holiday.findMany({
    where: { date: { gte: new Date(year, month - 1, 1), lt: new Date(year, month, 1) } },
  });
  return new Set(holidays.map((h) => dayKey(h.date)));
}

export interface PayrollRunSummary {
  month: number;
  year: number;
  employees: number;
  totalNet: number;
}

/** Generate (upsert) a payslip for every active employee for the given month. */
export async function runMonthlyPayroll(
  prisma: PrismaClient,
  month: number,
  year: number,
): Promise<PayrollRunSummary> {
  // One read per run, applied to every employee in it.
  const { payroll: policy, attendance } = await getTenantPolicy(prisma);
  const halfDayWindow = { start: attendance.halfDayWindowStart, end: attendance.halfDayWindowEnd };
  const employees = await prisma.employee.findMany({
    where: { status: 'ACTIVE' },
    include: { shift: true },
  });
  const holidaySet = await monthHolidaySet(prisma, month, year);

  let totalNet = 0;

  for (const emp of employees) {
    const r = await computeMonthlyPayroll(prisma, emp, month, year, holidaySet, policy, halfDayWindow);

    // Owner policy: NO salary-structure split (no HRA/DA lines) — the payslip
    // carries the earned salary + OT/Sunday extra as-is. PF/ESI apply only to
    // employees flagged for them (pfEnabled / esiEnabled).
    const fields = {
      presentDays: r.presentDays,
      absentDays: r.absentDays,
      halfDays: r.halfDays,
      lopDays: r.lopDays,
      clDays: r.clDays,
      leaveDeduction: r.leaveDeduction,
      perDaySalary: r.perDaySalary,
      daysInMonth: r.daysInMonth,
      lateDays: r.lateDays,
      payDate: r.payDate,
      otHours: r.otHours,
      otDays: r.otDays,
      otPay: r.otPay,
      sundayDays: r.sundayDays,
      sundayPay: r.sundayPay,
      basicSalary: r.basePay, // total earned salary for the month
      hra: 0,
      da: 0,
      otherAllowances: round2(r.otPay + r.sundayPay), // OT + Sunday-duty pay
      grossSalary: r.grossSalary,
      pfDeduction: r.pf,
      esiDeduction: r.esi,
      ptDeduction: 0,
      tdsDeduction: 0,
      otherDeductions: 0,
      netSalary: r.netSalary,
      status: r.withheld ? 'WITHHELD' : 'FINALIZED',
    };

    await prisma.payslip.upsert({
      where: { employeeId_month_year: { employeeId: emp.id, month, year } },
      update: fields,
      create: { employeeId: emp.id, month, year, ...fields, tenantId: requireTenantId() },
    });

    totalNet += r.netSalary;
  }

  return { month, year, employees: employees.length, totalNet: round2(totalNet) };
}

/** Number of days a leave [from,to] overlaps the window [start,end). */
function overlapDays(from: Date, to: Date, start: Date, end: Date): number {
  const a = from > start ? from : start;
  const b = to < new Date(end.getTime() - 1) ? to : new Date(end.getTime() - 1);
  if (a > b) return 0;
  return Math.floor((b.getTime() - a.getTime()) / DAY_MS) + 1;
}
