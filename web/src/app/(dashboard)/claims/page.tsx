'use client';

import { useEffect, useState } from 'react';
import useSWR from 'swr';
import { fetcher, api, apiBlobUrl } from '@/lib/api';
import { PageHero } from '@/components/page-hero';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import {
  Check, X, HelpCircle, Image as ImageIcon, FileText, Loader2, Printer, Banknote, Send,
} from 'lucide-react';

interface ClaimMessage {
  id: string;
  senderRole: 'ADMIN' | 'EMPLOYEE';
  senderName: string;
  message: string;
  createdAt: string;
}

interface Claim {
  id: string;
  type: string;
  title: string;
  amount: number;
  description?: string | null;
  status: string;
  reviewerNote?: string | null;
  employeeNote?: string | null;
  reviewerName?: string | null;
  reviewedAt?: string | null;
  paidByName?: string | null;
  paidAt?: string | null;
  paidNote?: string | null;
  photoFileId?: string | null;
  photoUrl?: string | null;
  documentFileId?: string | null;
  documentUrl?: string | null;
  createdAt: string;
  employee?: { name: string; employeeCode: string; branch?: { name: string } | null } | null;
  messages?: ClaimMessage[];
}

interface Stats {
  total: number;
  pending: number;
  approved: number;
  rejected: number;
  needsClarification: number;
  paid: number;
  totalClaimedAmount: number;
  totalApprovedAmount: number;
  totalPaidAmount: number;
  byType: Record<string, number>;
}

const FILTERS = ['ALL', 'PENDING', 'NEEDS_CLARIFICATION', 'APPROVED', 'PAID', 'REJECTED'] as const;
const inr = (n: number) => `₹${n.toLocaleString('en-IN')}`;
const fmt = (d: string) => new Date(d).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });
const fmtFull = (d: string) =>
  new Date(d).toLocaleString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });

// Shared chip palette from globals.css (dark-mode safe).
const statusChip: Record<string, string> = {
  PENDING: 'chip-half',
  NEEDS_CLARIFICATION: 'chip-leave',
  APPROVED: 'chip-present',
  PAID: 'chip-paid',
  REJECTED: 'chip-off',
};

const PAY_ROLES = ['SUPER_ADMIN', 'PAYROLL_ADMIN', 'CASHIER'];
const APPROVE_ROLES = ['SUPER_ADMIN', 'HR_MANAGER', 'BRANCH_MANAGER', 'PAYROLL_ADMIN'];

