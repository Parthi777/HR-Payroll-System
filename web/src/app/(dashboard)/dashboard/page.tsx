'use client';

import { useState } from 'react';
import useSWR from 'swr';
import Link from 'next/link';
import dynamic from 'next/dynamic';
import {
  ResponsiveContainer, AreaChart, Area, BarChart, Bar, LineChart, Line, XAxis, YAxis,
  Tooltip, CartesianGrid, Legend,
} from 'recharts';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import {
  UserCheck, UserX, Clock4, CalendarOff, FileClock, ArrowUpRight, Users, Building2,
  ChevronRight, Receipt, Wallet, AlarmClock, Plane,
} from 'lucide-react';
import { useDashboardStats, type DashboardStats } from '@/hooks/useApi';
import { fetcher } from '@/lib/api';
import { CHART, ChartCard, Donut, EmptyChart, axis, tooltipStyle } from '@/components/charts';
import { CountUp } from '@/components/motion';

interface TrendDay { label: string; present: number; late: number; absent: number }
interface BranchStat { branch: string; present: number; total: number }

/** GET /admin/dashboard/insights — see services/dashboard/insights.service.ts. */
interface Insights {
  days: 7 | 30;
  staff: number;
  attendanceRate: { label: string; rate: number; present: number; late: number }[];
  arrivals: { label: string; count: number }[];
  punchModes: { mode: string; label: string; count: number }[];
  departments: { name: string; present: number; total: number }[];
  branches: { name: string; present: number; total: number }[];
  leaveByType: { type: string; days: number }[];
  pending: { leave: number; attendance: number; claimsToApprove: number; claimsToPay: number };
  topLate: { employeeId: string; name: string; employeeCode: string; branch: string; lateDays: number; avgMinutesLate: number }[];
  upcomingLeave: { name: string; type: string; fromDate: string; toDate: string; days: number }[];
  /** Present only for Super Admin and Payroll Admin. */
  payroll: { month: number; year: number; payslips: number; gross: number; net: number } | null;
}

