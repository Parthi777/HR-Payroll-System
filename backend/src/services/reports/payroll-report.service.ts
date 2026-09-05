import type { PrismaClient } from '@prisma/client';
import { loadPayrollMonth, computeMonthlyPayroll, monthHolidaySet } from '../payroll/payroll-run.service.js';
import { getCompanyProfile, getTenantPolicy } from '../settings/tenant-settings.service.js';

/**
 * Monthly payroll report — one row per ACTIVE employee with the figures the
 * owner reviews before releasing salary.
 *
 * Computed live from attendance via the same engine that writes payslips, so
 * the report never disagrees with a payslip and works before payroll is run.
 * Inactive employees are excluded everywhere by design.
 */

const MONTHS = ['', 'January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

export interface PayrollReportRow {
  employeeCode: string;
  name: string;
  branch: string;
  designation: string;
  department: string;
  daysInMonth: number;
  servedDays: number; // days of the month the employee was on the rolls (and elapsed)
  presentDays: number;
  halfDays: number;
  absentDays: number; // includes the unworked half of each half day and pending punches
  pendingDays: number; // the awaiting-approval subset of absentDays
  clDays: number;
  leaveDeduction: number;
  otHours: number;
  sundayDays: number;
  salary: number; // monthly CTC
  perDaySalary: number;
  otSalary: number; // OT pay + Sunday-duty pay
  payable: number; // net salary
  lateDays: number;
  withheld: boolean;
}

export interface PayrollReport {
  month: number;
  year: number;
  label: string; // "July 2026"
  company: { name: string; address: string };
  rows: PayrollReportRow[];
  totals: {
    employees: number;
    absentDays: number;
    otHours: number;
    salary: number;
    otSalary: number;
    leaveDeduction: number;
    payable: number;
  };
}

const round2 = (n: number) => Math.round(n * 100) / 100;

export async function buildPayrollReport(
  prisma: PrismaClient,
  month: number,
  year: number,
  filter: { branchId?: string; departmentId?: string; designationId?: string } = {},
): Promise<PayrollReport> {
  const employees = await prisma.employee.findMany({
    where: {
      status: 'ACTIVE',
      ...(filter.branchId ? { branchId: filter.branchId } : {}),
      ...(filter.departmentId ? { departmentId: filter.departmentId } : {}),
      ...(filter.designationId ? { designationId: filter.designationId } : {}),
    },
    include: {
      branch: { select: { name: true } },
      department: { select: { name: true } },
      designation: { select: { name: true } },
      shift: true,
    },
    orderBy: { employeeCode: 'asc' },
  });

  const holidaySet = await monthHolidaySet(prisma, month, year);
  const settings = await getCompanyProfile(prisma);
  const { payroll: policy, attendance } = await getTenantPolicy(prisma);
  const halfDayWindow = { start: attendance.halfDayWindowStart, end: attendance.halfDayWindowEnd };

  // Same batching as the payroll run: three queries, not three per employee.
  const preloaded = await loadPayrollMonth(prisma, employees.map((e) => e.id), month, year);

  const rows: PayrollReportRow[] = [];
  for (const emp of employees) {
    const r = await computeMonthlyPayroll(prisma, emp, month, year, holidaySet, policy, halfDayWindow, preloaded.get(emp.id));
    rows.push({
      employeeCode: emp.employeeCode,
      name: emp.name,
      branch: emp.branch?.name ?? '-',
      designation: emp.designation?.name ?? '-',
      department: emp.department?.name ?? '-',
      daysInMonth: r.daysInMonth,
      servedDays: r.servedDays,
      presentDays: r.presentDays,
      halfDays: r.halfDays,
      absentDays: r.absentDays,
      pendingDays: r.pendingDays,
      clDays: r.clDays,
      leaveDeduction: r.leaveDeduction,
      otHours: r.otHours,
      sundayDays: r.sundayDays,
      salary: emp.salary,
      perDaySalary: r.perDaySalary,
      otSalary: round2(r.otPay + r.sundayPay),
      payable: r.netSalary,
      lateDays: r.lateDays,
      withheld: r.withheld,
    });
  }

  const sum = (f: (r: PayrollReportRow) => number) => round2(rows.reduce((s, r) => s + f(r), 0));

  return {
    month,
    year,
    label: `${MONTHS[month]} ${year}`,
    company: {
      name: settings?.name || process.env.COMPANY_NAME || 'AI HR Payroll',
      address: settings?.address ?? '',
    },
    rows,
    totals: {
      employees: rows.length,
      absentDays: sum((r) => r.absentDays),
      otHours: sum((r) => r.otHours),
      salary: sum((r) => r.salary),
      otSalary: sum((r) => r.otSalary),
      leaveDeduction: sum((r) => r.leaveDeduction),
      payable: sum((r) => r.payable),
    },
  };
}
