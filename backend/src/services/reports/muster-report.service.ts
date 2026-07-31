import type { PrismaClient } from '@prisma/client';
import { classifyDay, overtimeMinutes, type DayCode } from '../attendance/day-classify.js';
import { monthHolidaySet } from '../payroll/payroll-run.service.js';
import { COMPANY_TZ, dayKey, formatDuration } from '../../utils/time.js';

/**
 * Monthly performance (muster roll) — the day-by-day grid the owner's previous
 * biometric system produced: one block per employee, a column per calendar day,
 * with IN / OUT / WORK / BREAK / OT rows and a status letter underneath.
 *
 * Only ACTIVE employees appear.
 */

const MONTHS = ['', 'January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const NO_TIME = '--:--';

/** The grid's day codes come straight from the shared day classifier. */
export type MusterCode = DayCode;

export interface MusterDay {
  day: number;
  weekday: string; // "Wed"
  isSunday: boolean;
  inTime: string; // "09:22" or "--:--"
  outTime: string;
  work: string; // "10:30"
  break: string; // "00:00" — no break capture yet, kept for layout parity
  ot: string; // "01:45"
  workMinutes: number;
  otMinutes: number;
  status: MusterCode;
  /** Arrived past the shift's grace period (a half day can be late too). */
  late: boolean;
  /** Manual/selfie punch marker so HR can spot unverified entries in the grid. */
  manual: boolean;
  punchMode: string | null; // "GEO" | "MANUAL" | "SELFIE"
}

export interface MusterEmployee {
  id: string;
  employeeCode: string;
  name: string;
  branch: string;
  department: string;
  designation: string;
  shift: string;
  present: number; // working days actually worked — a half day counts 0.5
  weeklyOff: number; // Sundays served so far this month (paid)
  holidays: number; // configured holidays served so far (paid)
  leave: number; // approved PAID leave days
  lop: number; // approved loss-of-pay leave days (unpaid)
  absent: number; // fractional — includes the unworked half of a half day and PN days
  pending: number; // the PN subset of `absent` — unpaid only until approved
  paidDays: number; // present + weekly offs + holidays + paid leave
  sundayDuty: number; // Sundays worked → one extra day's pay each
  holidayDuty: number; // holidays worked
  lateDays: number;
  /**
   * Days inside the employee's service that have already happened. The row
   * reconciles: present + absent + weeklyOff + holidays + leave + lop = served.
   */
  servedDays: number;
  workMinutes: number;
  otMinutes: number;
  totalWorkPlusOt: string; // "127:28"
  totalOt: string; // "6:04"
  days: MusterDay[];
}

export interface MusterReport {
  month: number;
  year: number;
  label: string; // "July-2026"
  daysInMonth: number;
  company: { name: string; address: string };
  employees: MusterEmployee[];
}

const round1 = (n: number) => Math.round(n * 10) / 10;

const fmtClock = (d: Date | null) =>
  d
    ? d.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', hour12: false, timeZone: COMPANY_TZ })
    : NO_TIME;

export async function buildMusterReport(
  prisma: PrismaClient,
  month: number,
  year: number,
  filter: { branchId?: string; employeeId?: string } = {},
): Promise<MusterReport> {
  const start = new Date(year, month - 1, 1);
  const end = new Date(year, month, 1);
  const daysInMonth = new Date(year, month, 0).getDate();
  const now = new Date();

  const employees = await prisma.employee.findMany({
    where: {
      status: 'ACTIVE',
      ...(filter.branchId ? { branchId: filter.branchId } : {}),
      ...(filter.employeeId ? { id: filter.employeeId } : {}),
    },
    include: {
      branch: { select: { name: true } },
      department: { select: { name: true } },
      designation: { select: { name: true } },
      shift: true,
    },
    orderBy: [{ department: { name: 'asc' } }, { employeeCode: 'asc' }],
  });
  const empIds = employees.map((e) => e.id);

  const [atts, leaves, holidaySet, settings] = await Promise.all([
    prisma.attendance.findMany({ where: { employeeId: { in: empIds }, date: { gte: start, lt: end } } }),
    prisma.leave.findMany({
      where: { employeeId: { in: empIds }, status: 'APPROVED', fromDate: { lt: end }, toDate: { gte: start } },
    }),
    monthHolidaySet(prisma, month, year),
    prisma.companySettings.findUnique({ where: { id: 'company' } }),
  ]);

  const attByEmpDay = new Map<string, (typeof atts)[number]>();
  for (const a of atts) attByEmpDay.set(`${a.employeeId}|${dayKey(a.date)}`, a);

  const out: MusterEmployee[] = [];

  for (const emp of employees) {
    const myLeaves = leaves.filter((l) => l.employeeId === emp.id);

    const days: MusterDay[] = [];
    let present = 0;
    let weeklyOff = 0;
    let holidays = 0;
    let leaveDays = 0;
    let lop = 0;
    let absent = 0;
    let pending = 0;
    let sundayDuty = 0;
    let holidayDuty = 0;
    let lateDays = 0;
    let servedDays = 0;
    let workMinutes = 0;
    let otTotal = 0;

    for (let dn = 1; dn <= daysInMonth; dn++) {
      const d = new Date(year, month - 1, dn);
      const att = attByEmpDay.get(`${emp.id}|${dayKey(d)}`);
      const day = classifyDay({
        date: d,
        att,
        shift: emp.shift,
        leaves: myLeaves,
        holidays: holidaySet,
        joiningDate: emp.joiningDate,
        now,
      });

      // Per-day OT — duty past the shift close plus its OT grace.
      const otMin = day.worked ? overtimeMinutes(att!.checkOut, emp.shift) : 0;
      if (day.worked) {
        workMinutes += att!.workingMinutes ?? 0;
        otTotal += otMin;
      }

      // Totals cover the employee's served days only: nothing is counted before
      // they joined or for dates that haven't happened yet.
      if (day.counts) {
        servedDays += 1;
        if (day.late) lateDays += 1;
        switch (day.code) {
          case 'WO':
          case 'WO*':
            weeklyOff += 1;
            if (day.worked) sundayDuty += 1; // Sunday duty pays one extra full day
            break;
          case 'HL':
          case 'HL*':
            holidays += 1;
            if (day.worked) holidayDuty += 1;
            break;
          case 'P':
            present += 1;
            break;
          case 'HD':
            present += 0.5;
            absent += 0.5; // the unworked half reads as absent
            break;
          case 'PN':
            absent += 1; // held for sign-off — unpaid, so it sits under Absent
            pending += 1;
            break;
          case 'LV':
            leaveDays += 1;
            break;
          case 'LOP':
            lop += 1;
            break;
          default:
            absent += 1;
        }
      }

      days.push({
        day: dn,
        weekday: WEEKDAYS[d.getDay()],
        isSunday: day.isSunday,
        inTime: fmtClock(att?.checkIn ?? null),
        outTime: fmtClock(att?.checkOut ?? null),
        work: formatDuration(day.worked ? att!.workingMinutes : 0),
        break: '00:00',
        ot: formatDuration(otMin),
        workMinutes: day.worked ? att!.workingMinutes ?? 0 : 0,
        otMinutes: otMin,
        status: day.code,
        late: day.late,
        manual: !!att && att.punchMode !== 'GEO',
        punchMode: att?.punchMode ?? null,
      });
    }

    out.push({
      id: emp.id,
      employeeCode: emp.employeeCode,
      name: emp.name,
      branch: emp.branch?.name ?? '-',
      department: emp.department?.name ?? '-',
      designation: emp.designation?.name ?? '-',
      shift: emp.shift?.name ?? '-',
      present: round1(present),
      weeklyOff,
      holidays,
      leave: leaveDays,
      lop,
      absent: round1(absent),
      pending,
      // LOP is unpaid, so it never joins the paid-day count.
      paidDays: round1(present + weeklyOff + holidays + leaveDays),
      sundayDuty,
      holidayDuty,
      lateDays,
      servedDays,
      workMinutes,
      otMinutes: otTotal,
      totalWorkPlusOt: formatDuration(workMinutes),
      totalOt: formatDuration(otTotal),
      days,
    });
  }

  return {
    month,
    year,
    label: `${MONTHS[month]}-${year}`,
    daysInMonth,
    company: {
      name: settings?.name || process.env.COMPANY_NAME || 'AI HR Payroll',
      address: settings?.address ?? '',
    },
    employees: out,
  };
}