const MONTHS = ['', 'January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const LEAVE_LABEL: Record<string, string> = { CL: 'Casual', SL: 'Sick', EL: 'Earned', LOP: 'Loss of pay', HALF_DAY: 'Half day' };
const shortDate = (iso: string) => new Date(iso).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' });

const BranchMap = dynamic(() => import('@/components/branch-map'), {
  ssr: false,
  loading: () => <div className="flex h-64 items-center justify-center text-muted-foreground">Loading map…</div>,
});

// Zeroed fallback so the dashboard renders instantly, then upgrades to live values.
const fallback: DashboardStats = {
  presentNow: 0, absent: 0, lateArrivals: 0, onLeave: 0, pendingApprovals: 0,
  totalStaff: 0, branches: 0, checkedIn: 0, attendanceRate: 0,
};

interface MapBranch { id: string; name: string; geofenceLat: number; geofenceLng: number; geofenceRadius: number; strictMode: boolean }

export default function DashboardPage() {
  const [days, setDays] = useState<7 | 30>(7);
  const { data, isLive } = useDashboardStats(fallback);
  const { data: bd } = useSWR<{ branches: MapBranch[] }>('/admin/geofence', fetcher, { shouldRetryOnError: false });
  const { data: td } = useSWR<{ trend: TrendDay[]; branches: BranchStat[] }>('/admin/dashboard/trend', fetcher, { shouldRetryOnError: false, refreshInterval: 60_000 });
  const { data: ins, dataUpdatedAt } = useSWRWithTime<Insights>(`/admin/dashboard/insights?days=${days}`);
  const trend = td?.trend ?? [];
  const branchStats = td?.branches ?? [];

  const num = (n: number) => (isLive ? <CountUp value={n} /> : '—');

  const stats = [
    { label: 'Present Now', value: data.presentNow, icon: UserCheck, tint: 'text-emerald-600', bg: 'bg-emerald-50' },
    { label: 'Absent', value: data.absent, icon: UserX, tint: 'text-rose-600', bg: 'bg-rose-50' },
    { label: 'Late Arrivals', value: data.lateArrivals, icon: Clock4, tint: 'text-amber-600', bg: 'bg-amber-50' },
    { label: 'On Leave', value: data.onLeave, icon: CalendarOff, tint: 'text-indigo-600', bg: 'bg-indigo-50' },
    { label: 'Pending Approvals', value: data.pendingApprovals, icon: FileClock, tint: 'text-violet-600', bg: 'bg-violet-50' },
    { label: 'Checked In', value: data.checkedIn, icon: UserCheck, tint: 'text-brand-600', bg: 'bg-brand-50' },
    { label: 'Total Staff', value: data.totalStaff, icon: Users, tint: 'text-slate-600', bg: 'bg-slate-100' },
    { label: 'Branches', value: data.branches, icon: Building2, tint: 'text-cyan-600', bg: 'bg-cyan-50' },
  ];

  const queues = ins
    ? [
        { label: 'Leave requests', value: ins.pending.leave, href: '/leaves', icon: CalendarOff, tone: 'bg-indigo-50 text-indigo-700' },
        { label: 'Punches to approve', value: ins.pending.attendance, href: '/attendance', icon: FileClock, tone: 'bg-amber-50 text-amber-700' },
        { label: 'Vouchers to approve', value: ins.pending.claimsToApprove, href: '/claims', icon: Receipt, tone: 'bg-violet-50 text-violet-700' },
        { label: 'Vouchers to pay', value: ins.pending.claimsToPay, href: '/claims', icon: Wallet, tone: 'bg-emerald-50 text-emerald-700' },
      ]
    : [];

  return (
    <div className="space-y-8">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Dashboard</h1>
          <p className="text-sm text-muted-foreground">
            Live overview across all branches
            {dataUpdatedAt ? ` · updated ${new Date(dataUpdatedAt).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' })}` : ''}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <div className="flex rounded-xl border border-border bg-card p-1 text-xs font-medium">
            {([7, 30] as const).map((d) => (
              <button
                key={d}
                onClick={() => setDays(d)}
                className={`rounded-lg px-3 py-1.5 transition ${days === d ? 'bg-primary text-primary-foreground shadow-sm' : 'text-muted-foreground hover:text-foreground'}`}
              >
                {d} days
              </button>
            ))}
          </div>
          <span className={`chip ${isLive ? 'chip-present' : 'chip-half'}`}>
            {isLive ? '● Live' : 'Offline'}
          </span>
        </div>
      </div>

      {/* Hero summary panel */}
      <div className="brand-gradient relative overflow-hidden rounded-2xl p-6 text-white shadow-brand" style={{ animation: 'rise-in 0.6s cubic-bezier(0.22,1,0.36,1) both' }}>
        <div aria-hidden className="pointer-events-none absolute -right-16 -top-20 h-64 w-64 rounded-full bg-white/10 blur-2xl animate-drift" />
        <div className="relative flex flex-wrap items-center justify-between gap-4">
          <div>
            <div className="text-sm text-white/75">Today&apos;s Attendance Rate</div>
            <div className="mt-1 text-4xl font-bold">{isLive ? <><CountUp value={data.attendanceRate} />%</> : '—%'}</div>
            <div className="mt-1 inline-flex items-center gap-1 text-xs text-white/80">
              <ArrowUpRight className="h-3.5 w-3.5" /> vs. yesterday
            </div>
          </div>
          <div className="grid grid-cols-3 gap-6 text-center">
            <div>
              <div className="text-2xl font-bold">{num(data.totalStaff)}</div>
              <div className="text-xs text-white/70">Total Staff</div>
            </div>
            <div>
              <div className="text-2xl font-bold">{num(data.branches)}</div>
              <div className="text-xs text-white/70">Branches</div>
            </div>
            <div>
              <div className="text-2xl font-bold">{num(data.checkedIn)}</div>
              <div className="text-xs text-white/70">Checked In</div>
            </div>
          </div>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
        {stats.map(({ label, value, icon: Icon, tint, bg }, i) => (
          <Card key={label} className="transition hover:-translate-y-0.5 hover:shadow-md" style={{ animation: `rise-in 0.5s cubic-bezier(0.22,1,0.36,1) ${80 + i * 45}ms both` }}>
            <CardContent className="flex flex-col gap-3 p-5">
              <div className={`flex h-10 w-10 items-center justify-center rounded-xl ${bg}`}>
                <Icon className={`h-5 w-5 ${tint}`} />
              </div>
              <div>
                <div className="text-2xl font-bold">{num(value)}</div>
                <div className="text-xs font-medium text-muted-foreground">{label}</div>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>

      {/* Rate over the range, and what is waiting on someone */}
      <div className="grid gap-4 lg:grid-cols-3">
        <ChartCard title="Attendance rate" subtitle={`Share of staff checked in · last ${days} days`} className="lg:col-span-2" delay={120}>
          {ins ? (
            <div className="h-64">
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={ins.attendanceRate} margin={{ top: 6, right: 20, left: -18, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#eef2f0" vertical={false} />
                  <XAxis dataKey="label" {...axis} interval={days === 30 ? 4 : 0} />
                  <YAxis yAxisId="rate" {...axis} domain={[0, 100]} tickFormatter={(v: number) => `${v}%`} />
                  <YAxis yAxisId="n" orientation="right" hide />
                  <Tooltip {...tooltipStyle} />
                  <Legend wrapperStyle={{ fontSize: 12 }} />
                  <Line yAxisId="rate" type="monotone" dataKey="rate" name="Rate %" stroke={CHART.green} strokeWidth={2.5} dot={{ r: days === 7 ? 3 : 0 }} />
                  <Line yAxisId="n" type="monotone" dataKey="late" name="Late" stroke={CHART.amber} strokeWidth={1.75} strokeDasharray="4 3" dot={false} />
                </LineChart>
              </ResponsiveContainer>
            </div>
          ) : <EmptyChart height={256} text="Loading…" />}
        </ChartCard>

        <div className="space-y-4">
          <ChartCard title="Waiting on you" subtitle="Open queues" delay={180}>
            <ul className="space-y-2">
              {queues.map((q) => (
                <li key={q.label}>
                  <Link href={q.href} className="group flex items-center gap-3 rounded-xl border border-border px-3 py-2.5 transition hover:border-primary/30 hover:bg-muted/40">
                    <span className={`flex h-8 w-8 items-center justify-center rounded-lg ${q.tone}`}><q.icon className="h-4 w-4" /></span>
                    <span className="flex-1 text-sm">{q.label}</span>
                    <span className={`text-lg font-bold tabular-nums ${q.value > 0 ? '' : 'text-muted-foreground/60'}`}><CountUp value={q.value} /></span>
                    <ChevronRight className="h-4 w-4 text-muted-foreground transition group-hover:translate-x-0.5" />
                  </Link>
                </li>
              ))}
              {!ins && <EmptyChart height={160} text="Loading…" />}
            </ul>
          </ChartCard>

          {ins?.payroll && (
            <ChartCard title="Last payroll" subtitle={`${MONTHS[ins.payroll.month]} ${ins.payroll.year} · ${ins.payroll.payslips} payslips`} delay={240}>
              <div className="grid grid-cols-2 gap-3">
                <div className="rounded-xl bg-muted/50 p-3">
                  <div className="text-[11px] text-muted-foreground">Gross</div>
                  <div className="text-lg font-bold"><CountUp value={ins.payroll.gross} format={(n) => `₹${Math.round(n).toLocaleString('en-IN')}`} /></div>
                </div>
                <div className="rounded-xl bg-emerald-50 p-3 text-emerald-900">
                  <div className="text-[11px] text-emerald-700">Net payable</div>
                  <div className="text-lg font-bold"><CountUp value={ins.payroll.net} format={(n) => `₹${Math.round(n).toLocaleString('en-IN')}`} /></div>
                </div>
              </div>
              <Link href="/payroll" className="mt-3 inline-flex items-center gap-1 text-xs font-semibold text-primary hover:underline">
                Open payroll <ChevronRight className="h-3.5 w-3.5" />
              </Link>
            </ChartCard>
          )}
        </div>
      </div>

      {/* When, how and where people punch */}
      <div className="grid gap-4 lg:grid-cols-3">
        <ChartCard title="Arrival times" subtitle={`Check-ins by half hour · last ${days} days`} delay={140}>
          {ins ? (
            <div className="h-56">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={ins.arrivals} margin={{ top: 6, right: 6, left: -22, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#eef2f0" vertical={false} />
                  <XAxis dataKey="label" {...axis} interval={0} tick={{ fontSize: 10, fill: '#6b7280' }} tickMargin={4} />
                  <YAxis {...axis} allowDecimals={false} />
                  <Tooltip {...tooltipStyle} />
                  <Bar dataKey="count" name="Check-ins" fill={CHART.sky} radius={[6, 6, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          ) : <EmptyChart height={224} text="Loading…" />}
        </ChartCard>

        <ChartCard title="How staff punch" subtitle={`Last ${days} days`} delay={200}>
          {ins ? (
            <Donut
              data={ins.punchModes.map((m) => ({ name: m.label, value: m.count }))}
              colors={[CHART.green, CHART.sky, CHART.gold, CHART.rose]}
              centre={{ value: String(ins.punchModes.reduce((s, m) => s + m.count, 0)), label: 'punches' }}
            />
          ) : <EmptyChart height={180} text="Loading…" />}
        </ChartCard>

        <ChartCard title="Leave this month" subtitle="Approved days by type" delay={260}>
          {ins ? (
            <Donut
              data={ins.leaveByType.map((l) => ({ name: LEAVE_LABEL[l.type] ?? l.type, value: l.days }))}
              colors={[CHART.indigo, CHART.rose, CHART.green, CHART.slate, CHART.gold]}
              centre={{ value: String(ins.leaveByType.reduce((s, l) => s + l.days, 0)), label: 'days' }}
            />
          ) : <EmptyChart height={180} text="Loading…" />}
        </ChartCard>
      </div>

      <div className="grid gap-4 md:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Live Map</CardTitle>
          </CardHeader>
          <CardContent>
            <BranchMap branches={bd?.branches ?? []} height={256} />
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Attendance Trend (7 days)</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="h-64">
              {trend.length === 0 ? (
                <div className="flex h-full items-center justify-center text-sm text-muted-foreground">No data yet</div>
              ) : (
                <ResponsiveContainer width="100%" height="100%">
                  <AreaChart data={trend} margin={{ top: 8, right: 8, left: -18, bottom: 0 }}>
                    <defs>
                      <linearGradient id="gPresent" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="5%" stopColor="#16A34A" stopOpacity={0.35} />
                        <stop offset="95%" stopColor="#16A34A" stopOpacity={0} />
                      </linearGradient>
                    </defs>
                    <CartesianGrid strokeDasharray="3 3" stroke="#eee" vertical={false} />
                    <XAxis dataKey="label" tick={{ fontSize: 12 }} tickLine={false} axisLine={false} />
                    <YAxis tick={{ fontSize: 12 }} tickLine={false} axisLine={false} allowDecimals={false} />
                    <Tooltip contentStyle={{ borderRadius: 12, border: '1px solid #eee', fontSize: 13 }} />
                    <Legend wrapperStyle={{ fontSize: 12 }} />
                    <Area type="monotone" dataKey="present" name="Present" stroke="#16A34A" strokeWidth={2} fill="url(#gPresent)" />
                    <Area type="monotone" dataKey="late" name="Late" stroke="#B45309" strokeWidth={2} fillOpacity={0} />
                    <Area type="monotone" dataKey="absent" name="Absent" stroke="#E11D48" strokeWidth={2} fillOpacity={0} />
                  </AreaChart>
                </ResponsiveContainer>
              )}
            </div>
          </CardContent>
        </Card>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Branch-wise Present Today</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="h-64">
              {branchStats.length === 0 ? (
                <div className="flex h-full items-center justify-center text-sm text-muted-foreground">No branch data yet</div>
              ) : (
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={branchStats} margin={{ top: 8, right: 8, left: -18, bottom: 0 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#eee" vertical={false} />
                    <XAxis dataKey="branch" tick={{ fontSize: 12 }} tickLine={false} axisLine={false} />
                    <YAxis tick={{ fontSize: 12 }} tickLine={false} axisLine={false} allowDecimals={false} />
                    <Tooltip contentStyle={{ borderRadius: 12, border: '1px solid #eee', fontSize: 13 }} />
                    <Legend wrapperStyle={{ fontSize: 12 }} />
                    <Bar dataKey="present" name="Present" fill="#00A174" radius={[6, 6, 0, 0]} />
                    <Bar dataKey="total" name="Total staff" fill="#D0EFE5" radius={[6, 6, 0, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              )}
            </div>
          </CardContent>
        </Card>

        <ChartCard title="Departments today" subtitle="Checked in vs. staff" delay={160}>
          {ins && ins.departments.length > 0 ? (
            <div style={{ height: Math.max(200, ins.departments.length * 34) }}>
              <ResponsiveContainer width="100%" height="100%">
                <BarChart layout="vertical" data={ins.departments} margin={{ top: 0, right: 12, left: 0, bottom: 0 }}>
                  <XAxis type="number" hide allowDecimals={false} />
                  <YAxis type="category" dataKey="name" width={110} {...axis} />
                  <Tooltip {...tooltipStyle} />
                  <Legend wrapperStyle={{ fontSize: 12 }} />
                  <Bar dataKey="total" name="Staff" fill={CHART.mint} radius={[0, 6, 6, 0]} barSize={12} />
                  <Bar dataKey="present" name="Checked in" fill={CHART.green} radius={[0, 6, 6, 0]} barSize={12} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          ) : <EmptyChart height={200} text={ins ? 'No departments yet' : 'Loading…'} />}
        </ChartCard>
      </div>

      {/* People to look at */}
      <div className="grid gap-4 lg:grid-cols-2">
        <ChartCard title="Most late arrivals" subtitle="This month" delay={140}>
          {ins && ins.topLate.length > 0 ? (
            <ol className="space-y-2">
              {ins.topLate.map((p, i) => {
                const max = ins.topLate[0].lateDays;
                return (
                  <li key={p.employeeId} className="flex items-center gap-3" style={{ animation: `rise-in 0.4s ease-out ${200 + i * 60}ms both` }}>
                    <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-amber-100 text-xs font-bold text-amber-800">{i + 1}</span>
                    <div className="min-w-0 flex-1">
                      <div className="flex items-baseline justify-between gap-2">
                        <span className="truncate text-sm font-medium">{p.name}</span>
                        <span className="shrink-0 text-xs text-muted-foreground">{p.lateDays} day{p.lateDays === 1 ? '' : 's'} · avg {p.avgMinutesLate} min</span>
                      </div>
                      <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-muted">
                        <div className="h-full rounded-full bg-amber-500 transition-[width] duration-700" style={{ width: `${(p.lateDays / max) * 100}%` }} />
                      </div>
                      <div className="mt-0.5 text-[11px] text-muted-foreground">{p.employeeCode} · {p.branch}</div>
                    </div>
                  </li>
                );
              })}
            </ol>
          ) : (
            <div className="flex items-center gap-2 rounded-xl bg-emerald-50 p-4 text-sm text-emerald-800">
              <AlarmClock className="h-4 w-4" /> {ins ? 'Nobody has been late this month.' : 'Loading…'}
            </div>
          )}
        </ChartCard>

        <ChartCard title="Upcoming leave" subtitle="Approved, next 7 days" delay={200}>
          {ins && ins.upcomingLeave.length > 0 ? (
            <ul className="divide-y divide-border">
              {ins.upcomingLeave.map((l, i) => (
                <li key={`${l.name}-${l.fromDate}-${i}`} className="flex items-center gap-3 py-2.5">
                  <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-indigo-50 text-indigo-700"><Plane className="h-4 w-4" /></span>
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-sm font-medium">{l.name}</div>
                    <div className="text-[11px] text-muted-foreground">{LEAVE_LABEL[l.type] ?? l.type} · {l.days} day{l.days === 1 ? '' : 's'}</div>
                  </div>
                  <span className="shrink-0 text-xs text-muted-foreground">
                    {shortDate(l.fromDate)}{l.toDate !== l.fromDate ? ` – ${shortDate(l.toDate)}` : ''}
                  </span>
                </li>
              ))}
            </ul>
          ) : (
            <div className="rounded-xl bg-muted/50 p-4 text-sm text-muted-foreground">{ins ? 'No approved leave in the next week.' : 'Loading…'}</div>
          )}
        </ChartCard>
      </div>
    </div>
  );
}

/** SWR, refreshed every minute, with the time the data last arrived. */
function useSWRWithTime<T>(key: string) {
  const [at, setAt] = useState<number | null>(null);
  const res = useSWR<T>(key, fetcher, {
    shouldRetryOnError: false,
    refreshInterval: 60_000,
    keepPreviousData: true,
    onSuccess: () => setAt(Date.now()),
  });
  return { data: res.data, dataUpdatedAt: at };
}
