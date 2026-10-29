'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import useSWR from 'swr';
import dynamic from 'next/dynamic';
import { fetcher } from '@/lib/api';
import { ServerExports } from '@/components/server-exports';
import { CountUp } from '@/components/motion';
import { CHART, Donut } from '@/components/charts';
import { can, currentRole, SETUP_ROLES } from '@/lib/permissions';
import { useAddress, useLiveTracking, type TrackBranch, type TrackSegment, type TrackState, type TrackedEmployee } from '@/hooks/useApi';
import { STATE_COLOR, STATE_LABEL, initials, type TrackPoint } from '@/components/live-tracking-map';
import {
  Loader2, Radar, MapPinOff, WifiOff, Users, ShieldCheck, Search, X, Clock3, Route, MapPin,
  CalendarRange, TrendingUp, Timer, Footprints, LocateFixed, ExternalLink,
} from 'lucide-react';

// Leaflet touches `window`, so load the map only on the client.
const LiveTrackingMap = dynamic(() => import('@/components/live-tracking-map'), {
  ssr: false,
  loading: () => <div className="flex h-full items-center justify-center rounded-2xl bg-muted/40 text-sm text-muted-foreground">Loading map…</div>,
});

interface Named { id: string; name: string }

interface TrackDetail {
  employee: { id: string; name: string; employeeCode: string };
  window: { from: string; to: string; open: boolean };
  points: TrackPoint[];
  events: { ts: string; kind: string }[];
  summary: {
    insideMin: number; outsideMin: number; offMin: number; noSignalMin: number; mockFixes: number;
    episodes: { from: string; to: string; minutes: number; maxBeyondM: number }[];
    segments: TrackSegment[];
  };
}

interface SummaryRow {
  attendanceId: string; date: string; employeeCode: string; name: string; branch: string;
  department: string; designation: string; checkIn: string | null; checkOut: string | null;
  trackedMin: number; insideMin: number; outsideMin: number; episodes: number; longestAwayMin: number;
  offMin: number; noSignalMin: number; mockFixes: number;
}
interface EpisodeRow {
  date: string; employeeCode: string; name: string; branch: string; department: string;
  from: string | null; to: string | null; minutes: number; maxBeyondM: number;
}

const opts = { shouldRetryOnError: false };
const field = 'h-9 rounded-xl border border-border bg-card px-3 text-sm outline-none focus:ring-2 focus:ring-brand-500/30';

const iso = (d: Date) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
const clock = (s: string | null | undefined) =>
  s ? new Date(s).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' }) : '—';

/** 0 → "—", 23 → "23m", 125 → "2h 05m". */
function dur(min: number) {
  if (!min || min <= 0) return '—';
  const m = Math.round(min);
  if (m < 60) return `${m}m`;
  return `${Math.floor(m / 60)}h ${String(m % 60).padStart(2, '0')}m`;
}

/** Order of concern: who is away, then who has gone quiet, then everyone else. */
const RANK: Record<TrackState, number> = { OUTSIDE: 0, NO_SIGNAL: 1, OFF: 2, INSIDE: 3 };

type Tab = 'live' | 'reports';