export default function ClaimsPage() {
  const [filter, setFilter] = useState<(typeof FILTERS)[number]>('ALL');
  const [role, setRole] = useState<string>('');
  useEffect(() => setRole(localStorage.getItem('adminRole') ?? ''), []);

  const { data: stats, mutate: mutateStats } = useSWR<Stats>('/admin/claims/stats', fetcher, { shouldRetryOnError: false });
  const query = filter === 'ALL' ? '' : `?status=${filter}`;
  const { data, error, isLoading, mutate } = useSWR<{ claims: Claim[] }>(
    `/admin/claims${query}`,
    fetcher,
    { shouldRetryOnError: false },
  );
  const claims = data?.claims ?? [];
  const [busyId, setBusyId] = useState<string | null>(null);
  const [detail, setDetail] = useState<Claim | null>(null);

  // Keep the open dialog in sync after an action refreshes the list.
  useEffect(() => {
    if (detail) setDetail(claims.find((c) => c.id === detail.id) ?? detail);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data]);

  const canApprove = !role || APPROVE_ROLES.includes(role);
  const canPay = !role || PAY_ROLES.includes(role);

  async function act(id: string, action: 'approve' | 'reject' | 'clarify' | 'pay', note?: string) {
    if (action === 'reject' && !note) note = prompt('Reason for rejection?') ?? undefined;
    if (action === 'clarify' && !note) note = prompt('What clarification do you need from the employee?') ?? undefined;
    if (action !== 'approve' && action !== 'pay' && !note) return;
    if (action === 'pay' && !confirm('Confirm: printed voucher checked against these details and amount handed over?')) return;
    setBusyId(id);
    try {
      await api(`/admin/claims/${id}/${action}`, {
        method: 'PATCH',
        body: JSON.stringify({ note }),
      });
      await Promise.all([mutate(), mutateStats()]);
    } catch (e) {
      alert(e instanceof Error ? e.message : `Failed to ${action} claim`);
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

  async function printVoucher(id: string) {
    try {
      const url = await apiBlobUrl(`/claims/${id}/voucher`);
      window.open(url, '_blank'); // A5 voucher — print at "Actual size" to get half an A4
    } catch {
      alert('Could not open voucher');
    }
  }

  return (
    <div className="space-y-6">
      <PageHero title="Claims" subtitle="Monitor, approve & disburse expense claims · live from database" />

      {/* Analytics */}
      <div className="grid grid-cols-2 gap-4 md:grid-cols-4 lg:grid-cols-7">
        <StatCard label="Total" value={stats?.total ?? 0} accent="text-foreground" />
        <StatCard label="Pending" value={stats?.pending ?? 0} accent="text-amber-600" />
        <StatCard label="Clarification" value={stats?.needsClarification ?? 0} accent="text-indigo-600" />
        <StatCard label="Approved" value={stats?.approved ?? 0} accent="text-emerald-600" />
        <StatCard label="Paid" value={stats?.paid ?? 0} accent="text-sky-600" />
        <StatCard label="Rejected" value={stats?.rejected ?? 0} accent="text-rose-600" />
        <StatCard label="Paid ₹" value={inr(stats?.totalPaidAmount ?? 0)} accent="text-sky-600" />
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
        <CardHeader><CardTitle className="text-base">Claims — click a row for full details</CardTitle></CardHeader>
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
              <div
                key={c.id}
                onClick={() => setDetail(c)}
                className="flex cursor-pointer flex-wrap items-center gap-4 rounded-xl border border-border/60 bg-muted/30 p-4 transition-colors hover:border-border"
              >
                <div className="flex h-10 w-10 items-center justify-center rounded-full brand-gradient text-xs font-bold text-white">
                  {(c.employee?.name ?? '?').split(' ').map((n) => n[0]).join('').slice(0, 2)}
                </div>
                <div className="min-w-0 flex-1">
                  <div className="font-semibold">{c.title} · <span className="text-muted-foreground">{c.employee?.name ?? 'Employee'}</span></div>
                  <div className="text-xs text-muted-foreground">
                    {c.type} · {fmt(c.createdAt)}{c.employee?.branch?.name ? ` · ${c.employee.branch.name}` : ''}
                  </div>
                  {c.status === 'NEEDS_CLARIFICATION' && c.reviewerNote && (
                    <div className="mt-1 text-xs text-indigo-600">Asked: {c.reviewerNote}</div>
                  )}
                  {c.status === 'REJECTED' && c.reviewerNote && (
                    <div className="mt-1 text-xs text-rose-600">Reason: {c.reviewerNote}</div>
                  )}
                  {(c.status === 'APPROVED' || c.status === 'PAID') && c.reviewerName && (
                    <div className="mt-1 text-xs text-emerald-600">Approved by {c.reviewerName}{c.status === 'PAID' && c.paidByName ? ` · Paid by ${c.paidByName}` : ''}</div>
                  )}
                </div>

                <div className="font-bold">{inr(c.amount)}</div>
                <span className={`chip ${statusChip[c.status] ?? 'bg-muted text-muted-foreground'}`}>
                  {c.status.replace('_', ' ')}
                </span>

                <div className="flex gap-2" onClick={(e) => e.stopPropagation()}>
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
                  <button onClick={() => printVoucher(c.id)} title="Print A5 voucher" className="flex h-9 w-9 items-center justify-center rounded-lg border border-border bg-card text-muted-foreground hover:text-foreground">
                    <Printer className="h-4 w-4" />
                  </button>
                  {open && canApprove && (
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
                  {c.status === 'APPROVED' && canPay && (
                    <button onClick={() => act(c.id, 'pay')} disabled={busyId === c.id} title="Mark as paid (after verifying the printed voucher)" className="flex h-9 items-center gap-1.5 rounded-lg bg-sky-50 px-3 text-xs font-semibold text-sky-700 hover:bg-sky-100 disabled:opacity-50">
                      <Banknote className="h-4 w-4" /> Mark Paid
                    </button>
                  )}
                </div>
              </div>
            );
          })}
        </CardContent>
      </Card>

      {detail && (
        <ClaimDetailDialog
          claim={detail}
          canApprove={canApprove}
          canPay={canPay}
          busy={busyId === detail.id}
          onClose={() => setDetail(null)}
          onAct={act}
          onViewFile={viewFile}
          onVoucher={printVoucher}
        />
      )}
    </div>
  );
}

