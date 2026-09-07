'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import {
  Building2, KeyRound, Loader2, RefreshCw, ScrollText, UserCog, X,
} from 'lucide-react';
import { platformApi, type AuditEntry, type AuditPage } from '@/lib/platform-api';
import {
  actionLabel, dayHeading, describeActivity, exactTime, relativeTime,
  type ActivityKind, type ActivityTone,
} from '@/lib/platform-activity';

const PAGE_SIZE = 50;

interface Filters {
  tenantId: string;
  actorId: string;
  action: string;
}

const NO_FILTERS: Filters = { tenantId: '', actorId: '', action: '' };

/**
 * The platform activity log.
 *
 * Every account that can reach this console can also create a dealer, suspend
 * one, and reset any dealer administrator's password. That power is the reason
 * the log exists, and a log nobody can read is not an accountability measure —
 * so this page is the counterpart to the Team page's promise that "every action
 * is recorded".
 *
 * Filtering happens on the server. The log is small today and could be filtered
 * in the browser, but only for as long as it all fits in one response, and the
 * point at which that stops being true is exactly the point at which someone is
 * relying on this page.
 */
export default function ActivityPage() {
  const [entries, setEntries] = useState<AuditEntry[] | null>(null);
  const [options, setOptions] = useState<AuditPage['filters']>();
  // Null until the query string has been read — see the effect below.
  const [filters, setFilters] = useState<Filters | null>(null);
  const [cursor, setCursor] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  /**
   * Which request the screen is currently showing.
   *
   * "Show older entries" and a filter change can be in flight together, and an
   * older page arriving late must not be appended to a list it does not belong
   * to — the reader would see another dealer's entries under their filter.
   */
  const generation = useRef(0);

  const query = useCallback((f: Filters, after?: string) => {
    const params = new URLSearchParams({ limit: String(PAGE_SIZE) });
    if (f.tenantId) params.set('tenantId', f.tenantId);
    if (f.actorId) params.set('actorId', f.actorId);
    if (f.action) params.set('action', f.action);
    if (after) params.set('cursor', after);
    return `/audit?${params}`;
  }, []);

  /** Load the first page for a set of filters, replacing whatever is on screen. */
  const load = useCallback(async (f: Filters) => {
    const mine = ++generation.current;
    setError(null);
    setBusy(true);
    try {
      const page = await platformApi.get<AuditPage>(query(f));
      if (mine !== generation.current) return;
      setEntries(page.entries);
      setCursor(page.nextCursor);
      // Options describe the whole log, so they only arrive with a first page —
      // keep the ones we have if a later response omits them.
      if (page.filters) setOptions(page.filters);
    } catch (err) {
      if (mine !== generation.current) return;
      setError(err instanceof Error ? err.message : 'Could not load the activity log');
    } finally {
      if (mine === generation.current) setBusy(false);
    }
  }, [query]);

  /**
   * Start from the query string, so "all activity for this dealer" is a link
   * someone can follow and send on. Read once on mount rather than through
   * useSearchParams: this whole console is client-rendered, and the hook would
   * only add a prerender constraint for a value we already have.
   */
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    setFilters({
      tenantId: params.get('tenantId') ?? '',
      actorId: params.get('actorId') ?? '',
      action: params.get('action') ?? '',
    });
  }, []);

  useEffect(() => {
    if (!filters) return;
    void load(filters);
  }, [load, filters]);

  /** Keep the address bar in step, without a navigation. */
  function apply(next: Filters) {
    setFilters(next);
    const params = new URLSearchParams(
      Object.entries(next).filter(([, v]) => v !== '') as [string, string][],
    );
    const search = params.toString();
    window.history.replaceState(null, '', search ? `?${search}` : window.location.pathname);
  }

  async function loadMore() {
    if (!cursor || !filters) return;
    const mine = generation.current;
    setLoadingMore(true);
    try {
      const page = await platformApi.get<AuditPage>(query(filters, cursor));
      if (mine !== generation.current) return;
      setEntries((current) => [...(current ?? []), ...page.entries]);
      setCursor(page.nextCursor);
    } catch (err) {
      if (mine !== generation.current) return;
      setError(err instanceof Error ? err.message : 'Could not load more entries');
    } finally {
      setLoadingMore(false);
    }
  }

  async function refresh() {
    if (!filters) return;
    setRefreshing(true);
    await load(filters);
    setRefreshing(false);
  }

  const active = filters ?? NO_FILTERS;
  const filtered = active.tenantId !== '' || active.actorId !== '' || active.action !== '';

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold">Activity</h1>
          <p className="text-sm text-muted-foreground">
            Every action taken in this console — who did it, to which dealer, and when. A dealer&rsquo;s
            own staff&rsquo;s activity is recorded in their workspace, not here.
          </p>
        </div>
        <button
          onClick={refresh}
          disabled={refreshing}
          className="flex items-center gap-2 rounded-xl border border-border px-3 py-2 text-sm font-medium hover:bg-muted disabled:opacity-60"
        >
          <RefreshCw className={`h-4 w-4 ${refreshing ? 'animate-spin' : ''}`} /> Refresh
        </button>
      </div>

      {error && <p className="rounded-xl bg-destructive/10 p-3 text-sm text-destructive">{error}</p>}

      <div className="flex flex-wrap items-center gap-2">
        <Select
          value={active.tenantId}
          onChange={(tenantId) => apply({ ...active, tenantId })}
          all="All dealers"
          options={(options?.dealers ?? []).map((d) => ({ value: d.id, label: d.name, count: d.count }))}
        />
        <Select
          value={active.actorId}
          onChange={(actorId) => apply({ ...active, actorId })}
          all="Anyone"
          options={(options?.actors ?? []).map((a) => ({ value: a.id, label: a.name, count: a.count }))}
        />
        <Select
          value={active.action}
          onChange={(action) => apply({ ...active, action })}
          all="Every action"
          options={(options?.actions ?? []).map((a) => ({
            value: a.action, label: actionLabel(a.action), count: a.count,
          }))}
        />
        {filtered && (
          <button
            onClick={() => apply(NO_FILTERS)}
            className="inline-flex items-center gap-1.5 rounded-xl px-2.5 py-2 text-sm text-muted-foreground hover:text-foreground"
          >
            <X className="h-3.5 w-3.5" /> Clear
          </button>
        )}
      </div>

      {/*
        * One region for the results, whatever they are.
        *
        * aria-busy sits here rather than on the list, so the signal survives a
        * filter that empties it — and the rows stay put but go quiet while a
        * request is in flight, because until it lands they are still the
        * previous filter's answer and should not be read as this one's.
        */}
      <div
        aria-busy={busy}
        className={`space-y-4 transition-opacity ${busy ? 'pointer-events-none opacity-40' : ''}`}
      >
        {entries === null ? (
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" /> Loading activity…
          </div>
        ) : entries.length === 0 ? (
          <Empty filtered={filtered} onClear={() => apply(NO_FILTERS)} />
        ) : (
          <>
            <Timeline entries={entries} showDealer={active.tenantId === ''} />

            {cursor ? (
              <button
                onClick={loadMore}
                disabled={loadingMore}
                className="w-full rounded-xl border border-border py-2.5 text-sm font-medium hover:bg-muted disabled:opacity-60"
              >
                {loadingMore ? 'Loading…' : 'Show older entries'}
              </button>
            ) : (
              <p className="text-center text-xs text-muted-foreground">
                That is the whole log{filtered ? ' for this filter' : ''} — {entries.length}{' '}
                {entries.length === 1 ? 'entry' : 'entries'}.
              </p>
            )}
          </>
        )}
      </div>
    </div>
  );
}

