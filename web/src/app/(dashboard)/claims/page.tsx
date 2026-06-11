'use client';

import { useState } from 'react';
import useSWR from 'swr';
import { fetcher, api, apiBlobUrl } from '@/lib/api';
import { PageHero } from '@/components/page-hero';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Check, X, HelpCircle, Image as ImageIcon, FileText, Loader2 } from 'lucide-react';

interface Claim {
  id: string;
  type: string;
  title: string;
  amount: number;
  description?: string | null;
  status: string;
  reviewerNote?: string | null;
  employeeNote?: string | null;
  photoFileId?: string | null;
  photoUrl?: string | null;
  documentFileId?: string | null;
  documentUrl?: string | null;
  createdAt: string;
  employee?: { name: string; employeeCode: string } | null;
}

interface Stats {
  total: number;
  pending: number;
  approved: number;
  rejected: number;
  needsClarification: number;
  totalClaimedAmount: number;
  totalApprovedAmount: number;
  byType: Record<string, number>;
}

const FILTERS = ['ALL', 'PENDING', 'NEEDS_CLARIFICATION', 'APPROVED', 'REJECTED'] as const;
const inr = (n: number) => `₹${n.toLocaleString('en-IN')}`;
const fmt = (d: string) => new Date(d).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });

const statusChip: Record<string, string> = {
  PENDING: 'bg-amber-50 text-amber-700',
  NEEDS_CLARIFICATION: 'bg-indigo-50 text-indigo-700',
  APPROVED: 'bg-emerald-50 text-emerald-700',
  REJECTED: 'bg-rose-50 text-rose-700',
};