export default function LiveTrackingPage() {
  const [tab, setTab] = useState<Tab>('live');
  const isBranchManager = currentRole() === 'BRANCH_MANAGER';
  const [branchId, setBranchId] = useState('');
  const { data, isLoading, isLive } = useLiveTracking(branchId);
  const { data: br } = useSWR<{ branches: Named[] }>(isBranchManager ? null : '/admin/branches', fetcher, opts);

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="flex items-center gap-2 text-2xl font-bold tracking-tight">
            Live Tracking
            {data?.enabled && (
              <span className="relative flex h-2.5 w-2.5" title={isLive ? 'Live' : 'Offline'}>
                {isLive && <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-brand-500 opacity-60" />}
                <span className={`relative inline-flex h-2.5 w-2.5 rounded-full ${isLive ? 'bg-brand-500' : 'bg-amber-500'}`} />
              </span>
            )}
          </h1>
          <p className="text-sm text-muted-foreground">
            Where checked-in staff are, and who has left their branch
            {data?.enabled ? ` · updated ${clock(data.generatedAt)} · refreshes every 30 s` : ''}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {tab === 'live' && !isBranchManager && data?.enabled && (
            <select value={branchId} onChange={(e) => setBranchId(e.target.value)} className={field}>
              <option value="">All branches</option>
              {br?.branches.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
            </select>
          )}
          <div className="flex rounded-xl border border-border bg-card p-1 text-sm font-medium">
            {([['live', 'Live map', Radar], ['reports', 'Reports', CalendarRange]] as const).map(([key, label, Icon]) => (
              <button
                key={key}
                onClick={() => setTab(key)}
                className={`flex items-center gap-1.5 rounded-lg px-3 py-1.5 transition ${tab === key ? 'bg-primary text-primary-foreground shadow-sm' : 'text-muted-foreground hover:text-foreground'}`}
              >
                <Icon className="h-4 w-4" /> {label}
              </button>
            ))}
          </div>
        </div>
      </div>

      {isLoading && !data && (
        <div className="flex h-64 items-center justify-center gap-2 text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin" /> Loading…</div>
      )}

      {data && !data.enabled && <TrackingOff />}

      {data?.enabled && tab === 'live' && (
        <LiveView
          employees={data.employees}
          branches={data.branches}
          untracked={data.untrackedCheckedIn}
          fitKey={branchId || 'all'}
        />
      )}

      {data && tab === 'reports' && <ReportsView isBranchManager={isBranchManager} />}
    </div>
  );
}

function TrackingOff() {
  return (
    <section className="brand-gradient-soft relative overflow-hidden rounded-2xl border border-border p-8">
      <div aria-hidden className="pointer-events-none absolute -right-10 -top-10 h-56 w-56 rounded-full bg-brand-200/40 blur-2xl" />
      <div className="relative max-w-xl space-y-4">
        <span className="flex h-12 w-12 items-center justify-center rounded-2xl bg-brand-600 text-white shadow-brand">
          <Radar className="h-6 w-6" />
        </span>
        <div>
          <h2 className="text-lg font-bold">Live tracking is off</h2>
          <p className="mt-1 text-sm text-muted-foreground">
            When it is on, the employee app records each person&apos;s location every 2 minutes from check-in until
            check-out. This page then shows where everyone is, who has left their branch and for how long — with a
            report you can download. Staff agree to it in the app and are told when monitoring starts and stops.
          </p>
        </div>
        {can(SETUP_ROLES) ? (
          <Link href="/settings" className="inline-flex rounded-xl bg-brand-600 px-4 py-2.5 text-sm font-semibold text-white shadow-brand hover:bg-brand-700">
            Turn it on in Settings
          </Link>
        ) : (
          <p className="text-sm font-medium">Ask a Super Admin or HR Manager to turn it on in Settings.</p>
        )}
      </div>
    </section>
  );
}

// ── Live map ──

function LiveView({ employees, branches, untracked, fitKey }: {
  employees: TrackedEmployee[];
  branches: TrackBranch[];
  untracked: number;
  fitKey: string;
}) {
  const [selected, setSelected] = useState<string | null>(null);
  const mapRef = useRef<HTMLElement>(null);
  /** On a phone the map sits above the list, so bring it into view to show the pick. */
  const [focus, setFocus] = useState<{ lat: number; lng: number; key: number } | null>(null);
  const pick = (id: string | null) => {
    setSelected(id);
    setFocus(null);
    if (id && window.innerWidth < 1024) mapRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  };
  /** Track: select them and fly the map to where they are right now. */
  const track = (e: TrackedEmployee) => {
    if (!e.last) return;
    pick(e.attendanceId);
    setFocus({ lat: e.last.lat, lng: e.last.lng, key: Date.now() });
  };
  const [query, setQuery] = useState('');
  const [filter, setFilter] = useState<'all' | 'away' | 'quiet' | 'inside'>('all');

  // Re-render every 30 s so "away 23m" keeps counting between polls.
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 30_000);
    return () => clearInterval(t);
  }, []);
  const sinceMin = (e: TrackedEmployee) => (now - new Date(e.since).getTime()) / 60_000;

  const { data: trackData } = useSWR<TrackDetail>(selected ? `/admin/tracking/${selected}/track` : null, fetcher, {
    ...opts, refreshInterval: 60_000,
  });

  const counts = {
    all: employees.length,
    away: employees.filter((e) => e.state === 'OUTSIDE').length,
    quiet: employees.filter((e) => e.state === 'OFF' || e.state === 'NO_SIGNAL').length,
    inside: employees.filter((e) => e.state === 'INSIDE').length,
  };
  const q = query.trim().toLowerCase();
  const list = employees
    .filter((e) =>
      filter === 'all' ? true
        : filter === 'away' ? e.state === 'OUTSIDE'
          : filter === 'quiet' ? e.state === 'OFF' || e.state === 'NO_SIGNAL'
            : e.state === 'INSIDE')
    .filter((e) => !q || e.name.toLowerCase().includes(q) || e.employeeCode.toLowerCase().includes(q) || e.branch.toLowerCase().includes(q))
    .sort((a, b) => RANK[a.state] - RANK[b.state] || a.since.localeCompare(b.since));
  const selectedEmp = employees.find((e) => e.attendanceId === selected) ?? null;
  const insidePct = counts.all ? Math.round((counts.inside / counts.all) * 100) : 0;

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Kpi icon={Users} label="Tracked now" value={counts.all} tone="bg-brand-50 text-brand-700" delay={0} />
        <Kpi icon={ShieldCheck} label="Inside the fence" value={counts.inside} hint={`${insidePct}%`} tone="bg-emerald-50 text-emerald-700" delay={60} />
        <Kpi icon={MapPinOff} label="Away now" value={counts.away} tone="bg-rose-50 text-rose-600" delay={120} />
        <Kpi icon={WifiOff} label="GPS off / no signal" value={counts.quiet} tone="bg-amber-50 text-amber-700" delay={180} />
      </div>

      <div className="grid gap-4 lg:h-[calc(100vh-19rem)] lg:min-h-[560px] lg:grid-cols-[400px_minmax(0,1fr)]">
        {/* People */}
        <section className="flex min-h-0 flex-col rounded-2xl border border-border bg-card shadow-sm">
          <div className="space-y-3 border-b border-border/60 p-4">
            <div className="relative">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <input
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Search name, code or branch"
                className={`${field} w-full pl-9`}
              />
            </div>
            <div className="flex flex-wrap gap-1.5">
              {([['all', 'All'], ['away', 'Away'], ['quiet', 'No signal'], ['inside', 'Inside']] as const).map(([k, label]) => (
                <button
                  key={k}
                  onClick={() => setFilter(k)}
                  className={`rounded-full px-3 py-1 text-xs font-semibold transition ${filter === k ? 'bg-ink text-white' : 'bg-muted text-muted-foreground hover:text-foreground'}`}
                >
                  {label} <span className="ml-0.5 opacity-70 tabular-nums">{counts[k]}</span>
                </button>
              ))}
            </div>
          </div>

          <ul className="min-h-0 flex-1 divide-y divide-border/50 overflow-y-auto">
            {list.length === 0 && (
              <li className="flex flex-col items-center gap-2 p-10 text-center text-sm text-muted-foreground">
                <Footprints className="h-6 w-6" />
                {employees.length === 0 ? 'Nobody tracked is checked in right now.' : 'No one matches.'}
              </li>
            )}
            {list.map((e) => (
              <PersonRow
                key={e.attendanceId}
                e={e}
                selected={e.attendanceId === selected}
                status={e.state === 'INSIDE' ? 'Inside' : `${STATE_LABEL[e.state]} ${dur(sinceMin(e))}`}
                onSelect={() => pick(e.attendanceId === selected ? null : e.attendanceId)}
                onTrack={() => track(e)}
              />
            ))}
          </ul>
          {untracked > 0 && (
            <p className="border-t border-border/60 px-4 py-2.5 text-xs text-muted-foreground">
              +{untracked} checked in without tracking — exempt, kiosk, manual punch, or an older app.
            </p>
          )}
        </section>

        {/* Map, with the selected person's day floating over it */}
        <section ref={mapRef} className="relative order-first scroll-mt-4 h-[460px] rounded-2xl border border-border bg-card p-1.5 shadow-sm lg:order-none lg:h-auto">
          <LiveTrackingMap
            branches={branches}
            employees={employees}
            selected={selected}
            path={trackData?.points ?? []}
            onSelect={pick}
            fitKey={fitKey}
            focus={focus}
          />
          {selected && (
            <div className="absolute inset-x-3 bottom-14 z-[1000] max-h-[70%] overflow-y-auto rounded-2xl border border-border bg-card/95 shadow-xl backdrop-blur lg:inset-x-auto lg:bottom-3 lg:right-3 lg:top-14 lg:max-h-none lg:w-[340px]">
              <PersonPanel
                emp={selectedEmp}
                track={trackData}
                sinceMin={selectedEmp ? sinceMin(selectedEmp) : 0}
                onClose={() => pick(null)}
                onTrack={selectedEmp?.last ? () => track(selectedEmp) : undefined}
              />
            </div>
          )}
        </section>
      </div>
    </div>
  );
}