/** Entries under a heading per day, newest first. */
function Timeline({ entries, showDealer }: { entries: AuditEntry[]; showDealer: boolean }) {
  const days: { heading: string; rows: AuditEntry[] }[] = [];
  for (const entry of entries) {
    const heading = dayHeading(entry.timestamp);
    const last = days[days.length - 1];
    if (last?.heading === heading) last.rows.push(entry);
    else days.push({ heading, rows: [entry] });
  }

  return (
    <div className="space-y-5">
      {days.map((day) => (
        <section key={day.heading}>
          <h2 className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            {day.heading}
          </h2>
          <ol className="overflow-hidden rounded-2xl border border-border bg-card">
            {day.rows.map((entry) => (
              <Row key={entry.id} entry={entry} showDealer={showDealer} />
            ))}
          </ol>
        </section>
      ))}
    </div>
  );
}

function Row({ entry, showDealer }: { entry: AuditEntry; showDealer: boolean }) {
  const { title, detail, kind, tone } = describeActivity(entry);
  const Icon = ICONS[kind];

  return (
    <li className="flex gap-3 border-b border-border px-4 py-3 last:border-b-0">
      <span className={`mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-full ${TONE[tone]}`}>
        <Icon className="h-4 w-4" />
      </span>

      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-baseline gap-x-2 text-sm">
          <span className="font-medium">{title}</span>
          {detail && <span className="text-muted-foreground">{detail}</span>}
        </div>

        <div className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted-foreground">
          <span>{entry.actorName}</span>
          {showDealer && entry.targetTenantId && (
            <>
              <span aria-hidden>·</span>
              {entry.tenantName ? (
                <Link
                  href={`/platform/dealers/${entry.targetTenantId}`}
                  className="rounded-md bg-muted px-1.5 py-0.5 font-medium text-foreground hover:bg-muted/70"
                >
                  {entry.tenantName}
                </Link>
              ) : (
                // The dealer is gone; the entry is still the record that it existed.
                <span className="rounded-md bg-muted px-1.5 py-0.5">A deleted dealer</span>
              )}
            </>
          )}
          {entry.ipAddress && (
            <>
              <span aria-hidden>·</span>
              <span className="font-mono">{entry.ipAddress}</span>
            </>
          )}
        </div>
      </div>

      <time
        dateTime={entry.timestamp}
        title={exactTime(entry.timestamp)}
        className="shrink-0 whitespace-nowrap text-xs text-muted-foreground"
      >
        {relativeTime(entry.timestamp)}
      </time>
    </li>
  );
}