/** Full claim details + clarification thread — what the cashier verifies the printout against. */
function ClaimDetailDialog({
  claim: c, canApprove, canPay, busy, onClose, onAct, onViewFile, onVoucher,
}: {
  claim: Claim;
  canApprove: boolean;
  canPay: boolean;
  busy: boolean;
  onClose: () => void;
  onAct: (id: string, action: 'approve' | 'reject' | 'clarify' | 'pay', note?: string) => void;
  onViewFile: (id: string, which: 'photo' | 'pdf') => void;
  onVoucher: (id: string) => void;
}) {
  const open = c.status === 'PENDING' || c.status === 'NEEDS_CLARIFICATION';
  const hasPhoto = !!(c.photoFileId || c.photoUrl);
  const hasPdf = !!(c.documentFileId || c.documentUrl);
  const [clarifyText, setClarifyText] = useState('');

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={onClose}>
      <div className="max-h-[90vh] w-full max-w-lg overflow-y-auto rounded-2xl bg-card p-6 shadow-brand" onClick={(e) => e.stopPropagation()}>
        <div className="mb-4 flex items-start justify-between gap-3">
          <div>
            <h2 className="text-lg font-bold">{c.title}</h2>
            <div className="text-xs text-muted-foreground">Voucher No: CLM-{c.id.slice(-8).toUpperCase()}</div>
          </div>
          <span className={`chip ${statusChip[c.status] ?? 'bg-muted text-muted-foreground'}`}>
            {c.status.replace('_', ' ')}
          </span>
        </div>

        <div className="grid grid-cols-2 gap-x-4 gap-y-3 text-sm">
          <Field label="Claimed by" value={`${c.employee?.name ?? '—'} (${c.employee?.employeeCode ?? '—'})`} />
          <Field label="Branch" value={c.employee?.branch?.name ?? '—'} />
          <Field label="Type" value={c.type} />
          <Field label="Amount" value={inr(c.amount)} strong />
          <Field label="Submitted" value={fmtFull(c.createdAt)} />
          <Field
            label={c.status === 'REJECTED' ? 'Rejected by' : 'Approved by'}
            value={c.reviewerName ? `${c.reviewerName}${c.reviewedAt ? ` · ${fmtFull(c.reviewedAt)}` : ''}` : 'Pending'}
          />
          {c.status === 'PAID' && (
            <Field label="Paid by" value={`${c.paidByName ?? '—'}${c.paidAt ? ` · ${fmtFull(c.paidAt)}` : ''}`} />
          )}
        </div>

        <div className="mt-3">
          <div className="text-[11px] font-semibold uppercase text-muted-foreground">Description</div>
          <p className="mt-0.5 whitespace-pre-wrap text-sm">{c.description?.trim() || '—'}</p>
        </div>

        {/* Clarification thread */}
        {(c.messages?.length ?? 0) > 0 && (
          <div className="mt-4">
            <div className="text-[11px] font-semibold uppercase text-muted-foreground">Clarification thread</div>
            <div className="mt-2 space-y-2">
              {c.messages!.map((m) => (
                <div
                  key={m.id}
                  className={`max-w-[85%] rounded-xl px-3 py-2 text-sm ${
                    m.senderRole === 'ADMIN'
                      ? 'bg-indigo-50 text-indigo-900 dark:bg-indigo-950 dark:text-indigo-200'
                      : 'ml-auto bg-muted'
                  }`}
                >
                  <div className="text-[10px] font-semibold text-muted-foreground">
                    {m.senderName} · {fmtFull(m.createdAt)}
                  </div>
                  {m.message}
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Ask-for-clarification composer (kept inside the thread context) */}
        {open && canApprove && (
          <div className="mt-3 flex gap-2">
            <input
              value={clarifyText}
              onChange={(e) => setClarifyText(e.target.value)}
              placeholder="Ask the employee for clarification…"
              className="h-10 flex-1 rounded-xl border border-border bg-background px-3 text-sm outline-none focus:ring-2 focus:ring-ring/40"
            />
            <button
              onClick={() => { if (clarifyText.trim()) { onAct(c.id, 'clarify', clarifyText.trim()); setClarifyText(''); } }}
              disabled={busy || !clarifyText.trim()}
              className="flex h-10 items-center gap-1.5 rounded-xl bg-indigo-50 px-3 text-xs font-semibold text-indigo-700 hover:bg-indigo-100 disabled:opacity-50"
            >
              <Send className="h-4 w-4" /> Ask
            </button>
          </div>
        )}

        <div className="mt-5 flex flex-wrap justify-end gap-2">
          {hasPhoto && (
            <ActionBtn onClick={() => onViewFile(c.id, 'photo')}><ImageIcon className="h-4 w-4" /> Photo</ActionBtn>
          )}
          {hasPdf && (
            <ActionBtn onClick={() => onViewFile(c.id, 'pdf')}><FileText className="h-4 w-4" /> PDF</ActionBtn>
          )}
          <ActionBtn onClick={() => onVoucher(c.id)}><Printer className="h-4 w-4" /> Voucher (A5)</ActionBtn>
          {open && canApprove && (
            <>
              <button onClick={() => onAct(c.id, 'approve')} disabled={busy} className="flex h-10 items-center gap-1.5 rounded-xl bg-emerald-600 px-4 text-xs font-semibold text-white hover:bg-emerald-700 disabled:opacity-50">
                <Check className="h-4 w-4" /> Approve
              </button>
              <button onClick={() => onAct(c.id, 'reject')} disabled={busy} className="flex h-10 items-center gap-1.5 rounded-xl bg-rose-50 px-4 text-xs font-semibold text-rose-700 hover:bg-rose-100 disabled:opacity-50">
                <X className="h-4 w-4" /> Reject
              </button>
            </>
          )}
          {c.status === 'APPROVED' && canPay && (
            <button onClick={() => onAct(c.id, 'pay')} disabled={busy} className="flex h-10 items-center gap-1.5 rounded-xl bg-sky-600 px-4 text-xs font-semibold text-white hover:bg-sky-700 disabled:opacity-50">
              <Banknote className="h-4 w-4" /> Mark Paid
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

function Field({ label, value, strong }: { label: string; value: string; strong?: boolean }) {
  return (
    <div>
      <div className="text-[11px] font-semibold uppercase text-muted-foreground">{label}</div>
      <div className={strong ? 'font-bold' : ''}>{value}</div>
    </div>
  );
}

function ActionBtn({ onClick, children }: { onClick: () => void; children: React.ReactNode }) {
  return (
    <button onClick={onClick} className="flex h-10 items-center gap-1.5 rounded-xl border border-border bg-card px-3 text-xs font-semibold text-muted-foreground hover:text-foreground">
      {children}
    </button>
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
