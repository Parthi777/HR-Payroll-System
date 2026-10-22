/**
 * The numbers behind the monitoring dashboards.
 *
 *  - `platformOverview` / `platformTenantInsights` — the platform console,
 *    across dealers. Counts and states only: no employee names and no money a
 *    dealer pays its staff. Platform staff onboard and support dealers; they
 *    have no business reading a dealer's people or payroll. These run in the
 *    PLATFORM context, which the Prisma extension passes through unscoped, so
 *    every per-dealer query names its tenantId itself.
 *  - `adminDashboardInsights` — a dealer's own Master Control dashboard, run
 *    inside that dealer's tenant context like every other admin route.
 *
 * Days are bucketed the way attendance rows are stored (local midnight, see
 * `todayRange` in attendance.routes.ts), and clock times are read in company
 * time.
 */
import type { PrismaClient } from '@prisma/client';
import { COMPANY_TZ, dayKey, minutesSinceMidnight } from '../../utils/time.js';
import { isLateArrival, minutesLate } from '../attendance/attendance-policy.js';

const DAY_MS = 86_400_000;

/** Local midnight `daysAgo` days back. */
function dayStart(daysAgo = 0): Date {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  d.setDate(d.getDate() - daysAgo);
  return d;
}

const dayLabel = (d: Date) => d.toLocaleDateString('en-IN', { day: 'numeric', month: 'short', timeZone: COMPANY_TZ });
const weekLabel = (d: Date) => `w/c ${dayLabel(d)}`;
const pct = (part: number, whole: number) => (whole > 0 ? Math.round((part / whole) * 100) : 0);

/** The last `n` days, oldest first, with their keys. */
function lastDays(n: number) {
  return Array.from({ length: n }, (_, i) => {
    const date = dayStart(n - 1 - i);
    return { date, key: dayKey(date), label: dayLabel(date) };
  });
}

/** Monday-started weeks, oldest first. */
function lastWeeks(n: number) {
  const monday = dayStart(0);
  monday.setDate(monday.getDate() - ((monday.getDay() + 6) % 7));
  return Array.from({ length: n }, (_, i) => {
    const start = new Date(monday);
    start.setDate(start.getDate() - (n - 1 - i) * 7);
    return { start, end: new Date(start.getTime() + 7 * DAY_MS), label: weekLabel(start) };
  });
}

function countBy<T>(rows: T[], key: (r: T) => string): Map<string, number> {
  const m = new Map<string, number>();
  for (const r of rows) m.set(key(r), (m.get(key(r)) ?? 0) + 1);
  return m;
}

/** Active staff over time, by the date each was added (deactivations are not dated). */
function staffGrowth(createdAt: Date[], days: number) {
  const window = lastDays(days);
  const before = createdAt.filter((d) => d < window[0].date).length;
  const added = countBy(createdAt.filter((d) => d >= window[0].date), (d) => dayKey(new Date(d.getFullYear(), d.getMonth(), d.getDate())));
  let running = before;
  return window.map((d) => {
    running += added.get(d.key) ?? 0;
    return { label: d.label, staff: running };
  });
}

const PUNCH_MODES = ['GEO', 'KIOSK', 'SELFIE', 'MANUAL'] as const;
const PUNCH_LABEL: Record<string, string> = { GEO: 'App (face + GPS)', KIOSK: 'Kiosk', SELFIE: 'Selfie only', MANUAL: 'Manual' };
const punchMix = (modes: string[]) => {
  const c = countBy(modes, (m) => m);
  return PUNCH_MODES.map((m) => ({ mode: m, label: PUNCH_LABEL[m], count: c.get(m) ?? 0 })).filter((x) => x.count > 0);
};

/* ───────────────────────────── Platform console ───────────────────────────── */

