'use client';

import { useState } from 'react';
import useSWR from 'swr';
import { fetcher, api } from '@/lib/api';
import { PageHero } from '@/components/page-hero';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Check, X, Loader2, CalendarPlus } from 'lucide-react';

interface PendingLeave {
  id: string;
  type: string;
  fromDate: string;
  toDate: string;
  days: number;
  reason: string;
  employee?: { name: string } | null;
}

interface BalanceRow {
  employeeId: string;
  name: string;
  employeeCode: string;
  total: number;
  used: number;
}

const fmt = (d: string) => new Date(d).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });

export default function LeavesPage() {
  const { data, error, isLoading, mutate } = useSWR<{ pending: PendingLeave[] }>(
    '/admin/leaves/pending',
    fetcher,
    { shouldRetryOnError: false },
  );
  const pending = data?.pending ?? [];
  const [busyId, setBusyId] = useState<string | null>(null);

  async function act(id: string, action: 'approve' | 'reject') {
    setBusyId(id);
    try {
      await api(`/admin/leaves/${id}/${action}`, {
        method: 'PATCH',
        body: JSON.stringify({ note: action === 'reject' ? 'Rejected by admin' : 'Approved' }),
      });
      await mutate();
    } catch {
      alert(`Failed to ${action} leave`);
    } finally {
      setBusyId(null);
    }
  }

  return (
    <div className="space-y-6">
      <PageHero title="Leaves" subtitle="Approve requests · live from database" />

      <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
        <Card><CardContent className="p-5"><div className="text-2xl font-bold text-amber-600">{pending.length}</div><div className="text-xs text-muted-foreground">Pending</div></CardContent></Card>
      </div>

      <Card>
        <CardHeader><CardTitle className="text-base">Pending Approvals</CardTitle></CardHeader>
        <CardContent className="space-y-3">
          {isLoading && <div className="flex items-center gap-2 text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin" /> Loading…</div>}
          {error && <div className="text-sm text-destructive">Couldn&apos;t load leaves. Sign in and ensure the backend is running.</div>}
          {!isLoading && !error && pending.length === 0 && (
            <div className="text-sm text-muted-foreground">No pending leave requests. 🎉</div>
          )}
          {pending.map((p) => (
            <div key={p.id} className="flex flex-wrap items-center gap-4 rounded-xl border border-border/60 bg-muted/30 p-4">
              <div className="flex h-10 w-10 items-center justify-center rounded-full brand-gradient text-xs font-bold text-white">
                {(p.employee?.name ?? '?').split(' ').map((n) => n[0]).join('').slice(0, 2)}
              </div>
              <div className="min-w-0 flex-1">
                <div className="font-semibold">{p.employee?.name ?? 'Employee'}</div>
                <div className="text-xs text-muted-foreground">{fmt(p.fromDate)} – {fmt(p.toDate)} · {p.reason}</div>
              </div>
              <span className="chip chip-leave">{p.type} · {p.days}d</span>
              <div className="flex gap-2">
                <button
                  onClick={() => act(p.id, 'approve')}
                  disabled={busyId === p.id}
                  className="flex h-9 w-9 items-center justify-center rounded-lg bg-emerald-50 text-emerald-600 hover:bg-emerald-100 disabled:opacity-50"
                >
                  {busyId === p.id ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />}
                </button>
                <button
                  onClick={() => act(p.id, 'reject')}
                  disabled={busyId === p.id}
                  className="flex h-9 w-9 items-center justify-center rounded-lg bg-rose-50 text-rose-600 hover:bg-rose-100 disabled:opacity-50"
                >
                  <X className="h-4 w-4" />
                </button>
              </div>
            </div>
          ))}
        </CardContent>
      </Card>

      <BalancesCard />
    </div>
  );
}

/** Casual Leave balance per employee for the current year (company uses CL only). */
function BalancesCard() {
  const { data, isLoading, mutate } = useSWR<{ year: number; balances: BalanceRow[] }>(
    '/admin/leaves/balances',
    fetcher,
    { shouldRetryOnError: false },
  );
  const balances = data?.balances ?? [];
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [busyId, setBusyId] = useState<string | null>(null);

  async function save(employeeId: string) {
    const raw = drafts[employeeId];
    if (raw === undefined || raw === '') return;
    const total = Number(raw);
    if (!Number.isFinite(total) || total < 0) { alert('Enter a valid number of days'); return; }
    setBusyId(employeeId);
    try {
      await api(`/admin/leaves/balances/${employeeId}`, { method: 'PUT', body: JSON.stringify({ total }) });
      setDrafts((d) => { const { [employeeId]: _gone, ...rest } = d; return rest; });
      await mutate();
    } catch (e) {
      alert(e instanceof Error ? e.message : 'Failed to update balance');
    } finally {
      setBusyId(null);
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <CalendarPlus className="h-4 w-4" /> Casual Leave Balances {data ? `· ${data.year}` : ''}
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-2">
        {isLoading && <div className="flex items-center gap-2 text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin" /> Loading…</div>}
        {!isLoading && balances.length === 0 && (
          <div className="text-sm text-muted-foreground">No active employees yet.</div>
        )}
        {balances.map((b) => (
          <div key={b.employeeId} className="flex flex-wrap items-center gap-3 rounded-xl border border-border/60 bg-muted/30 px-4 py-2.5">
            <div className="min-w-0 flex-1">
              <span className="font-medium">{b.name}</span>
              <span className="ml-2 text-xs text-muted-foreground">{b.employeeCode}</span>
            </div>
            <span className="chip chip-leave">Used {b.used}</span>
            <span className="text-xs text-muted-foreground">of</span>
            <input
              type="number"
              min={0}
              max={365}
              step={0.5}
              value={drafts[b.employeeId] ?? String(b.total)}
              onChange={(e) => setDrafts((d) => ({ ...d, [b.employeeId]: e.target.value }))}
              className="h-9 w-20 rounded-lg border border-border bg-background px-2 text-sm outline-none focus:ring-2 focus:ring-ring/40"
            />
            <span className="text-xs text-muted-foreground">days CL</span>
            <button
              onClick={() => save(b.employeeId)}
              disabled={busyId === b.employeeId || drafts[b.employeeId] === undefined}
              className="flex h-9 items-center gap-1.5 rounded-lg bg-emerald-600 px-3 text-xs font-semibold text-white hover:bg-emerald-700 disabled:opacity-40"
            >
              {busyId === b.employeeId ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />} Save
            </button>
          </div>
        ))}
        <p className="pt-1 text-xs text-muted-foreground">
          Set each employee&apos;s CL allowance for the year. &quot;Used&quot; increases automatically as approved CL is taken.
        </p>
      </CardContent>
    </Card>
  );
}
