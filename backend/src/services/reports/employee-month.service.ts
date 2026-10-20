/**
 * One employee's month, complete: every day, the month's totals, their leave,
 * the vouchers they raised and — for those allowed to see pay — the salary.
 *
 * Attendance comes from the muster builder, so every count here is the
 * classifier's and matches the muster grid, the payroll report and the payslip
 * cell for cell. Salary is the payroll engine's own figure for the month,
 * computed live, never a second calculation.
 */
import type { PrismaClient } from '@prisma/client';
import type { DayCode } from '../attendance/day-classify.js';
import { buildMusterReport, type MusterEmployee } from './muster-report.service.js';
import { computeMonthlyPayroll, monthHolidaySet } from '../payroll/payroll-run.service.js';
import { getTenantPolicy } from '../settings/tenant-settings.service.js';
import { claimTypeLabel } from '../claim/claim-types.js';
import { AppError } from '../../utils/AppError.js';

/** Day code → the status word the employee calendar (app + web) already speaks. */
export const DAILY_STATUS: Record<DayCode, string> = {
  P: 'PRESENT',
  HD: 'HALF_DAY',
  A: 'ABSENT',
  WO: 'WEEKLY_OFF',
  'WO*': 'WEEKLY_OFF_WORKED',
  HL: 'HOLIDAY',
  'HL*': 'HOLIDAY_WORKED',
  LV: 'ON_LEAVE',
  LOP: 'LOP',
  PN: 'PENDING',
  '': 'NOT_JOINED',
};

const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const round1 = (n: number) => Math.round(n * 10) / 10;

/** A muster row as day rows + month totals — the shape the employee report and the app both read. */
export function attendanceFromMuster(me: MusterEmployee) {
  const days = me.days.map((d) => ({
    day: d.day,
    weekday: WEEKDAYS.indexOf(d.weekday),
    status: d.late && d.status === 'P' ? 'LATE' : DAILY_STATUS[d.status],
    checkIn: d.inTime === '--:--' ? null : d.inTime,
    checkOut: d.outTime === '--:--' ? null : d.outTime,
    workedHours: d.workMinutes ? round1(d.workMinutes / 60) : null,
    punchMode: d.punchMode,
    attendanceId: d.attendanceId,
  }));
  const summary = {
    present: me.present,
    offDuty: me.sundayDuty + me.holidayDuty,
    late: me.lateDays,
    half: me.days.filter((d) => d.status === 'HD').length,
    absent: me.absent,
    pending: me.pending,
    leave: me.leave,
    lop: me.lop,
    off: me.weeklyOff + me.holidays,
    served: me.servedDays,
    worked: me.workMinutes,
    workedHours: round1(me.workMinutes / 60),
  };
  return { days, summary };
}

/** Months a dropdown may offer: from joining (or the workspace's first month) to now, newest first. */
export function monthsSince(from: Date, now = new Date()): { month: number; year: number }[] {
  const out: { month: number; year: number }[] = [];
  let y = now.getFullYear();
  let m = now.getMonth() + 1;
  const stopY = from.getFullYear();
  const stopM = from.getMonth() + 1;
  while (y > stopY || (y === stopY && m >= stopM)) {
    out.push({ month: m, year: y });
    if (--m === 0) { m = 12; y--; }
    if (out.length > 240) break; // twenty years: a guard, not a limit anyone reaches
  }
  return out;
}

export async function employeeMonthDetail(
  prisma: PrismaClient,
  employeeId: string,
  month: number,
  year: number,
  opts: { includeSalary: boolean },
) {
  const employee = await prisma.employee.findUnique({
    where: { id: employeeId },
    include: {
      branch: { select: { name: true } },
      department: { select: { name: true } },
      designation: { select: { name: true } },
      shift: true,
    },
  });
  if (!employee) throw AppError.notFound('Employee');
  if (employee.status !== 'ACTIVE') throw new AppError('Reports cover active employees only', 400);

  const start = new Date(year, month - 1, 1);
  const end = new Date(year, month, 1);

  const muster = await buildMusterReport(prisma, month, year, { employeeId });
  const me = muster.employees[0];
  if (!me) throw AppError.notFound('Employee');
  const attendance = attendanceFromMuster(me);

  const [leaves, claims, tenant] = await Promise.all([
    prisma.leave.findMany({
      where: { employeeId, fromDate: { lt: end }, toDate: { gte: start } },
      orderBy: { fromDate: 'asc' },
    }),
    prisma.claim.findMany({
      where: { employeeId, createdAt: { gte: start, lt: end } },
      orderBy: { createdAt: 'desc' },
    }),
    prisma.tenant.findUnique({ where: { id: employee.tenantId }, select: { createdAt: true } }),
  ]);

  let salary = null;
  if (opts.includeSalary) {
    const holidaySet = await monthHolidaySet(prisma, month, year);
    const { payroll: policy, attendance: att } = await getTenantPolicy(prisma);
    const r = await computeMonthlyPayroll(prisma, employee, month, year, holidaySet, policy, {
      start: att.halfDayWindowStart,
      end: att.halfDayWindowEnd,
    });
    salary = {
      monthlySalary: employee.salary,
      payrollBasis: r.payrollBasis,
      perDaySalary: r.perDaySalary,
      servedDays: r.servedDays,
      paidDays: r.paidDays,
      basePay: r.basePay,
      otHours: r.otHours,
      otPay: r.otPay,
      sundayDays: r.sundayDays,
      sundayPay: r.sundayPay,
      leaveDeduction: r.leaveDeduction,
      grossSalary: r.grossSalary,
      pf: r.pf,
      esi: r.esi,
      netSalary: r.netSalary,
    };
  }

  const vouchers = claims.map((c) => ({
    id: c.id,
    claimNo: c.claimNo,
    title: c.title,
    type: c.type,
    typeLabel: claimTypeLabel(c.type),
    amount: c.amount,
    status: c.status,
    createdAt: c.createdAt,
  }));

  // The dropdown runs from joining — or from when this workspace began, if the
  // joining date predates it (an employee imported with their original date).
  const firstMonth = tenant && tenant.createdAt > employee.joiningDate ? tenant.createdAt : employee.joiningDate;

  return {
    month,
    year,
    employee: {
      id: employee.id,
      name: employee.name,
      employeeCode: employee.employeeCode,
      phone: employee.phone,
      branch: employee.branch.name,
      department: employee.department?.name ?? null,
      designation: employee.designation?.name ?? null,
      shift: { name: employee.shift.name, startTime: employee.shift.startTime, endTime: employee.shift.endTime },
      joiningDate: employee.joiningDate,
    },
    attendance,
    leaves: leaves.map((l) => ({
      id: l.id,
      type: l.type,
      fromDate: l.fromDate,
      toDate: l.toDate,
      days: l.days,
      reason: l.reason,
      status: l.status,
    })),
    vouchers,
    voucherTotals: {
      count: vouchers.length,
      amount: vouchers.reduce((s, v) => s + v.amount, 0),
      paid: vouchers.filter((v) => v.status === 'PAID').reduce((s, v) => s + v.amount, 0),
    },
    salary,
    months: monthsSince(firstMonth),
  };
}
