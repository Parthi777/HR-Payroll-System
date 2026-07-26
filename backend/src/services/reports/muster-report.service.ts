import type { PrismaClient } from '@prisma/client';
import { effectiveStatus } from '../attendance/attendance-policy.js';
import { monthHolidaySet } from '../payroll/payroll-run.service.js';
import {
  COMPANY_TZ,
  dayKey,
  endOfDay,
  formatDuration,
  minutesSinceMidnight,
  parseHHMM,
  startOfDay,
} from '../../utils/time.js';

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

/**
 * Day status codes (kept short so they fit a 31-column grid):
 *   P   present            HD  half day          A   absent
 *   WO  weekly off         WO* weekly off worked (Sunday duty = OT day)
 *   HL  holiday            HL* holiday worked
 *   LV  paid leave         LOP loss of pay       PN  awaiting approval
 *   ''  future date (not yet happened)
 */
export type MusterCode = 'P' | 'HD' | 'A' | 'WO' | 'WO*' | 'HL' | 'HL*' | 'LV' | 'LOP' | 'PN' | '';

export interface MusterDay {
  day: number;
  weekday: string; // "Wed"
  isSunday: boolean;
  inTime: string; // "09:22" or "--:--"
  outTime: string;
  work: string; // "10:30"
  break: string; // "00:00" — no break capture yet, kept for layout parity
  ot: string; // "01:45"
  status: MusterCode;
  /** Manual/selfie punch marker so HR can spot unverified entries in the grid. */
  manual: boolean;
}

export interface MusterEmployee {
  employeeCode: string;
  name: string;
  branch: string;
  department: string;
  designation: string;
  shift: string;
  present: number; // fractional — a half day counts 0.5
  weeklyOff: number;
  holidays: number;
  leave: number;
  absent: number; // fractional — includes the unworked half of a half day
  paidDays: number; // present + weekly offs + holidays + paid leave
  sundayDuty: number; // Sundays worked → OT days
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
    const shiftEndMin = parseHHMM(emp.shift?.endTime ?? '18:00');
    const otGrace = emp.shift?.otAfterMinutes ?? 0;

    const days: MusterDay[] = [];
    let present = 0;
    let weeklyOff = 0;
    let holidays = 0;
    let leaveDays = 0;
    let absent = 0;
    let sundayDuty = 0;
    let workMinutes = 0;
    let otTotal = 0;

    for (let dn = 1; dn <= daysInMonth; dn++) {
      const d = new Date(year, month - 1, dn);
      const att = attByEmpDay.get(`${emp.id}|${dayKey(d)}`);
      const pending = att?.approvalStatus === 'PENDING';
      const counted = !!att?.checkIn && (att.approvalStatus == null || att.approvalStatus === 'APPROVED');
      const status = att ? effectiveStatus(att, emp.shift) : null;
      const worked = counted && (status === 'PRESENT' || status === 'LATE' || status === 'HALF_DAY');

      // Per-day OT — duty past the shift close plus its OT grace.
      let otMin = 0;
      if (worked && att!.checkOut) {
        let outMin = minutesSinceMidnight(att!.checkOut);
        if (outMin < shiftEndMin) outMin += 1440; // closed after midnight (night shift)
        otMin = Math.max(0, outMin - (shiftEndMin + otGrace));
      }
      if (worked) {
        workMinutes += att!.workingMinutes ?? 0;
        otTotal += otMin;
      }

      const isSunday = d.getDay() === 0;
      const isHoliday = holidaySet.has(dayKey(d));
      const onLeave = myLeaves.find((l) => l.fromDate <= endOfDay(d) && l.toDate >= startOfDay(d));
      const isFuture = startOfDay(d) > startOfDay(now);

      let code: MusterCode;
      if (isSunday) {
        code = worked ? 'WO*' : 'WO';
        weeklyOff += 1;
        if (worked) sundayDuty += 1;
      } else if (isHoliday) {
        // Holiday duty earns OT hours rather than an extra day (Sunday rule only).
        code = worked ? 'HL*' : 'HL';
        holidays += 1;
      } else if (worked) {
        code = status === 'HALF_DAY' ? 'HD' : 'P';
        if (status === 'HALF_DAY') {
          present += 0.5;
          absent += 0.5; // the unworked half reads as absent
        } else {
          present += 1;
        }
      } else if (pending) {
        code = 'PN';
      } else if (onLeave) {
        code = onLeave.type === 'LOP' ? 'LOP' : 'LV';
        leaveDays += 1;
      } else if (isFuture) {
        code = '';
      } else {
        code = 'A';
        absent += 1;
      }

      days.push({
        day: dn,
        weekday: WEEKDAYS[d.getDay()],
        isSunday,
        inTime: fmtClock(att?.checkIn ?? null),
        outTime: fmtClock(att?.checkOut ?? null),
        work: formatDuration(worked ? att!.workingMinutes : 0),
        break: '00:00',
        ot: formatDuration(otMin),
        status: code,
        manual: !!att && att.punchMode !== 'GEO',
      });
    }

    out.push({
      employeeCode: emp.employeeCode,
      name: emp.name,
      branch: emp.branch?.name ?? '-',
      department: emp.department?.name ?? '-',
      designation: emp.designation?.name ?? '-',
      shift: emp.shift?.name ?? '-',
      present: Math.round(present * 10) / 10,
      weeklyOff,
      holidays,
      leave: leaveDays,
      absent: Math.round(absent * 10) / 10,
      paidDays: Math.round((present + weeklyOff + holidays + leaveDays) * 10) / 10,
      sundayDuty,
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