export async function platformOverview(prisma: PrismaClient) {
  const today = dayStart(0);
  const tomorrow = new Date(today.getTime() + DAY_MS);
  const from30 = dayStart(29);
  const weeks = lastWeeks(12);

  const [
    tenants, staffBy, branchesBy, todayBy, att30, lastCheckInBy, subscriptions,
    admins, payslipMonths, kiosks, leavePending, attPending, signups, staffCreated,
  ] = await Promise.all([
    prisma.tenant.findMany({ orderBy: { createdAt: 'asc' }, select: { id: true, slug: true, name: true, status: true, createdAt: true } }),
    prisma.employee.groupBy({ by: ['tenantId'], where: { status: 'ACTIVE' }, _count: { _all: true } }),
    prisma.branch.groupBy({ by: ['tenantId'], _count: { _all: true } }),
    prisma.attendance.groupBy({
      by: ['tenantId'],
      where: { date: { gte: today, lt: tomorrow }, checkIn: { not: null }, employee: { status: 'ACTIVE' } },
      _count: { _all: true },
    }),
    prisma.attendance.groupBy({
      by: ['tenantId', 'date'],
      where: { date: { gte: from30, lt: tomorrow }, checkIn: { not: null } },
      _count: { _all: true },
    }),
    prisma.attendance.groupBy({ by: ['tenantId'], where: { checkIn: { not: null } }, _max: { checkIn: true } }),
    prisma.subscription.findMany({ select: { workspaceId: true, planCode: true, status: true, amountPaise: true, periodEnd: true, paidAt: true } }),
    prisma.adminUser.findMany({ select: { tenantId: true, isActive: true, totpEnabledAt: true, lastSignInAt: true } }),
    prisma.payslip.groupBy({ by: ['tenantId', 'year', 'month'], _count: { _all: true } }),
    prisma.kioskDevice.findMany({ where: { isActive: true }, select: { tenantId: true, pairedAt: true, lastSeenAt: true } }),
    prisma.leave.groupBy({ by: ['tenantId'], where: { status: 'PENDING' }, _count: { _all: true } }),
    prisma.attendance.groupBy({ by: ['tenantId'], where: { approvalStatus: 'PENDING' }, _count: { _all: true } }),
    prisma.signupRequest.findMany({ where: { createdAt: { gte: weeks[0].start } }, select: { status: true, createdAt: true } }),
    prisma.employee.findMany({ where: { status: 'ACTIVE' }, select: { createdAt: true } }),
  ]);

  const byTenant = <T extends { tenantId: string }>(rows: T[]) => new Map(rows.map((r) => [r.tenantId, r]));
  const staff = byTenant(staffBy);
  const branches = byTenant(branchesBy);
  const todayIn = byTenant(todayBy);
  const lastIn = byTenant(lastCheckInBy);
  const leaves = byTenant(leavePending);
  const pendingPunches = byTenant(attPending);
  const subs = new Map(subscriptions.map((s) => [s.workspaceId, s]));

  const days30 = lastDays(30);
  const days14 = days30.slice(-14);
  const daily = new Map<string, number>(); // tenantId|dayKey → check-ins
  const allDaily = new Map<string, number>();
  for (const r of att30) {
    const k = dayKey(r.date);
    daily.set(`${r.tenantId}|${k}`, r._count._all);
    allDaily.set(k, (allDaily.get(k) ?? 0) + r._count._all);
  }

  const lastPayroll = new Map<string, { month: number; year: number; payslips: number }>();
  for (const p of payslipMonths) {
    const cur = lastPayroll.get(p.tenantId);
    if (!cur || p.year * 12 + p.month > cur.year * 12 + cur.month) {
      lastPayroll.set(p.tenantId, { month: p.month, year: p.year, payslips: p._count._all });
    }
  }

  const dealers = tenants.map((t) => {
    const mine = admins.filter((a) => a.tenantId === t.id && a.isActive);
    const kioskRows = kiosks.filter((k) => k.tenantId === t.id && k.pairedAt);
    const lastSignIn = mine.reduce<Date | null>((m, a) => (a.lastSignInAt && (!m || a.lastSignInAt > m) ? a.lastSignInAt : m), null);
    const kioskSeen = kioskRows.reduce<Date | null>((m, k) => (k.lastSeenAt && (!m || k.lastSeenAt > m) ? k.lastSeenAt : m), null);
    const sub = subs.get(t.id);
    const staffCount = staff.get(t.id)?._count._all ?? 0;
    const checkedInToday = todayIn.get(t.id)?._count._all ?? 0;
    return {
      ...t,
      staff: staffCount,
      branches: branches.get(t.id)?._count._all ?? 0,
      checkedInToday,
      attendanceRate: pct(checkedInToday, staffCount),
      lastCheckInAt: lastIn.get(t.id)?._max.checkIn ?? null,
      checkInsLast14: days14.map((d) => daily.get(`${t.id}|${d.key}`) ?? 0),
      subscription: sub
        ? { planCode: sub.planCode, status: sub.status, amountPaise: sub.amountPaise, periodEnd: sub.periodEnd, paidAt: sub.paidAt }
        : null,
      admins: mine.length,
      adminsWithTwoStep: mine.filter((a) => a.totpEnabledAt).length,
      lastAdminSignInAt: lastSignIn,
      lastPayroll: lastPayroll.get(t.id) ?? null,
      kiosks: kioskRows.length,
      kioskLastSeenAt: kioskSeen,
      pendingApprovals: (leaves.get(t.id)?._count._all ?? 0) + (pendingPunches.get(t.id)?._count._all ?? 0),
    };
  });

  const active = dealers.filter((d) => d.status === 'ACTIVE');
  const totalStaff = dealers.reduce((s, d) => s + d.staff, 0);
  const checkedIn = dealers.reduce((s, d) => s + d.checkedInToday, 0);
  const subStatus = countBy(subscriptions, (s) => s.status);
  const plans = countBy(subscriptions, (s) => s.planCode);
  const recurringByPlan = new Map<string, number>();
  for (const s of subscriptions) {
    if (s.status === 'ACTIVE') recurringByPlan.set(s.planCode, (recurringByPlan.get(s.planCode) ?? 0) + s.amountPaise);
  }

  return {
    totals: {
      dealers: dealers.length,
      activeDealers: active.length,
      suspendedDealers: dealers.length - active.length,
      staff: totalStaff,
      checkedInToday: checkedIn,
      attendanceRate: pct(checkedIn, totalStaff),
      pendingSignups: signups.filter((s) => s.status === 'PENDING').length,
      monthlyRecurringPaise: [...recurringByPlan.values()].reduce((a, b) => a + b, 0),
      awaitingPayment: subscriptions.filter((s) => s.status === 'PENDING_PAYMENT' || s.status === 'PAST_DUE').length,
    },
    dealers,
    series: {
      checkIns: days30.map((d) => ({ label: d.label, checkIns: allDaily.get(d.key) ?? 0 })),
      staffGrowth: staffGrowth(staffCreated.map((e) => e.createdAt), 90),
      signupsPerWeek: weeks.map((w) => {
        const inWeek = signups.filter((s) => s.createdAt >= w.start && s.createdAt < w.end);
        return {
          label: w.label,
          pending: inWeek.filter((s) => s.status === 'PENDING').length,
          approved: inWeek.filter((s) => s.status === 'APPROVED').length,
          rejected: inWeek.filter((s) => s.status === 'REJECTED').length,
        };
      }),
      subscriptionsByStatus: [...subStatus].map(([status, count]) => ({ status, count })),
      dealersByPlan: [...plans].map(([plan, count]) => ({ plan, count })),
      recurringByPlan: [...recurringByPlan].map(([plan, paise]) => ({ plan, rupees: Math.round(paise / 100) })),
    },
  };
}

