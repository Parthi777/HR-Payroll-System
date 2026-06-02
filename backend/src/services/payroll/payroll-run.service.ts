import type { PrismaClient } from '@prisma/client';
import { calculatePF, calculateESI } from './payroll.service.js';

/** Working days in a month = calendar days minus Sundays (holidays TODO). */
function workingDaysInMonth(year: number, month: number): number {
  const days = new Date(year, month, 0).getDate();
  let count = 0;
  for (let d = 1; d <= days; d++) {
    if (new Date(year, month - 1, d).getDay() !== 0) count++;
  }
  return count;
}

/** Number of days a leave [from,to] overlaps the month window [start,end). */
function overlapDays(from: Date, to: Date, start: Date, end: Date): number {
  const a = from > start ? from : start;
  const b = to < new Date(end.getTime() - 1) ? to : new Date(end.getTime() - 1);
  if (a > b) return 0;
  return Math.floor((b.getTime() - a.getTime()) / 86_400_000) + 1;
}

export interface PayrollRunSummary {
  month: number;
  year: number;
  employees: number;
  totalNet: number;
}

/**
 * Generate (upsert) a payslip for every active employee for the given month:
 * present days from attendance, paid leave vs LOP, statutory deductions
 * (see CLAUDE.md "Payroll Calculation Engine"). Synchronous for now — TODO: BullMQ.
 */
export async function runMonthlyPayroll(
  prisma: PrismaClient,
  month: number,
  year: number,
): Promise<PayrollRunSummary> {
  const employees = await prisma.employee.findMany({ where: { status: 'ACTIVE' } });
  const start = new Date(year, month - 1, 1);
  const end = new Date(year, month, 1);
  const workingDays = workingDaysInMonth(year, month);

  let totalNet = 0;

  for (const emp of employees) {
    const atts = await prisma.attendance.findMany({
      where: { employeeId: emp.id, date: { gte: start, lt: end } },
    });
    const presentDays = atts.filter((a) => a.status === 'PRESENT' || a.status === 'LATE').length;
    const halfDays = atts.filter((a) => a.status === 'HALF_DAY').length;
    const effectivePresent = presentDays + halfDays * 0.5;

    const leaves = await prisma.leave.findMany({
      where: { employeeId: emp.id, status: 'APPROVED' },
    });
    let paidLeaveDays = 0;
    let lopDays = 0;
    for (const lv of leaves) {
      const d = overlapDays(lv.fromDate, lv.toDate, start, end);
      if (lv.type === 'LOP') lopDays += d;
      else paidLeaveDays += d;
    }

    // Split monthly salary into a standard structure, then pro-rate every earning
    // component by the present/working-day ratio so deductions track actual earnings.
    const structure = {
      basic: emp.salary * 0.5,
      hra: emp.salary * 0.2,
      da: emp.salary * 0.15,
      otherAllowances: emp.salary * 0.15,
    };
    const ratio = workingDays > 0 ? (effectivePresent + paidLeaveDays) / workingDays : 0;

    const earnedBasic = round2(structure.basic * ratio);
    const earnedHra = round2(structure.hra * ratio);
    const earnedDa = round2(structure.da * ratio);
    const earnedOther = round2(structure.otherAllowances * ratio);
    const grossSalary = round2(earnedBasic + earnedHra + earnedDa + earnedOther);

    const pf = calculatePF(earnedBasic); // 12% of earned basic, capped ₹1800
    const esi = calculateESI(grossSalary); // 0.75% if gross <= ₹21,000
    const netSalary = round2(Math.max(0, grossSalary - pf - esi));
    const absentDays = Math.max(0, Math.round(workingDays - effectivePresent - paidLeaveDays - lopDays));

    const fields = {
      presentDays: Math.round(effectivePresent),
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

const round2 = (n: number) => Math.round(n * 100) / 100;