/** One person in the list: who, where (as an address), how their day has gone, and a Track button. */
function PersonRow({ e, selected, status, onSelect, onTrack }: {
  e: TrackedEmployee; selected: boolean; status: string; onSelect: () => void; onTrack: () => void;
}) {
  const { address, isLoading } = useAddress(e.last?.lat, e.last?.lng);
  return (
    <li className={`flex items-start gap-3 px-4 py-3 transition hover:bg-muted/50 ${selected ? 'bg-brand-50/70' : ''}`}>
      <button onClick={onSelect} className="flex min-w-0 flex-1 items-start gap-3 text-left">
        <Avatar name={e.name} state={e.state} />
        <div className="min-w-0 flex-1">
          <div className="truncate text-sm font-semibold">{e.name}</div>
          <div className="mt-0.5 truncate text-xs text-muted-foreground">{e.employeeCode} · {e.branch}</div>
          <div className="mt-1 flex items-start gap-1 text-xs text-foreground/80">
            <MapPin className="mt-0.5 h-3 w-3 shrink-0" style={{ color: STATE_COLOR[e.state] }} />
            <span className="line-clamp-2">
              {!e.last ? 'Location not received yet' : address ?? (isLoading ? 'Finding address…' : `${e.last.lat.toFixed(5)}, ${e.last.lng.toFixed(5)}`)}
            </span>
          </div>
          <DayBar segments={e.segments} className="mt-2 h-1.5" />
        </div>
      </button>
      <div className="flex shrink-0 flex-col items-end gap-1">
        <span className="text-xs font-semibold tabular-nums" style={{ color: STATE_COLOR[e.state] }}>{status}</span>
        <span className="text-[11px] text-muted-foreground">{e.last ? clock(e.last.ts) : 'no fix yet'}</span>
      <button
        onClick={onTrack}
        disabled={!e.last}
        title={e.last ? `Show ${e.name} on the map` : 'No location received yet'}
        className="mt-0.5 flex items-center gap-1 rounded-lg border border-brand-200 bg-brand-50 px-2.5 py-1.5 text-xs font-semibold text-brand-700 transition hover:bg-brand-100 disabled:cursor-not-allowed disabled:border-border disabled:bg-muted disabled:text-muted-foreground"
      >
        <LocateFixed className="h-3.5 w-3.5" /> Track
      </button>
      </div>
    </li>
  );
}

