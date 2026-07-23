import type { PrismaClient } from '@prisma/client';
import { calculatePF, calculateESI } from './payroll.service.js';

/**
 * Payroll rules (owner-specified):
 *  - Per-day salary = monthly salary / 30 (e.g. ₹9,000 → ₹300/day), regardless
 *    of the month's length.
 *  - Sundays and configured holidays are paid weekly-offs.
 *  - Casual Leave (CL) is paid up to CL_PER_YEAR (12) days per calendar year;
 *    CL beyond the quota becomes LOP. SL/EL stay paid; LOP is unpaid.
 *  - Working a Sunday (any hours, even a partial shift) earns one EXTRA full
 *    day's salary on top of the paid weekly-off.
 *  - Overtime: duty time beyond OT_DAILY_THRESHOLD_HOURS (10) in a day
 *    accumulates as OT hours; every OT_HOURS_PER_DAY (10) OT hours pays one
 *    extra day, pro-rated (15 OT hours → 1.5 days, 20 → 2 days).
 *  - Out-of-geofence check-ins count only once HR approves them (PENDING /
 *    REJECTED attendance is not paid; rejected days are marked ABSENT).
 *  - Late marking uses the shift grace period (default 15 min) at check-in.
 *  - Late-punch discipline (configurable via PAYROLL_* env vars): salary is
 *    normally dated the 5th of the next month; LATE_SHIFT_AT (5) or more late
 *    punches moves it to the 8th; more than LATE_WITHHOLD_OVER (8) late punches
 *    WITHHOLDS the slip — the amounts are still computed and visible, but the
 *    employee PDF is blocked until HR releases it.
 */
const MONTH_DIVISOR = 30;
const CL_PER_YEAR = 12;
const OT_DAILY_THRESHOLD_HOURS = 10;
const OT_HOURS_PER_DAY = 10;

// Late-punch policy — env-overridable so the rule can be tuned without a code change.
const LATE_SHIFT_AT = Number(process.env.PAYROLL_LATE_SHIFT_AT ?? 5); // ≥ this many lates → pay on the late day
const LATE_WITHHOLD_OVER = Number(process.env.PAYROLL_LATE_WITHHOLD_OVER ?? 8); // > this many lates → withhold slip
const PAY_DAY_NORMAL = Number(process.env.PAYROLL_PAY_DAY ?? 5); // day of next month
const PAY_DAY_LATE = Number(process.env.PAYROLL_PAY_DAY_LATE ?? 8);