export default function ClaimsPage() {
  const [filter, setFilter] = useState<(typeof FILTERS)[number]>('ALL');
  const { data: stats } = useSWR<Stats>('/admin/claims/stats', fetcher, { shouldRetryOnError: false });
  const query = filter === 'ALL' ? '' : `?status=${filter}`;
  const { data, error, isLoading, mutate } = useSWR<{ claims: Claim[] }>(
    `/admin/claims${query}`,
    fetcher,
    { shouldRetryOnError: false },
  );
  const claims = data?.claims ?? [];
  const [busyId, setBusyId] = useState<string | null>(null);

  async function act(id: string, action: 'approve' | 'reject' | 'clarify') {
    let note: string | undefined;
    if (action === 'reject') note = prompt('Reason for rejection?') ?? undefined;
    if (action === 'clarify') note = prompt('What clarification do you need from the employee?') ?? undefined;
    if (action !== 'approve' && !note) return;
    setBusyId(id);
    try {
      await api(`/admin/claims/${id}/${action}`, {
        method: 'PATCH',
        body: JSON.stringify({ note }),
      });
      await mutate();
    } catch {
      alert(`Failed to ${action} claim`);
    } finally {
      setBusyId(null);
    }
  }

  async function viewFile(id: string, which: 'photo' | 'pdf') {
    try {
      const url = await apiBlobUrl(`/claims/${id}/file?which=${which}`);
      window.open(url, '_blank');
    } catch {
      alert('Could not open file');
    }
  }

  return (
    <div className="space-y-6">
      <PageHero title="Claims" subtitle="Monitor, analyze & approve expense claims · live from database" />

      {/* Analytics */}
      <div className="grid grid-cols-2 gap-4 md:grid-cols-4 lg:grid-cols-6">
        <StatCard label="Total" value={stats?.total ?? 0} accent="text-foreground" />
        <StatCard label="Pending" value={stats?.pending ?? 0} accent="text-amber-600" />
        <StatCard label="Clarification" value={stats?.needsClarification ?? 0} accent="text-indigo-600" />
        <StatCard label="Approved" value={stats?.approved ?? 0} accent="text-emerald-600" />
        <StatCard label="Rejected" value={stats?.rejected ?? 0} accent="text-rose-600" />
        <StatCard label="Approved ₹" value={inr(stats?.totalApprovedAmount ?? 0)} accent="text-emerald-600" />
      </div>

      {/* Filters */}
      <div className="flex flex-wrap gap-2">
        {FILTERS.map((f) => (
          <button
            key={f}
            onClick={() => setFilter(f)}
            className={`rounded-lg px-3 py-1.5 text-xs font-semibold transition-colors ${
              filter === f ? 'brand-gradient text-white' : 'border border-border bg-card text-muted-foreground hover:text-foreground'
            }`}
          >
            {f.replace('_', ' ')}
          </button>
        ))}
      </div>

      <Card>
        <CardHeader><CardTitle className="text-base">Claims</CardTitle></CardHeader>
        <CardContent className="space-y-3">
          {isLoading && <div className="flex items-center gap-2 text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin" /> Loading…</div>}
          {error && <div className="text-sm text-destructive">Couldn&apos;t load claims. Sign in and ensure the backend is running.</div>}
          {!isLoading && !error && claims.length === 0 && (
            <div className="text-sm text-muted-foreground">No claims in this view.</div>
          )}
          {claims.map((c) => {
            const hasPhoto = !!(c.photoFileId || c.photoUrl);
            const hasPdf = !!(c.documentFileId || c.documentUrl);
            const open = c.status === 'PENDING' || c.status === 'NEEDS_CLARIFICATION';
            return (
              <div key={c.id} className="flex flex-wrap items-center gap-4 rounded-xl border border-border/60 bg-muted/30 p-4">
                <div className="flex h-10 w-10 items-center justify-center rounded-full brand-gradient text-xs font-bold text-white">
                  {(c.employee?.name ?? '?').split(' ').map((n) => n[0]).join('').slice(0, 2)}
                </div>
                <div className="min-w-0 flex-1">
                  <div className="font-semibold">{c.title} · <span className="text-muted-foreground">{c.employee?.name ?? 'Employee'}</span></div>
                  <div className="text-xs text-muted-foreground">{c.type} · {fmt(c.createdAt)}{c.description ? ` · ${c.description}` : ''}</div>
                  {c.status === 'NEEDS_CLARIFICATION' && c.reviewerNote && (
                    <div className="mt-1 text-xs text-indigo-600">Asked: {c.reviewerNote}</div>
                  )}
                  {c.status === 'REJECTED' && c.reviewerNote && (
                    <div className="mt-1 text-xs text-rose-600">Reason: {c.reviewerNote}</div>
                  )}
                  {c.employeeNote && <div className="mt-1 text-xs text-muted-foreground">Reply: {c.employeeNote}</div>}
                </div>

                <div className="font-bold">{inr(c.amount)}</div>
                <span className={`rounded-full px-2.5 py-1 text-[11px] font-semibold ${statusChip[c.status] ?? 'bg-muted text-muted-foreground'}`}>
                  {c.status.replace('_', ' ')}
                </span>

                <div className="flex gap-2">
                  {hasPhoto && (
                    <button onClick={() => viewFile(c.id, 'photo')} title="View photo" className="flex h-9 w-9 items-center justify-center rounded-lg border border-border bg-card text-muted-foreground hover:text-foreground">
                      <ImageIcon className="h-4 w-4" />
                    </button>
                  )}
                  {hasPdf && (
                    <button onClick={() => viewFile(c.id, 'pdf')} title="View PDF" className="flex h-9 w-9 items-center justify-center rounded-lg border border-border bg-card text-muted-foreground hover:text-foreground">
                      <FileText className="h-4 w-4" />
                    </button>
                  )}
                  {open && (
                    <>
                      <button onClick={() => act(c.id, 'approve')} disabled={busyId === c.id} title="Approve" className="flex h-9 w-9 items-center justify-center rounded-lg bg-emerald-50 text-emerald-600 hover:bg-emerald-100 disabled:opacity-50">
                        {busyId === c.id ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />}
                      </button>
                      <button onClick={() => act(c.id, 'clarify')} disabled={busyId === c.id} title="Request clarification" className="flex h-9 w-9 items-center justify-center rounded-lg bg-indigo-50 text-indigo-600 hover:bg-indigo-100 disabled:opacity-50">
                        <HelpCircle className="h-4 w-4" />
                      </button>
                      <button onClick={() => act(c.id, 'reject')} disabled={busyId === c.id} title="Reject" className="flex h-9 w-9 items-center justify-center rounded-lg bg-rose-50 text-rose-600 hover:bg-rose-100 disabled:opacity-50">
                        <X className="h-4 w-4" />
                      </button>
                    </>
                  )}
                </div>
              </div>
            );
          })}
        </CardContent>
      </Card>
    </div>
  );
}

function StatCard({ label, value, accent }: { label: string; value: number | string; accent: string }) {
  return (
    <Card>
      <CardContent className="p-5">
        <div className={`text-2xl font-bold ${accent}`}>{value}</div>
        <div className="text-xs text-muted-foreground">{label}</div>
      </CardContent>
    </Card>
  );
}