function Kpi({ icon: Icon, label, value, hint, tone, delay }: {
  icon: React.ComponentType<{ className?: string }>; label: string; value: number; hint?: string; tone: string; delay: number;
}) {
  return (
    <div
      className="flex items-center gap-3 rounded-2xl border border-border bg-card p-4 shadow-sm"
      style={{ animation: `rise-in 0.5s cubic-bezier(0.22,1,0.36,1) ${delay}ms both` }}
    >
      <span className={`flex h-11 w-11 shrink-0 items-center justify-center rounded-xl ${tone}`}>
        <Icon className="h-5 w-5" />
      </span>
      <div className="min-w-0">
        <div className="text-2xl font-bold leading-none"><CountUp value={value} /></div>
        <div className="mt-1 text-xs leading-tight text-muted-foreground">{label}{hint ? ` · ${hint}` : ''}</div>
      </div>
    </div>
  );
}

function Avatar({ name, state, size = 40 }: { name: string; state: TrackState; size?: number }) {
  return (
    <span className="relative shrink-0" style={{ width: size, height: size }}>
      <span
        className="flex h-full w-full items-center justify-center rounded-full text-xs font-bold text-white"
        style={{ background: STATE_COLOR[state] }}
      >
        {initials(name)}
      </span>
      {state === 'OUTSIDE' && (
        <span className="absolute -inset-0.5 animate-ping rounded-full border-2 opacity-40" style={{ borderColor: STATE_COLOR[state] }} />
      )}
    </span>
  );
}

/** The day as a strip of coloured stretches, in proportion to their length. */
function DayBar({ segments, className = '' }: { segments: TrackSegment[]; className?: string }) {
  const total = segments.reduce((n, s) => n + (new Date(s.to).getTime() - new Date(s.from).getTime()), 0);
  if (!total) return <div className={`w-full rounded-full bg-muted ${className}`} />;
  return (
    <div className={`flex w-full gap-px overflow-hidden rounded-full bg-muted ${className}`}>
      {segments.map((s, i) => {
        const w = ((new Date(s.to).getTime() - new Date(s.from).getTime()) / total) * 100;
        return (
          <span
            key={i}
            title={`${STATE_LABEL[s.state]} · ${clock(s.from)}–${clock(s.to)}`}
            style={{ width: `${w}%`, background: STATE_COLOR[s.state], minWidth: w > 0 ? 2 : 0 }}
          />
        );
      })}
    </div>
  );
}

