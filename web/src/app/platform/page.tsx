'use client';

/**
 * The console's home: every dealer at a glance.
 *
 * Totals across dealers, the trends behind them, and one card per dealer with
 * its activity today, billing and health — and from there, add, suspend or
 * resume a dealer. Counts and states only: the console never shows a dealer's
 * people by name or what it pays them (see services/dashboard/insights.service.ts).
 */
import { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import {
  Area, AreaChart, Bar, BarChart, CartesianGrid, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis,
} from 'recharts';
import {
  AlertTriangle, Building2, CalendarClock, Clock, IndianRupee, KeyRound, Pause, Play, Plus, RefreshCw,
  Search, ShieldCheck, Tablet, UserCheck, Users, Wallet,
} from 'lucide-react';
import { platformApi, type DealerOverviewRow, type PlatformOverview } from '@/lib/platform-api';
import { CHART, ChartCard, Donut, EmptyChart, axis, tooltipStyle } from '@/components/charts';
import { CountUp, Sparkline, timeAgo } from '@/components/motion';
import { NewDealerDrawer } from '@/components/platform/new-dealer-drawer';
import { StatusDialog, type StatusTarget } from '@/components/platform/status-dialog';

const MONTHS = ['', 'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const SUB_LABEL: Record<string, string> = {
  ACTIVE: 'Paid', PENDING_PAYMENT: 'Awaiting payment', PAST_DUE: 'Overdue', CANCELLED: 'Cancelled',
};
const DAY = 86_400_000;

/** Why a dealer deserves a look, in order of how much. Empty = healthy. */
function concerns(d: DealerOverviewRow): string[] {
  const out: string[] = [];
  if (d.status === 'SUSPENDED') out.push('Suspended');
  if (d.subscription && d.subscription.status !== 'ACTIVE') out.push(SUB_LABEL[d.subscription.status] ?? d.subscription.status);
  if (d.admins > d.adminsWithTwoStep) out.push(`${d.admins - d.adminsWithTwoStep} admin${d.admins - d.adminsWithTwoStep === 1 ? '' : 's'} without two-step`);
  if (d.status === 'ACTIVE' && d.staff > 0 && (!d.lastCheckInAt || Date.now() - new Date(d.lastCheckInAt).getTime() > 3 * DAY)) out.push('No check-ins for 3+ days');
  if (d.kiosks > 0 && (!d.kioskLastSeenAt || Date.now() - new Date(d.kioskLastSeenAt).getTime() > 2 * DAY)) out.push('Kiosk offline');
  return out;
}

type Filter = 'ALL' | 'ACTIVE' | 'SUSPENDED' | 'ATTENTION';
type Sort = 'name' | 'staff' | 'today' | 'newest';

export default function PlatformOverviewPage() {
  const [data, setData] = useState<PlatformOverview | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loadedAt, setLoadedAt] = useState<Date | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [adding, setAdding] = useState(false);
  const [statusTarget, setStatusTarget] = useState<StatusTarget | null>(null);
  const [flash, setFlash] = useState<string | null>(null);
  const [query, setQuery] = useState('');
  const [filter, setFilter] = useState<Filter>('ALL');
  const [sort, setSort] = useState<Sort>('name');

  const load = useCallback(async () => {
    setRefreshing(true);
    try {
      setData(await platformApi.get<PlatformOverview>('/overview'));
      setLoadedAt(new Date());
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not load the overview');
    } finally {
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    void load();
    const t = setInterval(() => void load(), 60_000);
    return () => clearInterval(t);
  }, [load]);

  /** Briefly ring the card that just changed, so the eye finds it. */
  const highlight = (id: string) => {
    setFlash(id);
    setTimeout(() => setFlash((f) => (f === id ? null : f)), 3400);
  };

  const dealers = useMemo(() => {
    if (!data) return [];
    const q = query.trim().toLowerCase();
    return data.dealers
      .filter((d) => !q || d.name.toLowerCase().includes(q) || d.slug.includes(q))
      .filter((d) =>
        filter === 'ALL' ? true
          : filter === 'ATTENTION' ? concerns(d).length > 0
            : d.status === filter)
      .sort((a, b) =>
        sort === 'staff' ? b.staff - a.staff
          : sort === 'today' ? b.attendanceRate - a.attendanceRate
            : sort === 'newest' ? +new Date(b.createdAt) - +new Date(a.createdAt)
              : a.name.localeCompare(b.name));
  }, [data, query, filter, sort]);

  const t = data?.totals;
  const attention = data ? data.dealers.filter((d) => concerns(d).length > 0).length : 0;

  return (
    <div className="space-y-8">
      {/* ── Header ── */}
      <div className="flex flex-wrap items-end justify-between gap-4" style={{ animation: 'rise-in 0.5s ease-out both' }}>
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Overview</h1>
          <p className="mt-1 flex items-center gap-2 text-sm text-muted-foreground">
            <span className="relative flex h-2 w-2">
              <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-60" />
              <span className="relative inline-flex h-2 w-2 rounded-full bg-emerald-500" />
            </span>
            Every dealer, live · {loadedAt ? `updated ${loadedAt.toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' })}` : 'loading…'}
          </p>
        </div>
        <div className="flex gap-2">
          <button
            onClick={() => void load()}
            className="inline-flex items-center gap-2 rounded-xl border border-border bg-card px-3.5 py-2.5 text-sm font-medium hover:bg-muted"
            title="Refresh"
          >
            <RefreshCw className={`h-4 w-4 ${refreshing ? 'animate-spin' : ''}`} />
          </button>
          <button
            onClick={() => setAdding(true)}
            className="group inline-flex items-center gap-2 rounded-xl bg-ink-900 px-4 py-2.5 text-sm font-semibold text-white shadow-lg shadow-ink-900/20 transition hover:-translate-y-0.5 hover:shadow-xl"
          >
            <Plus className="h-4 w-4 transition-transform duration-300 group-hover:rotate-90" /> Add dealer
          </button>
        </div>
      </div>

      {error && <p className="rounded-xl bg-destructive/10 p-3 text-sm text-destructive">{error}</p>}

      {/* ── KPIs ── */}
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-3 xl:grid-cols-6">
        <Kpi i={0} icon={Building2} tone="ink" label="Active dealers" value={t?.activeDealers}
          note={t ? `${t.suspendedDealers} suspended` : undefined} />
        <Kpi i={1} icon={Users} tone="green" label="Staff tracked" value={t?.staff} note="across all dealers" />
        <Kpi i={2} icon={UserCheck} tone="sky" label="Checked in today" value={t?.checkedInToday}
          note={t ? `${t.attendanceRate}% of staff` : undefined} />
        <Kpi i={3} icon={IndianRupee} tone="gold" label="Monthly recurring" value={t ? t.monthlyRecurringPaise / 100 : undefined}
          format={(n) => `₹${Math.round(n).toLocaleString('en-IN')}`} note="paid subscriptions" />
        <Kpi i={4} icon={Wallet} tone="rose" label="Awaiting payment" value={t?.awaitingPayment} note="unpaid or overdue" />
        <Kpi i={5} icon={CalendarClock} tone="indigo" label="Signups to review" value={t?.pendingSignups}
          href="/platform/signups" note="open the queue →" />
      </div>

      {/* ── Charts ── */}
      <div className="grid gap-4 lg:grid-cols-3">
        <ChartCard title="Check-ins, all dealers" subtitle="Last 30 days" className="lg:col-span-2" delay={120}>
          {data ? (
            <div className="h-60">
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart data={data.series.checkIns} margin={{ top: 6, right: 6, left: -20, bottom: 0 }}>
                  <defs>
                    <linearGradient id="ovCheckins" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" stopColor={CHART.green} stopOpacity={0.35} />
                      <stop offset="100%" stopColor={CHART.green} stopOpacity={0} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid strokeDasharray="3 3" stroke="#eef2f0" vertical={false} />
                  <XAxis dataKey="label" {...axis} interval={4} />
                  <YAxis {...axis} allowDecimals={false} />
                  <Tooltip {...tooltipStyle} />
                  <Area type="monotone" dataKey="checkIns" name="Check-ins" stroke={CHART.green} strokeWidth={2.5} fill="url(#ovCheckins)" />
                </AreaChart>
              </ResponsiveContainer>
            </div>
          ) : <EmptyChart text="Loading…" height={240} />}
        </ChartCard>

        <ChartCard title="Attendance today" subtitle="Share of each dealer's staff checked in" delay={180}>
          {data && data.dealers.some((d) => d.staff > 0) ? (
            <div style={{ height: Math.max(160, data.dealers.filter((d) => d.staff > 0).length * 36) }}>
              <ResponsiveContainer width="100%" height="100%">
                <BarChart
                  layout="vertical"
                  data={data.dealers.filter((d) => d.staff > 0).map((d) => ({ name: d.name, rate: d.attendanceRate }))}
                  margin={{ top: 0, right: 16, left: 0, bottom: 0 }}
                >
                  <XAxis type="number" domain={[0, 100]} hide />
                  <YAxis type="category" dataKey="name" width={110} {...axis} />
                  <Tooltip {...tooltipStyle} formatter={(v) => [`${v}%`, 'Checked in']} />
                  <Bar dataKey="rate" fill={CHART.green} radius={[0, 8, 8, 0]} background={{ fill: '#f1f5f3', radius: 8 }} barSize={16} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          ) : <EmptyChart height={160} text={data ? 'No staff yet' : 'Loading…'} />}
        </ChartCard>

        <ChartCard title="Staff growth" subtitle="Active staff by date added · 90 days" delay={240}>
          {data ? (
            <div className="h-48">
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={data.series.staffGrowth} margin={{ top: 6, right: 6, left: -20, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#eef2f0" vertical={false} />
                  <XAxis dataKey="label" {...axis} interval={14} />
                  <YAxis {...axis} allowDecimals={false} />
                  <Tooltip {...tooltipStyle} />
                  <Line type="monotone" dataKey="staff" name="Staff" stroke={CHART.sky} strokeWidth={2.5} dot={false} />
                </LineChart>
              </ResponsiveContainer>
            </div>
          ) : <EmptyChart height={192} text="Loading…" />}
        </ChartCard>

        <ChartCard title="Signups" subtitle="Requests per week · 12 weeks" delay={300}>
          {data ? (
            <div className="h-48">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={data.series.signupsPerWeek} margin={{ top: 6, right: 6, left: -20, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#eef2f0" vertical={false} />
                  <XAxis dataKey="label" {...axis} interval={2} tickFormatter={(l: string) => l.replace('w/c ', '')} />
                  <YAxis {...axis} allowDecimals={false} />
                  <Tooltip {...tooltipStyle} />
                  <Bar dataKey="approved" name="Approved" stackId="s" fill={CHART.green} />
                  <Bar dataKey="pending" name="Pending" stackId="s" fill={CHART.gold} />
                  <Bar dataKey="rejected" name="Rejected" stackId="s" fill={CHART.slate} radius={[6, 6, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          ) : <EmptyChart height={192} text="Loading…" />}
        </ChartCard>

        <ChartCard title="Billing" subtitle="Subscriptions and plans" delay={360}>
          {data ? (
            <div className="space-y-5">
              <Donut
                height={120}
                colors={[CHART.green, CHART.gold, CHART.rose, CHART.slate]}
                data={['ACTIVE', 'PENDING_PAYMENT', 'PAST_DUE', 'CANCELLED'].map((s) => ({
                  name: SUB_LABEL[s], value: data.series.subscriptionsByStatus.find((x) => x.status === s)?.count ?? 0,
                }))}
                centre={{ value: String(data.series.subscriptionsByStatus.reduce((a, b) => a + b.count, 0)), label: 'subs' }}
              />
              <Donut
                height={120}
                colors={[CHART.sky, CHART.indigo, CHART.deep]}
                data={data.series.dealersByPlan.map((p) => ({ name: p.plan.charAt(0) + p.plan.slice(1).toLowerCase(), value: p.count }))}
                centre={{ value: String(data.series.dealersByPlan.reduce((a, b) => a + b.count, 0)), label: 'plans' }}
              />
            </div>
          ) : <EmptyChart height={240} text="Loading…" />}
        </ChartCard>
      </div>

      {/* ── Dealers ── */}
      <section className="space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="text-lg font-bold">Dealers</h2>
            <p className="text-sm text-muted-foreground">
              {data ? `${data.dealers.length} workspace${data.dealers.length === 1 ? '' : 's'}` : 'Loading…'}
              {attention > 0 && <> · <span className="font-medium text-amber-700">{attention} need{attention === 1 ? 's' : ''} attention</span></>}
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <div className="relative">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <input
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Search dealers"
                className="h-10 w-48 rounded-xl border border-border bg-card pl-9 pr-3 text-sm outline-none focus:border-primary/50 sm:w-56"
              />
            </div>
            <div className="flex rounded-xl border border-border bg-card p-1 text-xs font-medium">
              {(['ALL', 'ACTIVE', 'SUSPENDED', 'ATTENTION'] as Filter[]).map((f) => (
                <button
                  key={f}
                  onClick={() => setFilter(f)}
                  className={`rounded-lg px-2.5 py-1.5 transition ${filter === f ? 'bg-ink-900 text-white' : 'text-muted-foreground hover:text-foreground'}`}
                >
                  {f === 'ALL' ? 'All' : f === 'ATTENTION' ? 'Needs attention' : f.charAt(0) + f.slice(1).toLowerCase()}
                </button>
              ))}
            </div>
            <select
              value={sort}
              onChange={(e) => setSort(e.target.value as Sort)}
              className="h-10 rounded-xl border border-border bg-card px-3 text-sm"
              aria-label="Sort dealers"
            >
              <option value="name">Name</option>
              <option value="staff">Most staff</option>
              <option value="today">Best attendance today</option>
              <option value="newest">Newest</option>
            </select>
          </div>
        </div>

        {data === null ? (
          <div className="grid gap-4 lg:grid-cols-2">
            {[0, 1].map((i) => <div key={i} className="h-56 animate-pulse rounded-2xl bg-muted/60" />)}
          </div>
        ) : data.dealers.length === 0 ? (
          <div className="rounded-2xl border border-dashed border-border p-12 text-center">
            <Building2 className="mx-auto h-9 w-9 text-muted-foreground" />
            <p className="mt-3 font-semibold">No dealers yet</p>
            <p className="text-sm text-muted-foreground">Add your first one to get started.</p>
            <button onClick={() => setAdding(true)} className="mt-4 inline-flex items-center gap-2 rounded-xl bg-ink-900 px-4 py-2.5 text-sm font-semibold text-white">
              <Plus className="h-4 w-4" /> Add dealer
            </button>
          </div>
        ) : dealers.length === 0 ? (
          <p className="rounded-2xl border border-dashed border-border p-8 text-center text-sm text-muted-foreground">No dealer matches.</p>
        ) : (
          <div className="grid gap-4 lg:grid-cols-2">
            {dealers.map((d, i) => (
              <DealerCard
                key={d.id}
                dealer={d}
                index={i}
                flashing={flash === d.id}
                onStatus={() => setStatusTarget({ id: d.id, name: d.name, slug: d.slug, status: d.status, staff: d.staff, admins: d.admins })}
              />
            ))}
          </div>
        )}
      </section>

      <NewDealerDrawer
        open={adding}
        onClose={() => setAdding(false)}
        onCreated={async (id) => { await load(); highlight(id); }}
      />
      <StatusDialog
        target={statusTarget}
        onClose={() => setStatusTarget(null)}
        onChanged={(id, status) => {
          // Move the card at once; the reload confirms it.
          setData((cur) => cur && { ...cur, dealers: cur.dealers.map((d) => (d.id === id ? { ...d, status } : d)) });
          highlight(id);
          void load();
        }}
      />
    </div>
  );
}

const TONES = {
  ink: 'bg-ink-900 text-white',
  green: 'bg-emerald-100 text-emerald-700',
  sky: 'bg-sky-100 text-sky-700',
  gold: 'bg-amber-100 text-amber-700',
  rose: 'bg-rose-100 text-rose-700',
  indigo: 'bg-indigo-100 text-indigo-700',
} as const;

function Kpi({
  i, icon: Icon, tone, label, value, note, format, href,
}: {
  i: number;
  icon: React.ComponentType<{ className?: string }>;
  tone: keyof typeof TONES;
  label: string;
  value: number | undefined;
  note?: string;
  format?: (n: number) => string;
  href?: string;
}) {
  const body = (
    <div
      className="group relative h-full overflow-hidden rounded-2xl border border-border bg-card p-4 shadow-sm transition hover:-translate-y-0.5 hover:shadow-md"
      style={{ animation: `rise-in 0.55s cubic-bezier(0.22,1,0.36,1) ${i * 60}ms both` }}
    >
      <div className={`flex h-9 w-9 items-center justify-center rounded-xl ${TONES[tone]}`}>
        <Icon className="h-[18px] w-[18px]" />
      </div>
      <div className="mt-3 text-2xl font-bold tracking-tight">
        {value === undefined ? <span className="text-muted-foreground">—</span> : <CountUp value={value} format={format} />}
      </div>
      <div className="text-xs font-medium text-muted-foreground">{label}</div>
      {note && <div className="mt-1 text-[11px] text-muted-foreground/80">{note}</div>}
    </div>
  );
  return href ? <Link href={href}>{body}</Link> : body;
}

function DealerCard({
  dealer: d, index, flashing, onStatus,
}: {
  dealer: DealerOverviewRow;
  index: number;
  flashing: boolean;
  onStatus: () => void;
}) {
  const active = d.status === 'ACTIVE';
  const issues = concerns(d);
  const sub = d.subscription;
  return (
    <article
      className={`relative overflow-hidden rounded-2xl border bg-card p-5 shadow-sm transition-all duration-500 hover:shadow-md ${
        active ? 'border-border' : 'border-amber-300/70 bg-amber-50/40 opacity-80 grayscale-[35%]'
      } ${flashing ? 'animate-row-flash' : ''}`}
      style={{ animation: flashing ? undefined : `rise-in 0.5s cubic-bezier(0.22,1,0.36,1) ${Math.min(index, 8) * 50}ms both` }}
    >
      {/* Status stripe */}
      <span className={`absolute inset-y-0 left-0 w-1 transition-colors duration-500 ${active ? 'bg-emerald-500' : 'bg-amber-500'}`} />

      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <Link href={`/platform/dealers/${d.id}`} className="truncate text-base font-bold hover:underline">{d.name}</Link>
            <span className={`rounded-full px-2 py-0.5 text-[11px] font-semibold transition-colors duration-500 ${active ? 'bg-emerald-100 text-emerald-700' : 'bg-amber-100 text-amber-800'}`}>
              {active ? 'Active' : 'Suspended'}
            </span>
            {sub && (
              <span className="rounded-full border border-border px-2 py-0.5 text-[11px] font-medium text-muted-foreground">
                {sub.planCode.charAt(0) + sub.planCode.slice(1).toLowerCase()} · {SUB_LABEL[sub.status] ?? sub.status}
              </span>
            )}
          </div>
          <code className="mt-1 inline-block text-xs text-muted-foreground">{d.slug}</code>
        </div>
        <Sparkline values={d.checkInsLast14} color={active ? CHART.green : CHART.slate} />
      </div>

      {/* Today */}
      <div className="mt-4 grid grid-cols-3 gap-3">
        <Metric label="Staff" value={d.staff} sub={`${d.branches} branch${d.branches === 1 ? '' : 'es'}`} />
        <Metric label="In today" value={d.checkedInToday} sub={`${d.attendanceRate}%`} />
        <Metric label="Pending" value={d.pendingApprovals} sub="approvals" />
      </div>
      <div className="mt-3 h-1.5 overflow-hidden rounded-full bg-muted">
        <div className="h-full rounded-full bg-emerald-500 transition-[width] duration-1000 ease-out" style={{ width: `${d.attendanceRate}%` }} />
      </div>

      {/* Health */}
      <ul className="mt-4 flex flex-wrap gap-1.5 text-[11px]">
        <Chip ok={d.admins === d.adminsWithTwoStep} icon={ShieldCheck}>{d.adminsWithTwoStep}/{d.admins} admins with two-step</Chip>
        <Chip ok={!!d.lastPayroll} icon={Wallet}>{d.lastPayroll ? `Payroll ${MONTHS[d.lastPayroll.month]} ${d.lastPayroll.year}` : 'No payroll run yet'}</Chip>
        {d.kiosks > 0 && (
          <Chip ok={!!d.kioskLastSeenAt && Date.now() - new Date(d.kioskLastSeenAt).getTime() < 2 * DAY} icon={Tablet}>
            {d.kiosks} kiosk{d.kiosks === 1 ? '' : 's'} · {timeAgo(d.kioskLastSeenAt, 'never seen')}
          </Chip>
        )}
      </ul>

      {issues.length > 0 && (
        <p className="mt-3 flex items-start gap-1.5 text-xs text-amber-800">
          <AlertTriangle className="mt-px h-3.5 w-3.5 shrink-0" /> {issues.join(' · ')}
        </p>
      )}

      <footer className="mt-4 flex flex-wrap items-center justify-between gap-3 border-t border-border pt-3">
        <div className="flex flex-wrap gap-x-4 gap-y-1 text-[11px] text-muted-foreground">
          <span className="inline-flex items-center gap-1"><Clock className="h-3 w-3" /> Last check-in {timeAgo(d.lastCheckInAt)}</span>
          <span className="inline-flex items-center gap-1"><KeyRound className="h-3 w-3" /> Admin sign-in {timeAgo(d.lastAdminSignInAt)}</span>
        </div>
        <div className="flex gap-2">
          <Link
            href={`/platform/dealers/${d.id}`}
            className="rounded-lg border border-border px-3 py-1.5 text-xs font-medium transition hover:bg-muted"
          >
            Manage
          </Link>
          <button
            onClick={onStatus}
            className={`inline-flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-xs font-medium transition ${
              active ? 'border-border hover:border-amber-300 hover:bg-amber-50 hover:text-amber-800' : 'border-emerald-300 bg-emerald-50 text-emerald-800 hover:bg-emerald-100'
            }`}
          >
            {active ? <Pause className="h-3.5 w-3.5" /> : <Play className="h-3.5 w-3.5" />}
            {active ? 'Suspend' : 'Resume'}
          </button>
        </div>
      </footer>
    </article>
  );
}

function Metric({ label, value, sub }: { label: string; value: number; sub: string }) {
  return (
    <div className="rounded-xl bg-muted/50 px-3 py-2">
      <div className="text-[11px] text-muted-foreground">{label}</div>
      <div className="text-lg font-bold leading-tight"><CountUp value={value} /></div>
      <div className="text-[11px] text-muted-foreground">{sub}</div>
    </div>
  );
}

function Chip({ ok, icon: Icon, children }: { ok: boolean; icon: React.ComponentType<{ className?: string }>; children: React.ReactNode }) {
  return (
    <li className={`inline-flex items-center gap-1 rounded-full px-2 py-1 font-medium ${ok ? 'bg-emerald-50 text-emerald-700' : 'bg-amber-50 text-amber-800'}`}>
      <Icon className="h-3 w-3" /> {children}
    </li>
  );
}
