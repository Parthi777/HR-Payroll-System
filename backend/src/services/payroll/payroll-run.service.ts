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
 *    accumulates as OT hours; every OT_HOURS_PER_DAY (10) OT hours in the month
 *    pays one extra full day (50 OT hours → 5 OT days).
 *  - Out-of-geofence check-ins count only once HR approves them (PENDING /
 *    REJECTED attendance is not paid; rejected days are marked ABSENT).
 *  - Late marking uses the shift grace period (default 15 min) at check-in.
 */
const MONTH_DIVISOR = 30;
const CL_PER_YEAR = 12;
const OT_DAILY_THRESHOLD_HOURS = 10;
const OT_HOURS_PER_DAY = 10;

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
  const employees = await prisma.employee.findMany({ where: { status: 'ACTIVE' } });
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

    for (let dn = 1; dn <= daysInMonth; dn++) {
      const d = new Date(year, month - 1, dn);
      const att = attByDay.get(dayKey(d));
      const attPaid = att && att.checkIn && countsForPay(att) &&
        (att.status === 'PRESENT' || att.status === 'LATE' || att.status === 'HALF_DAY');

      // OT accrues on any counted duty day (incl. Sundays).
      if (attPaid && att!.workingMinutes) {
        otMinutes += Math.max(0, att!.workingMinutes - OT_DAILY_THRESHOLD_HOURS * 60);
      }

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

    const otDays = Math.floor(otMinutes / 60 / OT_HOURS_PER_DAY);
    const extraDays = sundayWorkedDays + otDays;

    const perDay = emp.salary / MONTH_DIVISOR;
    const basePay = perDay * paidDays;
    const extraPay = perDay * extraDays;

    // Standard structure split on base pay; Sunday-work + OT pay goes into
    // Other Allowances so the payslip shows it as an earning on top.
    const earnedBasic = round2(basePay * 0.5);
    const earnedHra = round2(basePay * 0.2);
    const earnedDa = round2(basePay * 0.15);
    const earnedOther = round2(basePay * 0.15 + extraPay);
    const grossSalary = round2(earnedBasic + earnedHra + earnedDa + earnedOther);

    const pf = calculatePF(earnedBasic); // 12% of earned basic, capped ₹1800
    const esi = calculateESI(grossSalary); // 0.75% if gross <= ₹21,000
    const netSalary = round2(Math.max(0, grossSalary - pf - esi));

    const fields = {
      presentDays: Math.round(presentDays),
      absentDays,
      lopDays,
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
      status: 'FINALIZED',
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