function PersonPanel({ emp, track, sinceMin, onClose, onTrack }: {
  emp: TrackedEmployee | null; track: TrackDetail | undefined; sinceMin: number; onClose: () => void; onTrack?: () => void;
}) {
  const { address, isLoading: finding } = useAddress(emp?.last?.lat, emp?.last?.lng);
  const name = emp?.name ?? track?.employee.name ?? 'Employee';
  const state = emp?.state ?? 'NO_SIGNAL';
  const s = track?.summary;
  const stats: [string, number, TrackState][] = s
    ? [['Inside', s.insideMin, 'INSIDE'], ['Away', s.outsideMin, 'OUTSIDE'], ['GPS off', s.offMin, 'OFF'], ['No signal', s.noSignalMin, 'NO_SIGNAL']]
    : [];

  return (
    <div className="space-y-4 p-4">
      <div className="flex items-start gap-3">
        <Avatar name={name} state={state} size={44} />
        <div className="min-w-0 flex-1">
          <div className="truncate font-semibold">{name}</div>
          <div className="truncate text-xs text-muted-foreground">
            {emp ? `${emp.employeeCode} · ${emp.branch}` : track?.employee.employeeCode}
          </div>
          {emp && (
            <span className="mt-1.5 inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-xs font-semibold text-white" style={{ background: STATE_COLOR[state] }}>
              {STATE_LABEL[state]} · {dur(sinceMin)}
            </span>
          )}
        </div>
        <button onClick={onClose} className="rounded-lg p-1.5 text-muted-foreground hover:bg-muted hover:text-foreground" title="Close">
          <X className="h-4 w-4" />
        </button>
      </div>

      {emp?.last && (
        <div className="rounded-xl border border-border/70 bg-muted/30 p-3">
          <div className="flex items-start gap-2">
            <MapPin className="mt-0.5 h-4 w-4 shrink-0" style={{ color: STATE_COLOR[state] }} />
            <div className="min-w-0 flex-1">
              <div className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">Now at</div>
              <div className="text-sm font-medium leading-snug">
                {address ?? (finding ? 'Finding address…' : `${emp.last.lat.toFixed(5)}, ${emp.last.lng.toFixed(5)}`)}
              </div>
              <div className="mt-1 text-[11px] text-muted-foreground">
                {clock(emp.last.ts)}
                {emp.last.accuracy != null ? ` · ±${Math.round(emp.last.accuracy)} m` : ''}
                {emp.last.distance != null ? ` · ${Math.round(emp.last.distance)} m from branch centre` : ''}
              </div>
            </div>
          </div>
          <div className="mt-2.5 flex gap-2">
            {onTrack && (
              <button onClick={onTrack} className="flex flex-1 items-center justify-center gap-1.5 rounded-lg bg-brand-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-brand-700">
                <LocateFixed className="h-3.5 w-3.5" /> Track on map
              </button>
            )}
            <a
              href={`https://www.google.com/maps?q=${emp.last.lat},${emp.last.lng}`}
              target="_blank"
              rel="noreferrer"
              className="flex flex-1 items-center justify-center gap-1.5 rounded-lg border border-border bg-card px-3 py-1.5 text-xs font-semibold hover:bg-muted"
            >
              <ExternalLink className="h-3.5 w-3.5" /> Google Maps
            </a>
          </div>
        </div>
      )}

      {!track && <div className="flex items-center gap-2 text-sm text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin" /> Loading their day…</div>}

      {track && s && (
        <>
          <div>
            <div className="mb-1.5 flex justify-between text-[11px] font-medium text-muted-foreground">
              <span>{clock(track.window.from)}</span>
              <span>Today</span>
              <span>{track.window.open ? 'now' : clock(track.window.to)}</span>
            </div>
            <DayBar segments={s.segments} className="h-3" />
          </div>

          <div className="grid grid-cols-2 gap-2">
            {stats.map(([label, min, st]) => (
              <div key={label} className="rounded-xl bg-muted/50 p-2.5">
                <div className="flex items-center gap-1.5 text-[11px] font-medium text-muted-foreground">
                  <span className="h-2 w-2 rounded-full" style={{ background: STATE_COLOR[st] }} /> {label}
                </div>
                <div className="mt-0.5 text-base font-bold tabular-nums">{dur(min)}</div>
              </div>
            ))}
          </div>


          {s.mockFixes > 0 && (
            <p className="rounded-xl bg-amber-50 px-3 py-2 text-xs font-medium text-amber-800">
              {s.mockFixes} reading(s) came from a fake-location app and were not trusted.
            </p>
          )}

          <div>
            <h4 className="mb-2 flex items-center gap-1.5 text-sm font-semibold"><Route className="h-4 w-4" /> Times away</h4>
            {s.episodes.length === 0 ? (
              <p className="text-sm text-muted-foreground">Has not left the branch today.</p>
            ) : (
              <ol className="relative space-y-3 border-l border-rose-200 pl-4">
                {s.episodes.map((ep) => (
                  <li key={ep.from} className="relative">
                    <span className="absolute -left-[21px] top-1 h-2.5 w-2.5 rounded-full border-2 border-white bg-rose-500" />
                    <div className="text-sm font-medium">{clock(ep.from)} – {clock(ep.to)}</div>
                    <div className="text-xs text-muted-foreground">{dur(ep.minutes)} away · up to {ep.maxBeyondM} m beyond the fence</div>
                  </li>
                ))}
              </ol>
            )}
          </div>
        </>
      )}
    </div>
  );
}

// ── Reports ──

type Preset = 'today' | 'yesterday' | '7d' | 'month' | 'custom';

function rangeFor(p: Preset): [string, string] {
  const t = new Date();
  const day = (offset: number) => iso(new Date(t.getFullYear(), t.getMonth(), t.getDate() + offset));
  switch (p) {
    case 'yesterday': return [day(-1), day(-1)];
    case '7d': return [day(-6), day(0)];
    case 'month': return [iso(new Date(t.getFullYear(), t.getMonth(), 1)), day(0)];
    default: return [day(0), day(0)];
  }
}

