'use client';

/**
 * One dealer, monitored from the console: today, the last 30 days, how its
 * people punch, its branches, staff, leave and claims activity, payroll runs,
 * kiosks and billing. Counts and states only — no names, no money paid to staff.
 */
import {
  Area, AreaChart, Bar, BarChart, CartesianGrid, Legend, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis,
} from 'recharts';
import { Building2, CalendarCheck, FileClock, Tablet, UserCheck, Users, Wallet } from 'lucide-react';
import type { DealerInsights } from '@/lib/platform-api';
import { CHART, ChartCard, Donut, EmptyChart, axis, tooltipStyle } from '@/components/charts';
import { CountUp, timeAgo } from '@/components/motion';

const MONTHS = ['', 'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const SUB_LABEL: Record<string, string> = { ACTIVE: 'Paid', PENDING_PAYMENT: 'Awaiting payment', PAST_DUE: 'Overdue', CANCELLED: 'Cancelled' };
const CLAIM_LABEL: Record<string, string> = {
  PENDING: 'Awaiting approval', NEEDS_CLARIFICATION: 'Needs clarification', APPROVED: 'Approved, to pay', PAID: 'Paid', REJECTED: 'Rejected',
};

export function DealerMonitor({ insights: x }: { insights: DealerInsights | null }) {
  if (!x) {
    return (
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {[0, 1, 2, 3].map((i) => <div key={i} className="h-28 animate-pulse rounded-2xl bg-muted/60" />)}
      </div>
    );
  }
  const sub = x.subscription;
  const kpis = [
    { icon: Users, label: 'Active staff', value: x.today.staff, note: `${x.today.branches} branch${x.today.branches === 1 ? '' : 'es'}`, tone: 'bg-emerald-100 text-emerald-700' },
    { icon: UserCheck, label: 'Checked in today', value: x.today.checkedIn, note: `${x.today.attendanceRate}% of staff`, tone: 'bg-sky-100 text-sky-700' },
    { icon: FileClock, label: 'Awaiting approval', value: x.today.pendingApprovals, note: 'leave + held punches', tone: 'bg-amber-100 text-amber-700' },
    { icon: CalendarCheck, label: 'Check-ins, 30 days', value: x.checkIns.reduce((s, d) => s + d.checkIns, 0), note: `${x.checkIns.reduce((s, d) => s + d.late, 0)} late`, tone: 'bg-indigo-100 text-indigo-700' },
  ];

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        {kpis.map((k, i) => (
          <div
            key={k.label}
            className="rounded-2xl border border-border bg-card p-4 shadow-sm"
            style={{ animation: `rise-in 0.5s cubic-bezier(0.22,1,0.36,1) ${i * 60}ms both` }}
          >
            <div className={`flex h-9 w-9 items-center justify-center rounded-xl ${k.tone}`}><k.icon className="h-[18px] w-[18px]" /></div>
            <div className="mt-3 text-2xl font-bold"><CountUp value={k.value} /></div>
            <div className="text-xs font-medium text-muted-foreground">{k.label}</div>
            <div className="mt-0.5 text-[11px] text-muted-foreground/80">{k.note}</div>
          </div>
        ))}
      </div>

      <div className="grid gap-4 lg:grid-cols-3">
        <ChartCard title="Check-ins and late arrivals" subtitle="Last 30 days" className="lg:col-span-2" delay={100}>
          <div className="h-60">
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={x.checkIns} margin={{ top: 6, right: 6, left: -20, bottom: 0 }}>
                <defs>
                  <linearGradient id="dmIn" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor={CHART.green} stopOpacity={0.35} />
                    <stop offset="100%" stopColor={CHART.green} stopOpacity={0} />
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" stroke="#eef2f0" vertical={false} />
                <XAxis dataKey="label" {...axis} interval={4} />
                <YAxis {...axis} allowDecimals={false} />
                <Tooltip {...tooltipStyle} />
                <Legend wrapperStyle={{ fontSize: 12 }} />
                <Area type="monotone" dataKey="checkIns" name="Check-ins" stroke={CHART.green} strokeWidth={2.5} fill="url(#dmIn)" />
                <Area type="monotone" dataKey="late" name="Late" stroke={CHART.amber} strokeWidth={2} fillOpacity={0} />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        </ChartCard>

        <ChartCard title="How staff punch" subtitle="Last 30 days" delay={160}>
          <Donut
            data={x.punchModes.map((m) => ({ name: m.label, value: m.count }))}
            colors={[CHART.green, CHART.sky, CHART.gold, CHART.rose]}
            centre={{ value: String(x.punchModes.reduce((s, m) => s + m.count, 0)), label: 'punches' }}
          />
        </ChartCard>

        <ChartCard title="Branches today" subtitle="Checked in vs. staff" delay={220}>
          {x.branchesToday.length === 0 ? <EmptyChart height={200} /> : (
            <div className="h-52">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={x.branchesToday} margin={{ top: 6, right: 6, left: -20, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#eef2f0" vertical={false} />
                  <XAxis dataKey="branch" {...axis} />
                  <YAxis {...axis} allowDecimals={false} />
                  <Tooltip {...tooltipStyle} />
                  <Bar dataKey="total" name="Staff" fill={CHART.mint} radius={[6, 6, 0, 0]} />
                  <Bar dataKey="present" name="Checked in" fill={CHART.green} radius={[6, 6, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          )}
        </ChartCard>

        <ChartCard title="Staff growth" subtitle="Active staff by date added · 90 days" delay={280}>
          <div className="h-52">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={x.staffGrowth} margin={{ top: 6, right: 6, left: -20, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#eef2f0" vertical={false} />
                <XAxis dataKey="label" {...axis} interval={14} />
                <YAxis {...axis} allowDecimals={false} />
                <Tooltip {...tooltipStyle} />
                <Line type="monotone" dataKey="staff" name="Staff" stroke={CHART.sky} strokeWidth={2.5} dot={false} />
              </LineChart>
            </ResponsiveContainer>
          </div>
        </ChartCard>

        <ChartCard title="Leave requests" subtitle="Per week · 12 weeks" delay={340}>
          <div className="h-52">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={x.leavePerWeek} margin={{ top: 6, right: 6, left: -20, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#eef2f0" vertical={false} />
                <XAxis dataKey="label" {...axis} interval={2} tickFormatter={(l: string) => l.replace('w/c ', '')} />
                <YAxis {...axis} allowDecimals={false} />
                <Tooltip {...tooltipStyle} />
                <Bar dataKey="approved" name="Approved" stackId="l" fill={CHART.green} />
                <Bar dataKey="pending" name="Pending" stackId="l" fill={CHART.gold} />
                <Bar dataKey="rejected" name="Rejected" stackId="l" fill={CHART.slate} radius={[6, 6, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </ChartCard>

        <ChartCard title="Vouchers" subtitle="Claims by state, all time · counts only" delay={400}>
          <Donut
            data={x.claimsByStatus.map((c) => ({ name: CLAIM_LABEL[c.status] ?? c.status, value: c.count }))}
            colors={[CHART.gold, CHART.indigo, CHART.sky, CHART.green, CHART.slate]}
            centre={{ value: String(x.claimsByStatus.reduce((s, c) => s + c.count, 0)), label: 'claims' }}
          />
        </ChartCard>

        <ChartCard title="Payroll runs" subtitle="Months run, with payslips issued" delay={460}>
          {x.payrollRuns.length === 0 ? (
            <EmptyChart height={120} text="No payroll run yet" />
          ) : (
            <ol className="relative space-y-3 border-l-2 border-emerald-100 pl-4">
              {[...x.payrollRuns].reverse().slice(0, 6).map((r, i) => (
                <li key={`${r.year}-${r.month}`} className="relative" style={{ animation: `rise-in 0.4s ease-out ${500 + i * 60}ms both` }}>
                  <span className="absolute -left-[21px] top-1 h-2.5 w-2.5 rounded-full border-2 border-white bg-emerald-500" />
                  <div className="flex items-baseline justify-between text-sm">
                    <span className="font-medium">{MONTHS[r.month]} {r.year}</span>
                    <span className="text-xs text-muted-foreground">{r.payslips} payslip{r.payslips === 1 ? '' : 's'}</span>
                  </div>
                </li>
              ))}
            </ol>
          )}
        </ChartCard>

        <ChartCard title="Billing" subtitle="Subscription" delay={520}>
          {sub ? (
            <dl className="space-y-2.5 text-sm">
              <Line2 label="Plan" value={sub.planCode.charAt(0) + sub.planCode.slice(1).toLowerCase()} />
              <Line2
                label="Status"
                value={
                  <span className={`rounded-full px-2 py-0.5 text-xs font-semibold ${sub.status === 'ACTIVE' ? 'bg-emerald-100 text-emerald-700' : 'bg-amber-100 text-amber-800'}`}>
                    {SUB_LABEL[sub.status] ?? sub.status}
                  </span>
                }
              />
              <Line2 label="Amount" value={`₹${(sub.amountPaise / 100).toLocaleString('en-IN')} / month`} />
              <Line2 label="Paid until" value={sub.periodEnd ? new Date(sub.periodEnd).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' }) : '—'} />
              <Line2 label="Last payment" value={sub.paidAt ? timeAgo(sub.paidAt) : 'None yet'} />
            </dl>
          ) : (
            <div className="flex items-start gap-2 rounded-xl bg-muted/50 p-3 text-sm text-muted-foreground">
              <Wallet className="mt-0.5 h-4 w-4 shrink-0" /> Onboarded by hand — no subscription on record.
            </div>
          )}
        </ChartCard>

        <ChartCard title="Kiosks" subtitle="Tablets at the branches" delay={580}>
          {x.kiosks.length === 0 ? (
            <div className="flex items-start gap-2 rounded-xl bg-muted/50 p-3 text-sm text-muted-foreground">
              <Tablet className="mt-0.5 h-4 w-4 shrink-0" /> No kiosk set up.
            </div>
          ) : (
            <ul className="space-y-2">
              {x.kiosks.map((k) => {
                const online = !!k.lastSeenAt && Date.now() - new Date(k.lastSeenAt).getTime() < 10 * 60_000;
                return (
                  <li key={k.id} className="flex items-center gap-3 rounded-xl border border-border px-3 py-2">
                    <span className={`h-2 w-2 rounded-full ${!k.isActive ? 'bg-slate-300' : online ? 'bg-emerald-500' : 'bg-amber-500'}`} />
                    <div className="min-w-0 flex-1">
                      <div className="truncate text-sm font-medium">{k.name}</div>
                      <div className="flex items-center gap-1 text-[11px] text-muted-foreground">
                        <Building2 className="h-3 w-3" /> {k.branch}
                      </div>
                    </div>
                    <span className="text-[11px] text-muted-foreground">
                      {!k.isActive ? 'Switched off' : !k.pairedAt ? 'Not paired' : timeAgo(k.lastSeenAt, 'never seen')}
                    </span>
                  </li>
                );
              })}
            </ul>
          )}
        </ChartCard>
      </div>
    </div>
  );
}

function Line2({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-3">
      <dt className="text-muted-foreground">{label}</dt>
      <dd className="font-medium">{value}</dd>
    </div>
  );
}