export async function platformTenantInsights(prisma: PrismaClient, tenantId: string) {
  const today = dayStart(0);
  const tomorrow = new Date(today.getTime() + DAY_MS);
  const from30 = dayStart(29);
  const weeks = lastWeeks(12);

  const [att30, branches, employees, leaves, claims, payslips, admins, kiosks, subscription, pendingLeave, pendingPunches] =
    await Promise.all([
      prisma.attendance.findMany({
        where: { tenantId, date: { gte: from30, lt: tomorrow }, checkIn: { not: null } },
        select: {
          date: true, checkIn: true, punchMode: true, employeeId: true,
          employee: { select: { shift: { select: { startTime: true, endTime: true, gracePeriod: true } } } },
        },
      }),
      prisma.branch.findMany({ where: { tenantId }, select: { id: true, name: true } }),
      prisma.employee.findMany({ where: { tenantId, status: 'ACTIVE' }, select: { id: true, branchId: true, createdAt: true } }),
      prisma.leave.findMany({ where: { tenantId, createdAt: { gte: weeks[0].start } }, select: { status: true, createdAt: true } }),
      prisma.claim.groupBy({ by: ['status'], where: { tenantId }, _count: { _all: true } }),
      prisma.payslip.groupBy({ by: ['year', 'month'], where: { tenantId }, _count: { _all: true }, orderBy: [{ year: 'desc' }, { month: 'desc' }], take: 12 }),
      prisma.adminUser.findMany({
        where: { tenantId },
        select: { id: true, name: true, role: true, isActive: true, totpEnabledAt: true, lastSignInAt: true },
        orderBy: { createdAt: 'asc' },
      }),
      prisma.kioskDevice.findMany({
        where: { tenantId },
        select: { id: true, name: true, isActive: true, pairedAt: true, lastSeenAt: true, branch: { select: { name: true } } },
        orderBy: { createdAt: 'asc' },
      }),
      prisma.subscription.findUnique({
        where: { workspaceId: tenantId },
        select: { planCode: true, status: true, amountPaise: true, periodEnd: true, paidAt: true },
      }),
      prisma.leave.count({ where: { tenantId, status: 'PENDING' } }),
      prisma.attendance.count({ where: { tenantId, approvalStatus: 'PENDING' } }),
    ]);

  const days30 = lastDays(30);
  const activeIds = new Set(employees.map((e) => e.id));
  const perDay = new Map<string, { checkIns: number; late: number }>();
  for (const a of att30) {
    const k = dayKey(a.date);
    const cur = perDay.get(k) ?? { checkIns: 0, late: 0 };
    cur.checkIns += 1;
    if (a.checkIn && isLateArrival(a.checkIn, a.employee.shift)) cur.late += 1;
    perDay.set(k, cur);
  }
  const todayKey = dayKey(today);
  const presentToday = new Set(att30.filter((a) => dayKey(a.date) === todayKey && activeIds.has(a.employeeId)).map((a) => a.employeeId));

  return {
    today: {
      staff: employees.length,
      checkedIn: presentToday.size,
      attendanceRate: pct(presentToday.size, employees.length),
      pendingApprovals: pendingLeave + pendingPunches,
      branches: branches.length,
    },
    checkIns: days30.map((d) => ({ label: d.label, ...(perDay.get(d.key) ?? { checkIns: 0, late: 0 }) })),
    punchModes: punchMix(att30.map((a) => a.punchMode)),
    branchesToday: branches.map((b) => {
      const ids = employees.filter((e) => e.branchId === b.id).map((e) => e.id);
      return { branch: b.name, total: ids.length, present: ids.filter((id) => presentToday.has(id)).length };
    }),
    staffGrowth: staffGrowth(employees.map((e) => e.createdAt), 90),
    leavePerWeek: weeks.map((w) => {
      const inWeek = leaves.filter((l) => l.createdAt >= w.start && l.createdAt < w.end);
      return {
        label: w.label,
        approved: inWeek.filter((l) => l.status === 'APPROVED').length,
        pending: inWeek.filter((l) => l.status === 'PENDING').length,
        rejected: inWeek.filter((l) => l.status === 'REJECTED').length,
      };
    }),
    claimsByStatus: claims.map((c) => ({ status: c.status, count: c._count._all })),
    payrollRuns: payslips.map((p) => ({ month: p.month, year: p.year, payslips: p._count._all })).reverse(),
    admins,
    kiosks: kiosks.map((k) => ({ id: k.id, name: k.name, branch: k.branch.name, isActive: k.isActive, pairedAt: k.pairedAt, lastSeenAt: k.lastSeenAt })),
    subscription,
  };
}

