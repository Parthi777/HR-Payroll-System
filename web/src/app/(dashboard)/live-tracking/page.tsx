'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import useSWR from 'swr';
import dynamic from 'next/dynamic';
import { fetcher } from '@/lib/api';
import { PageHero } from '@/components/page-hero';
import { ServerExports } from '@/components/server-exports';
import { can, currentRole, SETUP_ROLES } from '@/lib/permissions';
import { useLiveTracking, type TrackState, type TrackedEmployee } from '@/hooks/useApi';
import type { TrackPoint } from '@/components/live-tracking-map';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Loader2, Radar, MapPinOff, SignalZero, X } from 'lucide-react';

// Leaflet touches `window`, so load the map only on the client.
const LiveTrackingMap = dynamic(() => import('@/components/live-tracking-map'), {
  ssr: false,
  loading: () => (
    <div className="flex h-[440px] items-center justify-center rounded-2xl bg-muted/40 text-muted-foreground">
      Loading map…
    </div>
  ),
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

const th = 'px-4 py-3 font-medium';
const td = 'px-4 py-3';
const heroSelect = 'h-10 rounded-xl bg-white/15 px-3 text-sm text-white ring-1 ring-white/25 [&>option]:text-black';
const input = 'h-9 rounded-lg border border-border bg-background px-3 text-sm';

const iso = (d: Date) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
const time = (s: string | null) => (s ? new Date(s).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' }) : '—');

/** 0 → "—", 23 → "23 min", 125 → "2h 05m". */
function dur(min: number) {
  if (!min || min <= 0) return '—';
  if (min < 60) return `${Math.round(min)} min`;
  return `${Math.floor(min / 60)}h ${String(Math.round(min % 60)).padStart(2, '0')}m`;
}

const CHIP: Record<TrackState, string> = {
  INSIDE: 'chip-present',
  OUTSIDE: 'chip-off',
  OFF: 'chip-half',
  NO_SIGNAL: 'chip-half',
};
const LABEL: Record<TrackState, string> = { INSIDE: 'Inside', OUTSIDE: 'Away', OFF: 'GPS off', NO_SIGNAL: 'No signal' };

function StateChip({ state }: { state: TrackState }) {
  return <span className={`chip ${CHIP[state]}`}>{LABEL[state]}</span>;
}

export default function LiveTrackingPage() {
  const isBranchManager = currentRole() === 'BRANCH_MANAGER';
  const [branchId, setBranchId] = useState('');
  const [selected, setSelected] = useState<string | null>(null);
  const { data, isLoading, isLive } = useLiveTracking(branchId);
  const { data: br } = useSWR<{ branches: Named[] }>(isBranchManager ? null : '/admin/branches', fetcher, { shouldRetryOnError: false });

  // Re-render every 30s so "away for 23 min" keeps counting between polls.
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 30_000);
    return () => clearInterval(t);
  }, []);
  const since = (e: TrackedEmployee) => (now - new Date(e.since).getTime()) / 60_000;

  const { data: track } = useSWR<TrackDetail>(
    selected ? `/admin/tracking/${selected}/track` : null,
    fetcher,
    { refreshInterval: 60_000, shouldRetryOnError: false },
  );

  const employees = data?.enabled ? data.employees : [];
  const away = employees.filter((e) => e.state === 'OUTSIDE').sort((a, b) => a.since.localeCompare(b.since));
  const silent = employees.filter((e) => e.state === 'OFF' || e.state === 'NO_SIGNAL').sort((a, b) => a.since.localeCompare(b.since));
  const inside = employees.filter((e) => e.state === 'INSIDE').length;
  const selectedEmp = employees.find((e) => e.attendanceId === selected);

  return (
    <div className="space-y-6">
      <PageHero title="Live Tracking" subtitle="Where checked-in staff are, and who is away from the geofence">
        <span className="rounded-full bg-white/15 px-3 py-1 text-xs font-semibold">
          {isLive ? '● Live · every 30 s' : 'Offline'}
        </span>
        {!isBranchManager && (
          <select value={branchId} onChange={(e) => { setBranchId(e.target.value); setSelected(null); }} className={heroSelect}>
            <option value="">All branches</option>
            {br?.branches.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
          </select>
        )}
      </PageHero>

      {isLoading && !data && (
        <div className="flex items-center gap-2 text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin" /> Loading…</div>
      )}

      {data && !data.enabled && (
        <Card>
          <CardContent className="flex flex-col items-start gap-3 p-6">
            <Radar className="h-8 w-8 text-muted-foreground" />
            <div>
              <h2 className="text-base font-semibold">Live tracking is off</h2>
              <p className="mt-1 max-w-xl text-sm text-muted-foreground">
                When it is on, the employee app records each person&apos;s location every 2 minutes from check-in until
                check-out, and this page shows where everyone is and how long anyone has been away from their branch.
                Staff are told on their phone when monitoring starts and stops.
              </p>
            </div>
            {can(SETUP_ROLES) && (
              <Link href="/settings" className="rounded-lg bg-brand-600 px-4 py-2 text-sm font-semibold text-white hover:bg-brand-700">
                Turn it on in Settings
              </Link>
            )}
          </CardContent>
        </Card>
      )}

      {data?.enabled && (
        <>
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            <Kpi label="Tracked now" value={employees.length} />
            <Kpi label="Inside the fence" value={inside} tint="text-emerald-600" />
            <Kpi label="Away now" value={away.length} tint="text-rose-600" />
            <Kpi label="GPS off / no signal" value={silent.length} tint="text-amber-600" />
          </div>
          {data.untrackedCheckedIn > 0 && (
            <p className="-mt-3 text-xs text-muted-foreground">
              {data.untrackedCheckedIn} more checked in without tracking — exempt staff, kiosk or manual punches.
            </p>
          )}

          <div className="grid gap-6 lg:grid-cols-3">
            <Card className="lg:col-span-2">
              <CardContent className="p-3">
                <LiveTrackingMap
                  branches={data.branches}
                  employees={employees}
                  selected={selected}
                  path={track?.points ?? []}
                  onSelect={setSelected}
                />
              </CardContent>
            </Card>

            <div className="space-y-6">
              <PeopleList
                title="Away now"
                icon={<MapPinOff className="h-4 w-4 text-rose-600" />}
                empty="Nobody is outside their branch."
                people={away}
                detail={(e) => `away ${dur(since(e))}${e.last?.distance != null ? ` · ${Math.round(e.last.distance)} m from centre` : ''}`}
                onSelect={setSelected}
                selected={selected}
              />
              <PeopleList
                title="GPS off / no signal"
                icon={<SignalZero className="h-4 w-4 text-amber-600" />}
                empty="Every tracked phone is reporting."
                people={silent}
                detail={(e) => `${LABEL[e.state].toLowerCase()} for ${dur(since(e))}${e.last ? ` · last seen ${time(e.last.ts)}` : ' · no fix yet'}`}
                onSelect={setSelected}
                selected={selected}
              />
            </div>
          </div>

          {selected && (
            <Card>
              <CardHeader className="flex flex-row items-center justify-between space-y-0">
                <CardTitle className="text-base">
                  {selectedEmp?.name ?? track?.employee.name ?? 'Employee'}{' '}
                  <span className="text-sm font-normal text-muted-foreground">
                    {track ? `${time(track.window.from)} – ${track.window.open ? 'now' : time(track.window.to)}` : ''}
                  </span>
                </CardTitle>
                <button onClick={() => setSelected(null)} className="rounded-lg p-1.5 hover:bg-muted" title="Close">
                  <X className="h-4 w-4" />
                </button>
              </CardHeader>
              <CardContent>
                {!track && <div className="flex items-center gap-2 text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin" /> Loading path…</div>}
                {track && (
                  <div className="space-y-4">
                    <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                      <Mini label="Inside" value={dur(track.summary.insideMin)} />
                      <Mini label="Away" value={dur(track.summary.outsideMin)} tint="text-rose-600" />
                      <Mini label="GPS off" value={dur(track.summary.offMin)} />
                      <Mini label="No signal" value={dur(track.summary.noSignalMin)} />
                    </div>
                    {track.summary.mockFixes > 0 && (
                      <p className="text-sm font-medium text-amber-700">
                        {track.summary.mockFixes} reading(s) came from a fake-location app and were not trusted.
                      </p>
                    )}
                    <div>
                      <h4 className="mb-2 text-sm font-semibold">Times away from the fence</h4>
                      {track.summary.episodes.length === 0 ? (
                        <p className="text-sm text-muted-foreground">None so far.</p>
                      ) : (
                        <ul className="divide-y divide-border/60 text-sm">
                          {track.summary.episodes.map((ep) => (
                            <li key={ep.from} className="flex justify-between py-2">
                              <span>{time(ep.from)} – {time(ep.to)}</span>
                              <span className="text-muted-foreground">{dur(ep.minutes)} · up to {ep.maxBeyondM} m beyond the fence</span>
                            </li>
                          ))}
                        </ul>
                      )}
                    </div>
                  </div>
                )}
              </CardContent>
            </Card>
          )}

          <Card>
            <CardHeader><CardTitle className="text-base">Checked in today</CardTitle></CardHeader>
            <CardContent className="p-0">
              {employees.length === 0 ? (
                <div className="p-6 text-sm text-muted-foreground">Nobody tracked is checked in right now.</div>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead><tr className="border-b border-border/60 text-left text-xs uppercase tracking-wide text-muted-foreground">
                      <th className={th}>Employee</th><th className={th}>Branch</th><th className={th}>Check-in</th>
                      <th className={th}>Now</th><th className={th}>Inside</th><th className={th}>Away</th>
                      <th className={th}>Times away</th><th className={th}>GPS off</th><th className={th}>No signal</th>
                      <th className={th}>Last seen</th>
                    </tr></thead>
                    <tbody>
                      {[...employees].sort((a, b) => b.outsideMin - a.outsideMin).map((e) => (
                        <tr
                          key={e.attendanceId}
                          onClick={() => setSelected(e.attendanceId)}
                          className={`cursor-pointer border-b border-border/40 last:border-0 hover:bg-muted/40 ${e.attendanceId === selected ? 'bg-brand-50 dark:bg-brand-950/30' : ''}`}
                        >
                          <td className={`${td} font-medium`}>{e.name} <span className="text-xs text-muted-foreground">{e.employeeCode}</span></td>
                          <td className={`${td} text-muted-foreground`}>{e.branch}</td>
                          <td className={td}>{time(e.checkIn)}</td>
                          <td className={td}><StateChip state={e.state} /></td>
                          <td className={td}>{dur(e.insideMin)}</td>
                          <td className={`${td} font-semibold text-rose-600`}>{dur(e.outsideMin)}</td>
                          <td className={td}>{e.episodes || '—'}</td>
                          <td className={td}>{dur(e.offMin)}</td>
                          <td className={td}>{dur(e.noSignalMin)}</td>
                          <td className={`${td} text-muted-foreground`}>{e.last ? time(e.last.ts) : 'no fix yet'}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </CardContent>
          </Card>
        </>
      )}

      {data && <TrackingReport isBranchManager={isBranchManager} />}
    </div>
  );
}

function Kpi({ label, value, tint = '' }: { label: string; value: number; tint?: string }) {
  return (
    <Card><CardContent className="p-5">
      <div className={`text-2xl font-bold ${tint}`}>{value}</div>
      <div className="text-xs text-muted-foreground">{label}</div>
    </CardContent></Card>
  );
}

function Mini({ label, value, tint = '' }: { label: string; value: string; tint?: string }) {
  return (
    <div className="rounded-xl bg-muted/40 p-3">
      <div className={`text-lg font-semibold ${tint}`}>{value}</div>
      <div className="text-xs text-muted-foreground">{label}</div>
    </div>
  );
}

function PeopleList({ title, icon, empty, people, detail, onSelect, selected }: {
  title: string; icon: React.ReactNode; empty: string; people: TrackedEmployee[];
  detail: (e: TrackedEmployee) => string; onSelect: (id: string) => void; selected: string | null;
}) {
  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="flex items-center gap-2 text-base">{icon} {title} <span className="text-sm font-normal text-muted-foreground">({people.length})</span></CardTitle>
      </CardHeader>
      <CardContent className="p-0">
        {people.length === 0 ? (
          <p className="px-6 pb-5 text-sm text-muted-foreground">{empty}</p>
        ) : (
          <ul className="max-h-64 divide-y divide-border/60 overflow-y-auto">
            {people.map((e) => (
              <li key={e.attendanceId}>
                <button
                  onClick={() => onSelect(e.attendanceId)}
                  className={`w-full px-6 py-2.5 text-left hover:bg-muted/40 ${e.attendanceId === selected ? 'bg-muted/60' : ''}`}
                >
                  <div className="text-sm font-medium">{e.name} <span className="text-xs text-muted-foreground">{e.branch}</span></div>
                  <div className="text-xs text-muted-foreground">{detail(e)}</div>
                </button>
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}

/** Any range up to 31 days, one row per tracked day or per stretch away — downloadable. */
function TrackingReport({ isBranchManager }: { isBranchManager: boolean }) {
  const today = iso(new Date());
  const [from, setFrom] = useState(today);
  const [to, setTo] = useState(today);
  const [view, setView] = useState<'summary' | 'episodes'>('summary');
  const [branchId, setBranchId] = useState('');
  const [departmentId, setDepartmentId] = useState('');
  const [designationId, setDesignationId] = useState('');
  const opts = { shouldRetryOnError: false };
  const { data: br } = useSWR<{ branches: Named[] }>(isBranchManager ? null : '/admin/branches', fetcher, opts);
  const { data: dp } = useSWR<{ departments: Named[] }>('/admin/departments', fetcher, opts);
  const { data: dg } = useSWR<{ designations: Named[] }>('/admin/designations', fetcher, opts);

  const span = (new Date(to).getTime() - new Date(from).getTime()) / 86_400_000;
  const rangeError = span < 0 ? '"From" must be on or before "To".' : span > 30 ? 'Pick at most 31 days.' : null;
  const path =
    `/admin/reports/tracking?from=${from}&to=${to}&view=${view}` +
    (branchId ? `&branchId=${branchId}` : '') +
    (departmentId ? `&departmentId=${departmentId}` : '') +
    (designationId ? `&designationId=${designationId}` : '');
  const { data, isLoading, error } = useSWR<{ rows: (SummaryRow | EpisodeRow)[] }>(rangeError ? null : path, fetcher, opts);
  const rows = data?.rows ?? [];

  return (
    <Card>
      <CardHeader className="flex flex-row flex-wrap items-center justify-between gap-2 space-y-0">
        <CardTitle className="text-base">Report — time away from the geofence</CardTitle>
        {!rangeError && <ServerExports path={path} filename={`${view === 'summary' ? 'live-tracking' : 'away-episodes'}-${from}_${to}`} />}
      </CardHeader>
      <CardContent className="space-y-4 p-0">
        <div className="flex flex-wrap items-end gap-2 px-6">
          <label className="text-xs text-muted-foreground">From<br />
            <input type="date" value={from} max={today} onChange={(e) => setFrom(e.target.value)} className={input} />
          </label>
          <label className="text-xs text-muted-foreground">To<br />
            <input type="date" value={to} max={today} onChange={(e) => setTo(e.target.value)} className={input} />
          </label>
          {!isBranchManager && (
            <select value={branchId} onChange={(e) => setBranchId(e.target.value)} className={input}>
              <option value="">All branches</option>
              {br?.branches.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
            </select>
          )}
          <select value={departmentId} onChange={(e) => setDepartmentId(e.target.value)} className={input}>
            <option value="">All departments</option>
            {dp?.departments.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
          </select>
          <select value={designationId} onChange={(e) => setDesignationId(e.target.value)} className={input}>
            <option value="">All designations</option>
            {dg?.designations.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
          </select>
          <div className="flex overflow-hidden rounded-lg border border-border text-xs font-semibold">
            {(['summary', 'episodes'] as const).map((v) => (
              <button
                key={v}
                onClick={() => setView(v)}
                className={`h-9 px-3 ${view === v ? 'bg-brand-600 text-white' : 'hover:bg-muted'}`}
              >
                {v === 'summary' ? 'Per day' : 'Each time away'}
              </button>
            ))}
          </div>
        </div>

        {rangeError && <p className="px-6 pb-5 text-sm text-destructive">{rangeError}</p>}
        {!rangeError && isLoading && <div className="flex items-center gap-2 px-6 pb-5 text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin" /> Loading…</div>}
        {!rangeError && error && <p className="px-6 pb-5 text-sm text-destructive">{error instanceof Error ? error.message : 'Could not load the report'}</p>}
        {!rangeError && data && rows.length === 0 && (
          <p className="px-6 pb-5 text-sm text-muted-foreground">
            {view === 'summary' ? 'No tracked days in this range.' : 'Nobody left the fence in this range.'}
          </p>
        )}
        {!rangeError && rows.length > 0 && (
          <div className="overflow-x-auto border-t border-border/60">
            <table className="w-full text-sm">
              {view === 'summary' ? (
                <>
                  <thead><tr className="border-b border-border/60 text-left text-xs uppercase tracking-wide text-muted-foreground">
                    <th className={th}>Date</th><th className={th}>Employee</th><th className={th}>Branch</th>
                    <th className={th}>In</th><th className={th}>Out</th><th className={th}>Tracked</th>
                    <th className={th}>Inside</th><th className={th}>Away</th><th className={th}>Times away</th>
                    <th className={th}>Longest</th><th className={th}>GPS off</th><th className={th}>No signal</th>
                  </tr></thead>
                  <tbody>
                    {(rows as SummaryRow[]).map((r) => (
                      <tr key={r.attendanceId} className="border-b border-border/40 last:border-0 hover:bg-muted/40">
                        <td className={td}>{r.date}</td>
                        <td className={`${td} font-medium`}>{r.name} <span className="text-xs text-muted-foreground">{r.employeeCode}</span></td>
                        <td className={`${td} text-muted-foreground`}>{r.branch}</td>
                        <td className={td}>{r.checkIn ?? '—'}</td>
                        <td className={td}>{r.checkOut ?? '—'}</td>
                        <td className={td}>{dur(r.trackedMin)}</td>
                        <td className={td}>{dur(r.insideMin)}</td>
                        <td className={`${td} font-semibold text-rose-600`}>{dur(r.outsideMin)}</td>
                        <td className={td}>{r.episodes || '—'}</td>
                        <td className={td}>{dur(r.longestAwayMin)}</td>
                        <td className={td}>{dur(r.offMin)}</td>
                        <td className={td}>{dur(r.noSignalMin)}</td>
                      </tr>
                    ))}
                  </tbody>
                </>
              ) : (
                <>
                  <thead><tr className="border-b border-border/60 text-left text-xs uppercase tracking-wide text-muted-foreground">
                    <th className={th}>Date</th><th className={th}>Employee</th><th className={th}>Branch</th>
                    <th className={th}>Left zone</th><th className={th}>Back / last seen</th><th className={th}>Away</th>
                    <th className={th}>Max beyond fence</th>
                  </tr></thead>
                  <tbody>
                    {(rows as EpisodeRow[]).map((r, i) => (
                      <tr key={`${r.employeeCode}-${r.date}-${i}`} className="border-b border-border/40 last:border-0 hover:bg-muted/40">
                        <td className={td}>{r.date}</td>
                        <td className={`${td} font-medium`}>{r.name} <span className="text-xs text-muted-foreground">{r.employeeCode}</span></td>
                        <td className={`${td} text-muted-foreground`}>{r.branch}</td>
                        <td className={td}>{r.from ?? '—'}</td>
                        <td className={td}>{r.to ?? '—'}</td>
                        <td className={`${td} font-semibold text-rose-600`}>{dur(r.minutes)}</td>
                        <td className={td}>{r.maxBeyondM} m</td>
                      </tr>
                    ))}
                  </tbody>
                </>
              )}
            </table>
          </div>
        )}
        <p className="px-6 pb-5 text-xs text-muted-foreground">
          A location is recorded every 2 minutes from check-in to check-out. More than 6 minutes without one counts as
          &quot;no signal&quot;; a reading near the fence edge counts as inside.
        </p>
      </CardContent>
    </Card>
  );
}