const DAY_MS = 86_400_000;
const round2 = (n: number) => Math.round(n * 100) / 100;
const dayKey = (d: Date) => `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;

/** Attendance counts for pay only when it never needed approval or was approved. */
const countsForPay = (a: { approvalStatus: string | null }) =>
  a.approvalStatus == null || a.approvalStatus === 'APPROVED';

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
  const employees = await prisma.employee.findMany({ where: { status: 'ACTIVE' }, include: { shift: true } });
  const start = new Date(year, month - 1, 1);
  const end = new Date(year, month, 1);
  const daysInMonth = new Date(year, month, 0).getDate();

  const holidays = await prisma.holiday.findMany({
    where: { date: { gte: start, lt: end } },
  });
  const holidaySet = new Set(holidays.map((h) => dayKey(h.date)));

  let totalNet = 0;

  for (const emp of employees) {
    const atts = await prisma.attendance.findMany({
      where: { employeeId: emp.id, date: { gte: start, lt: end } },
    });
    const attByDay = new Map(atts.map((a) => [dayKey(a.date), a]));

    // CL quota already used this year before this month (approved CL only).
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
    const leaveOn = (d: Date) => leaves.find((lv) => lv.fromDate <= endOfDay(d) && lv.toDate >= startOfDay(d));

    let paidDays = 0; // present + paid leave + paid weekly-offs/holidays
    let presentDays = 0;
    let absentDays = 0;
    let lopDays = 0;
    let sundayWorkedDays = 0; // each pays one EXTRA day
    let otMinutes = 0;
    let lateDays = 0; // late punches this month (discipline policy)

    for (let dn = 1; dn <= daysInMonth; dn++) {
      const d = new Date(year, month - 1, dn);
      const att = attByDay.get(dayKey(d));
      const attPaid = att && att.checkIn && countsForPay(att) &&
        (att.status === 'PRESENT' || att.status === 'LATE' || att.status === 'HALF_DAY');

      // OT accrues on any counted duty day (incl. Sundays), beyond the shift's
      // configured daily OT threshold (falls back to the global default).
      if (attPaid && att!.workingMinutes) {
        const otAfterMin = (emp.shift?.otThresholdHours ?? OT_DAILY_THRESHOLD_HOURS) * 60;
        otMinutes += Math.max(0, att!.workingMinutes - otAfterMin);
      }
      if (attPaid && att!.status === 'LATE') lateDays += 1;

      const isOffDay = d.getDay() === 0 || holidaySet.has(dayKey(d));
      if (isOffDay) {
        paidDays += 1; // weekly-off / holiday is paid
        if (d.getDay() === 0 && attPaid) sundayWorkedDays += 1; // Sunday duty = +1 extra day
        continue;
      }

      if (attPaid) {
        const credit = att!.status === 'HALF_DAY' ? 0.5 : 1;
        paidDays += credit;
        presentDays += credit;
        continue;
      }

      const lv = leaveOn(d);
      if (lv) {
        if (lv.type === 'LOP') {
          lopDays += 1;
        } else if (lv.type === 'CL') {
          if (clUsed < CL_PER_YEAR) {
            clUsed += 1;
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
    const otDays = round2(otHours / OT_HOURS_PER_DAY); // pro-rated: 15h → 1.5 days

    const perDay = emp.salary / MONTH_DIVISOR;
    const basePay = perDay * paidDays;
    const otPay = round2(perDay * otDays);
    const sundayPay = round2(perDay * sundayWorkedDays);
    const extraPay = otPay + sundayPay;

    // Owner policy: NO salary-structure split (no HRA/DA lines) — the payslip
    // carries the earned salary + OT/Sunday extra as-is. PF/ESI apply only to
    // employees flagged for them (pfEnabled / esiEnabled).
    const earnedBasic = round2(basePay); // total earned salary for the month
    const earnedHra = 0;
    const earnedDa = 0;
    const earnedOther = round2(extraPay); // OT + Sunday-duty pay
    const grossSalary = round2(earnedBasic + earnedOther);

    const pf = emp.pfEnabled ? calculatePF(earnedBasic) : 0; // 12%, capped ₹1800
    const esi = emp.esiEnabled ? calculateESI(grossSalary) : 0; // 0.75% if gross <= ₹21,000
    const netSalary = round2(Math.max(0, grossSalary - pf - esi));

    // Late-punch policy: pay date shifts at LATE_SHIFT_AT lates; slip withheld
    // beyond LATE_WITHHOLD_OVER. `month` is 1-based, so Date(year, month, d)
    // lands on day d of the FOLLOWING month (July salary → Aug 5/8).
    const payDay = lateDays >= LATE_SHIFT_AT ? PAY_DAY_LATE : PAY_DAY_NORMAL;
    const payDate = new Date(year, month, payDay);
    const withheld = lateDays > LATE_WITHHOLD_OVER;

    const fields = {
      presentDays: Math.round(presentDays),
      absentDays,
      lopDays,
      lateDays,
      payDate,
      otHours,
      otDays,
      otPay,
      sundayDays: sundayWorkedDays,
      sundayPay,
      basicSalary: earnedBasic,
      hra: earnedHra,
      da: earnedDa,
      otherAllowances: earnedOther,
      grossSalary,
      pfDeduction: pf,
      esiDeduction: esi,
      ptDeduction: 0,
      tdsDeduction: 0,
      otherDeductions: 0,
      netSalary,
      status: withheld ? 'WITHHELD' : 'FINALIZED',
    };

    await prisma.payslip.upsert({
      where: { employeeId_month_year: { employeeId: emp.id, month, year } },
      update: fields,
      create: { employeeId: emp.id, month, year, ...fields },
    });

    totalNet += netSalary;
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

function startOfDay(d: Date): Date {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  return x;
}

function endOfDay(d: Date): Date {
  const x = new Date(d);
  x.setHours(23, 59, 59, 999);
  return x;
}