function ReportsView({ isBranchManager }: { isBranchManager: boolean }) {
  const today = iso(new Date());
  const [preset, setPreset] = useState<Preset>('today');
  const [[from, to], setRange] = useState<[string, string]>(rangeFor('today'));
  const [view, setView] = useState<'summary' | 'episodes'>('summary');
  const [branchId, setBranchId] = useState('');
  const [departmentId, setDepartmentId] = useState('');
  const [designationId, setDesignationId] = useState('');
  const [sort, setSort] = useState<'away' | 'date'>('away');
  const { data: br } = useSWR<{ branches: Named[] }>(isBranchManager ? null : '/admin/branches', fetcher, opts);
  const { data: dp } = useSWR<{ departments: Named[] }>('/admin/departments', fetcher, opts);
  const { data: dg } = useSWR<{ designations: Named[] }>('/admin/designations', fetcher, opts);

  const pick = (p: Preset) => {
    setPreset(p);
    if (p !== 'custom') setRange(rangeFor(p));
  };
  const span = (new Date(to).getTime() - new Date(from).getTime()) / 86_400_000;
  const rangeError = span < 0 ? '"From" must be on or before "To".' : span > 30 ? 'Pick at most 31 days.' : null;
  const scope =
    (branchId ? `&branchId=${branchId}` : '') +
    (departmentId ? `&departmentId=${departmentId}` : '') +
    (designationId ? `&designationId=${designationId}` : '');
  const base = `/admin/reports/tracking?from=${from}&to=${to}${scope}`;
  const { data: summary, isLoading, error } = useSWR<{ rows: SummaryRow[] }>(rangeError ? null : `${base}&view=summary`, fetcher, opts);
  const { data: episodes } = useSWR<{ rows: EpisodeRow[] }>(rangeError || view !== 'episodes' ? null : `${base}&view=episodes`, fetcher, opts);
  const rows = useMemo(() => summary?.rows ?? [], [summary]);

  const totals = useMemo(() => {
    const t = { inside: 0, away: 0, off: 0, quiet: 0, episodes: 0, people: new Set<string>() };
    for (const r of rows) {
      t.inside += r.insideMin; t.away += r.outsideMin; t.off += r.offMin; t.quiet += r.noSignalMin; t.episodes += r.episodes;
      if (r.outsideMin > 0) t.people.add(r.employeeCode);
    }
    return t;
  }, [rows]);

  const ranking = useMemo(() => {
    const by = new Map<string, { name: string; branch: string; away: number; days: number; episodes: number }>();
    for (const r of rows) {
      const e = by.get(r.employeeCode) ?? { name: r.name, branch: r.branch, away: 0, days: 0, episodes: 0 };
      e.away += r.outsideMin; e.days += 1; e.episodes += r.episodes;
      by.set(r.employeeCode, e);
    }
    return [...by.entries()].map(([code, e]) => ({ code, ...e })).filter((e) => e.away > 0).sort((a, b) => b.away - a.away).slice(0, 8);
  }, [rows]);

  const sorted = useMemo(
    () => [...rows].sort((a, b) => (sort === 'away' ? b.outsideMin - a.outsideMin : b.date.localeCompare(a.date) || b.outsideMin - a.outsideMin)),
    [rows, sort],
  );
  const hours = (m: number) => Math.round((m / 60) * 10) / 10;

  return (
    <div className="space-y-4">
      {/* Filters */}
      <section className="flex flex-wrap items-center gap-2 rounded-2xl border border-border bg-card p-3 shadow-sm">
        <div className="flex rounded-xl bg-muted p-1 text-xs font-semibold">
          {([['today', 'Today'], ['yesterday', 'Yesterday'], ['7d', '7 days'], ['month', 'This month'], ['custom', 'Custom']] as const).map(([k, label]) => (
            <button
              key={k}
              onClick={() => pick(k)}
              className={`rounded-lg px-3 py-1.5 transition ${preset === k ? 'bg-card text-foreground shadow-sm' : 'text-muted-foreground hover:text-foreground'}`}
            >
              {label}
            </button>
          ))}
        </div>
        {preset === 'custom' && (
          <div className="flex items-center gap-1.5">
            <input type="date" value={from} max={today} onChange={(e) => setRange([e.target.value, to])} className={field} />
            <span className="text-xs text-muted-foreground">to</span>
            <input type="date" value={to} max={today} onChange={(e) => setRange([from, e.target.value])} className={field} />
          </div>
        )}
        {!isBranchManager && (
          <select value={branchId} onChange={(e) => setBranchId(e.target.value)} className={field}>
            <option value="">All branches</option>
            {br?.branches.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
          </select>
        )}
        <select value={departmentId} onChange={(e) => setDepartmentId(e.target.value)} className={field}>
          <option value="">All departments</option>
          {dp?.departments.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
        </select>
        <select value={designationId} onChange={(e) => setDesignationId(e.target.value)} className={field}>
          <option value="">All designations</option>
          {dg?.designations.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
        </select>
        <div className="ml-auto">
          {!rangeError && (
            <ServerExports path={`${base}&view=${view}`} filename={`${view === 'summary' ? 'live-tracking' : 'away-episodes'}-${from}_${to}`} />
          )}
        </div>
      </section>

      {rangeError && <p className="text-sm text-destructive">{rangeError}</p>}
      {error && <p className="text-sm text-destructive">{error instanceof Error ? error.message : 'Could not load the report'}</p>}
      {isLoading && <div className="flex items-center gap-2 text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin" /> Loading…</div>}

      {summary && (
        <>
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-5">
            <Stat icon={CalendarRange} label="Tracked days" value={String(rows.length)} tone="bg-brand-50 text-brand-700" />
            <Stat icon={MapPinOff} label="Total time away" value={dur(totals.away)} tone="bg-rose-50 text-rose-600" />
            <Stat icon={Timer} label="Away per tracked day" value={dur(rows.length ? totals.away / rows.length : 0)} tone="bg-violet-50 text-violet-700" />
            <Stat icon={TrendingUp} label="Times anyone left" value={String(totals.episodes)} hint={`${totals.people.size} people`} tone="bg-sky-50 text-sky-700" />
            <Stat icon={WifiOff} label="GPS off + no signal" value={dur(totals.off + totals.quiet)} tone="bg-amber-50 text-amber-700" />
          </div>

          <div className="grid gap-4 lg:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)]">
            <section className="rounded-2xl border border-border bg-card p-5 shadow-sm">
              <h3 className="text-sm font-semibold">Most time away</h3>
              <p className="mt-0.5 text-xs text-muted-foreground">Total outside the geofence in this range</p>
              {ranking.length === 0 ? (
                <div className="mt-4 flex h-40 items-center justify-center rounded-xl bg-muted/40 text-xs text-muted-foreground">Nobody left their branch in this range.</div>
              ) : (
                <ul className="mt-4 space-y-3">
                  {ranking.map((r) => (
                    <li key={r.code} className="flex items-center gap-3">
                      <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-rose-50 text-[11px] font-bold text-rose-600">{initials(r.name)}</span>
                      <div className="min-w-0 flex-1">
                        <div className="flex justify-between gap-2 text-sm">
                          <span className="truncate font-medium">{r.name} <span className="text-xs font-normal text-muted-foreground">{r.branch}</span></span>
                          <span className="shrink-0 font-semibold tabular-nums text-rose-600">{dur(r.away)}</span>
                        </div>
                        <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-muted">
                          <div className="h-full rounded-full bg-rose-500" style={{ width: `${(r.away / ranking[0].away) * 100}%` }} />
                        </div>
                        <div className="mt-0.5 text-[11px] text-muted-foreground">{r.episodes} time(s) over {r.days} day(s)</div>
                      </div>
                    </li>
                  ))}
                </ul>
              )}
            </section>
            <section className="rounded-2xl border border-border bg-card p-5 shadow-sm">
              <h3 className="text-sm font-semibold">Where the tracked time went</h3>
              <p className="mb-4 mt-0.5 text-xs text-muted-foreground">Hours, across every tracked day</p>
              <Donut
                data={[
                  { name: 'Inside', value: hours(totals.inside) },
                  { name: 'Away', value: hours(totals.away) },
                  { name: 'GPS off', value: hours(totals.off) },
                  { name: 'No signal', value: hours(totals.quiet) },
                ]}
                colors={[CHART.green, CHART.rose, CHART.amber, CHART.slate]}
                centre={{ value: `${hours(totals.inside + totals.away + totals.off + totals.quiet)}h`, label: 'tracked' }}
              />
            </section>
          </div>

          <section className="overflow-hidden rounded-2xl border border-border bg-card shadow-sm">
            <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border/60 px-5 py-3">
              <div className="flex rounded-xl bg-muted p-1 text-xs font-semibold">
                {([['summary', 'Per day'], ['episodes', 'Each time away']] as const).map(([k, label]) => (
                  <button
                    key={k}
                    onClick={() => setView(k)}
                    className={`rounded-lg px-3 py-1.5 transition ${view === k ? 'bg-card text-foreground shadow-sm' : 'text-muted-foreground hover:text-foreground'}`}
                  >
                    {label}
                  </button>
                ))}
              </div>
              {view === 'summary' && (
                <select value={sort} onChange={(e) => setSort(e.target.value as 'away' | 'date')} className={`${field} h-8 text-xs`}>
                  <option value="away">Most time away first</option>
                  <option value="date">Newest day first</option>
                </select>
              )}
            </div>

            {view === 'summary' ? (
              rows.length === 0 ? (
                <Empty text="No tracked days in this range." />
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="bg-muted/40 text-left text-[11px] uppercase tracking-wide text-muted-foreground">
                        <th className="px-5 py-2.5 font-semibold">Employee</th>
                        <th className="px-3 py-2.5 font-semibold">Date</th>
                        <th className="px-3 py-2.5 font-semibold">In – Out</th>
                        <th className="w-48 px-3 py-2.5 font-semibold">Day split</th>
                        <th className="px-3 py-2.5 text-right font-semibold">Away</th>
                        <th className="px-3 py-2.5 text-right font-semibold">Times</th>
                        <th className="px-3 py-2.5 text-right font-semibold">Longest</th>
                        <th className="px-3 py-2.5 text-right font-semibold">GPS off</th>
                        <th className="px-5 py-2.5 text-right font-semibold">No signal</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-border/50">
                      {sorted.map((r) => (
                        <tr key={r.attendanceId} className="hover:bg-muted/30">
                          <td className="px-5 py-3">
                            <div className="font-medium">{r.name}</div>
                            <div className="text-xs text-muted-foreground">{r.employeeCode} · {r.branch}</div>
                          </td>
                          <td className="whitespace-nowrap px-3 py-3 text-muted-foreground">
                            {new Date(r.date).toLocaleDateString('en-IN', { day: '2-digit', month: 'short' })}
                          </td>
                          <td className="whitespace-nowrap px-3 py-3 text-muted-foreground">{r.checkIn ?? '—'} – {r.checkOut ?? '…'}</td>
                          <td className="px-3 py-3"><SplitBar r={r} /></td>
                          <td className={`px-3 py-3 text-right font-semibold tabular-nums ${r.outsideMin ? 'text-rose-600' : 'text-muted-foreground'}`}>{dur(r.outsideMin)}</td>
                          <td className="px-3 py-3 text-right tabular-nums">{r.episodes || '—'}</td>
                          <td className="px-3 py-3 text-right tabular-nums">{dur(r.longestAwayMin)}</td>
                          <td className="px-3 py-3 text-right tabular-nums">{dur(r.offMin)}</td>
                          <td className="px-5 py-3 text-right tabular-nums">{dur(r.noSignalMin)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )
            ) : !episodes ? (
              <div className="flex items-center gap-2 p-5 text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin" /> Loading…</div>
            ) : episodes.rows.length === 0 ? (
              <Empty text="Nobody left the fence in this range." />
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="bg-muted/40 text-left text-[11px] uppercase tracking-wide text-muted-foreground">
                      <th className="px-5 py-2.5 font-semibold">Employee</th>
                      <th className="px-3 py-2.5 font-semibold">Date</th>
                      <th className="px-3 py-2.5 font-semibold">Left the zone</th>
                      <th className="px-3 py-2.5 font-semibold">Back / last seen</th>
                      <th className="px-3 py-2.5 text-right font-semibold">Away</th>
                      <th className="px-5 py-2.5 text-right font-semibold">Furthest beyond fence</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border/50">
                    {episodes.rows.map((r, i) => (
                      <tr key={`${r.employeeCode}-${r.date}-${i}`} className="hover:bg-muted/30">
                        <td className="px-5 py-3">
                          <div className="font-medium">{r.name}</div>
                          <div className="text-xs text-muted-foreground">{r.employeeCode} · {r.branch}</div>
                        </td>
                        <td className="whitespace-nowrap px-3 py-3 text-muted-foreground">
                          {new Date(r.date).toLocaleDateString('en-IN', { day: '2-digit', month: 'short' })}
                        </td>
                        <td className="whitespace-nowrap px-3 py-3"><Clock3 className="mr-1 inline h-3.5 w-3.5 text-muted-foreground" />{r.from ?? '—'}</td>
                        <td className="whitespace-nowrap px-3 py-3">{r.to ?? '—'}</td>
                        <td className="px-3 py-3 text-right font-semibold tabular-nums text-rose-600">{dur(r.minutes)}</td>
                        <td className="px-5 py-3 text-right tabular-nums">{r.maxBeyondM} m</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
            <p className="border-t border-border/60 px-5 py-3 text-xs text-muted-foreground">
              A location is recorded every 2 minutes from check-in to check-out. More than 6 minutes without one counts as
              &quot;no signal&quot;; a reading near the fence edge counts as inside.
            </p>
          </section>
        </>
      )}
    </div>
  );
}

function Stat({ icon: Icon, label, value, hint, tone }: {
  icon: React.ComponentType<{ className?: string }>; label: string; value: string; hint?: string; tone: string;
}) {
  return (
    <div className="rounded-2xl border border-border bg-card p-4 shadow-sm">
      <span className={`flex h-9 w-9 items-center justify-center rounded-xl ${tone}`}><Icon className="h-4 w-4" /></span>
      <div className="mt-3 text-xl font-bold tabular-nums">{value}</div>
      <div className="text-xs text-muted-foreground">{label}{hint ? ` · ${hint}` : ''}</div>
    </div>
  );
}

/** One day's minutes as a proportion bar: inside, away, GPS off, no signal. */
function SplitBar({ r }: { r: SummaryRow }) {
  const parts: [number, string, string][] = [
    [r.insideMin, STATE_COLOR.INSIDE, 'Inside'],
    [r.outsideMin, STATE_COLOR.OUTSIDE, 'Away'],
    [r.offMin, STATE_COLOR.OFF, 'GPS off'],
    [r.noSignalMin, STATE_COLOR.NO_SIGNAL, 'No signal'],
  ];
  const total = parts.reduce((n, [m]) => n + m, 0);
  if (!total) return <div className="h-2 w-full rounded-full bg-muted" />;
  return (
    <div className="flex h-2 w-full gap-px overflow-hidden rounded-full bg-muted" title={parts.map(([m, , l]) => `${l} ${dur(m)}`).join(' · ')}>
      {parts.map(([m, c, l]) => m > 0 && <span key={l} style={{ width: `${(m / total) * 100}%`, background: c }} />)}
    </div>
  );
}

function Empty({ text }: { text: string }) {
  return (
    <div className="flex flex-col items-center gap-2 p-10 text-center text-sm text-muted-foreground">
      <Footprints className="h-6 w-6" />
      {text}
    </div>
  );
}