/* ───────────────────────────── Master Control ───────────────────────────── */

export async function adminDashboardInsights(
  prisma: PrismaClient,
  opts: { days: 7 | 30; branchId?: string; includePayroll: boolean },
) {
  const today = dayStart(0);
  const tomorrow = new Date(today.getTime() + DAY_MS);
  const rangeStart = dayStart(opts.days - 1);
  const monthStart = new Date(today.getFullYear(), today.getMonth(), 1);
  const from = rangeStart < monthStart ? rangeStart : monthStart;
  const in7 = new Date(today.getTime() + 8 * DAY_MS);

  const employees = await prisma.employee.findMany({
    where: { status: 'ACTIVE', ...(opts.branchId ? { branchId: opts.branchId } : {}) },
    select: {
      id: true, name: true, employeeCode: true,
      branch: { select: { name: true } },
      department: { select: { name: true } },
      shift: { select: { startTime: true, endTime: true, gracePeriod: true } },
    },
  });
  const byId = new Map(employees.map((e) => [e.id, e]));
  const ids = employees.map((e) => e.id);

  const [atts, monthLeaves, upcoming, pendingLeave, pendingPunches, claimsAwaiting, claimsToPay, payrollRows] = await Promise.all([
    prisma.attendance.findMany({
      where: { employeeId: { in: ids }, date: { gte: from, lt: tomorrow }, checkIn: { not: null } },
      select: { employeeId: true, date: true, checkIn: true, punchMode: true },
    }),
    prisma.leave.findMany({
      where: { employeeId: { in: ids }, status: 'APPROVED', fromDate: { lt: tomorrow }, toDate: { gte: monthStart } },
      select: { type: true, days: true },
    }),
    prisma.leave.findMany({
      where: { employeeId: { in: ids }, status: 'APPROVED', fromDate: { lt: in7 }, toDate: { gte: today } },
      select: { employeeId: true, type: true, fromDate: true, toDate: true, days: true },
      orderBy: { fromDate: 'asc' },
      take: 8,
    }),
    prisma.leave.count({ where: { employeeId: { in: ids }, status: 'PENDING' } }),
    prisma.attendance.count({ where: { employeeId: { in: ids }, approvalStatus: 'PENDING' } }),
    prisma.claim.count({ where: { employeeId: { in: ids }, status: { in: ['PENDING', 'NEEDS_CLARIFICATION'] } } }),
    prisma.claim.count({ where: { employeeId: { in: ids }, status: 'APPROVED' } }),
    opts.includePayroll
      ? prisma.payslip.findFirst({ where: { employeeId: { in: ids } }, orderBy: [{ year: 'desc' }, { month: 'desc' }], select: { month: true, year: true } })
      : Promise.resolve(null),
  ]);

  // Attendance rate and late arrivals per day of the range.
  const days = lastDays(opts.days);
  const perDay = new Map<string, { present: number; late: number }>();
  for (const a of atts) {
    if (a.date < rangeStart) continue;
    const k = dayKey(a.date);
    const cur = perDay.get(k) ?? { present: 0, late: 0 };
    cur.present += 1;
    const shift = byId.get(a.employeeId)?.shift;
    if (shift && a.checkIn && isLateArrival(a.checkIn, shift)) cur.late += 1;
    perDay.set(k, cur);
  }
  const attendanceRate = days.map((d) => {
    const v = perDay.get(d.key) ?? { present: 0, late: 0 };
    return { label: d.label, rate: pct(v.present, employees.length), present: v.present, late: v.late };
  });

  // When people arrive: half-hour buckets over the range, in company time.
  const BUCKETS = ['<8:00', '8:00', '8:30', '9:00', '9:30', '10:00', '10:30', '11:00', '11:30+'];
  const buckets = new Array(BUCKETS.length).fill(0);
  for (const a of atts) {
    if (a.date < rangeStart || !a.checkIn) continue;
    const m = minutesSinceMidnight(a.checkIn);
    const i = m < 480 ? 0 : m >= 690 ? BUCKETS.length - 1 : 1 + Math.floor((m - 480) / 30);
    buckets[i] += 1;
  }

  // Today, by department and branch.
  const todayKey = dayKey(today);
  const presentToday = new Set(atts.filter((a) => dayKey(a.date) === todayKey).map((a) => a.employeeId));
  const group = (name: (e: (typeof employees)[number]) => string) => {
    const m = new Map<string, { name: string; present: number; total: number }>();
    for (const e of employees) {
      const k = name(e);
      const cur = m.get(k) ?? { name: k, present: 0, total: 0 };
      cur.total += 1;
      if (presentToday.has(e.id)) cur.present += 1;
      m.set(k, cur);
    }
    return [...m.values()].sort((a, b) => b.total - a.total);
  };

  // Who arrives late most this month.
  const lateByEmp = new Map<string, { count: number; minutes: number }>();
  for (const a of atts) {
    if (a.date < monthStart || !a.checkIn) continue;
    const shift = byId.get(a.employeeId)?.shift;
    const late = shift ? minutesLate(a.checkIn, shift) : null;
    if (late === null) continue;
    const cur = lateByEmp.get(a.employeeId) ?? { count: 0, minutes: 0 };
    cur.count += 1;
    cur.minutes += late;
    lateByEmp.set(a.employeeId, cur);
  }
  const topLate = [...lateByEmp]
    .sort((a, b) => b[1].count - a[1].count || b[1].minutes - a[1].minutes)
    .slice(0, 5)
    .map(([id, v]) => ({
      employeeId: id,
      name: byId.get(id)?.name ?? '',
      employeeCode: byId.get(id)?.employeeCode ?? '',
      branch: byId.get(id)?.branch.name ?? '',
      lateDays: v.count,
      avgMinutesLate: Math.round(v.minutes / v.count),
    }));

  const leaveDays = new Map<string, number>();
  for (const l of monthLeaves) leaveDays.set(l.type, (leaveDays.get(l.type) ?? 0) + l.days);

  let payroll: { month: number; year: number; payslips: number; gross: number; net: number } | null = null;
  if (payrollRows) {
    const agg = await prisma.payslip.aggregate({
      where: { employeeId: { in: ids }, month: payrollRows.month, year: payrollRows.year },
      _sum: { grossSalary: true, netSalary: true },
      _count: { _all: true },
    });
    payroll = {
      month: payrollRows.month,
      year: payrollRows.year,
      payslips: agg._count._all,
      gross: Math.round(agg._sum.grossSalary ?? 0),
      net: Math.round(agg._sum.netSalary ?? 0),
    };
  }

  return {
    days: opts.days,
    staff: employees.length,
    attendanceRate,
    arrivals: BUCKETS.map((label, i) => ({ label, count: buckets[i] })),
    punchModes: punchMix(atts.filter((a) => a.date >= rangeStart).map((a) => a.punchMode)),
    departments: group((e) => e.department.name),
    branches: group((e) => e.branch.name),
    leaveByType: [...leaveDays].map(([type, days]) => ({ type, days })),
    pending: {
      leave: pendingLeave,
      attendance: pendingPunches,
      claimsToApprove: claimsAwaiting,
      claimsToPay: claimsToPay,
    },
    topLate,
    upcomingLeave: upcoming.map((l) => ({
      name: byId.get(l.employeeId)?.name ?? '',
      type: l.type,
      fromDate: l.fromDate,
      toDate: l.toDate,
      days: l.days,
    })),
    payroll,
  };
}