const ICONS: Record<ActivityKind, typeof Building2> = {
  dealer: Building2,
  access: UserCog,
  credential: KeyRound,
  other: ScrollText,
};

/**
 * Colour marks what was granted and what was taken away. Everything else stays
 * grey on purpose — if every row is coloured, none of them stands out.
 */
const TONE: Record<ActivityTone, string> = {
  grant: 'bg-emerald-100 text-emerald-700',
  revoke: 'bg-amber-100 text-amber-700',
  neutral: 'bg-muted text-muted-foreground',
};

function Empty({ filtered, onClear }: { filtered: boolean; onClear: () => void }) {
  return (
    <div className="rounded-2xl border border-dashed border-border p-8 text-center">
      <ScrollText className="mx-auto h-8 w-8 text-muted-foreground/50" />
      <p className="mt-3 text-sm text-muted-foreground">
        {filtered
          ? 'Nothing matches these filters.'
          : 'Nothing recorded yet. Entries appear from the next change made here — dealers created before this console existed have no history.'}
      </p>
      {filtered && (
        <button onClick={onClear} className="mt-3 text-sm font-medium underline underline-offset-4">
          Clear the filters
        </button>
      )}
    </div>
  );
}

function Select({
  value,
  onChange,
  all,
  options,
}: {
  value: string;
  onChange: (value: string) => void;
  all: string;
  options: { value: string; label: string; count: number }[];
}) {
  return (
    <select
      value={value}
      onChange={(e) => onChange(e.target.value)}
      disabled={options.length === 0}
      className="rounded-xl border border-border bg-card px-3 py-2 text-sm outline-none focus:border-primary disabled:opacity-50"
    >
      <option value="">{all}</option>
      {options.map((o) => (
        <option key={o.value} value={o.value}>
          {o.label} ({o.count})
        </option>
      ))}
    </select>
  );
}
