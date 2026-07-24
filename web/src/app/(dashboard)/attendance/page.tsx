'use client';

import { useState } from 'react';
import useSWR from 'swr';
import { PageHero } from '@/components/page-hero';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { FileSpreadsheet, FileText, Search, Check, X, Camera, Loader2, MapPinOff } from 'lucide-react';
import { useLiveAttendance, type LiveAttendanceRow } from '@/hooks/useApi';
import { fetcher, api, apiBlobUrl } from '@/lib/api';

const esc = (v: string | number | null | undefined) => `"${String(v ?? '').replace(/"/g, '""')}"`;
const escHtml = (v: string | null | undefined) =>
  String(v ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c] as string));

function downloadCsv(filename: string, header: string[], rows: (string | number | null | undefined)[][]) {
  const csv = [header.map(esc).join(','), ...rows.map((r) => r.map(esc).join(','))].join('\n');
  const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv' }));
  const a = document.createElement('a');
  a.href = url; a.download = filename; a.click();
  URL.revokeObjectURL(url);
}

interface PendingApproval {
  id: string;
  name: string;
  employeeCode: string;
  branch: string;
  date: string;
  checkIn: string | null;
  reason: string | null;
  hasSelfie: boolean;
}

const noRows: LiveAttendanceRow[] = [];

const chipClass: Record<string, string> = {
  Present: 'chip-present',
  Late: 'chip-half',
  Absent: 'chip-off',
  'On Leave': 'chip-leave',
};

export default function AttendancePage() {
  const { data: rows, isLive } = useLiveAttendance(noRows);
  const [search, setSearch] = useState('');
  const [branchFilter, setBranchFilter] = useState('ALL');
  const [statusFilter, setStatusFilter] = useState('ALL');

  const branches = [...new Set(rows.map((r) => r.branch).filter(Boolean))];
  const statuses = [...new Set(rows.map((r) => r.status).filter(Boolean))];
  const q = search.trim().toLowerCase();
  const filtered = rows.filter((r) => {
    const mBranch = branchFilter === 'ALL' || r.branch === branchFilter;
    const mStatus = statusFilter === 'ALL' || r.status === statusFilter;
    const mSearch = !q || (r.name?.toLowerCase().includes(q) ?? false) || (r.branch?.toLowerCase().includes(q) ?? false);
    return mBranch && mStatus && mSearch;
  });

  const today = new Date().toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });

  function exportExcel() {
    downloadCsv(
      `live-attendance-${new Date().toISOString().slice(0, 10)}.csv`,
      ['Employee', 'Branch', 'Check-In', 'Check-Out', 'Status'],
      filtered.map((r) => [r.name, r.branch, r.checkIn, r.checkOut, r.status]),
    );
  }

  function exportPdf() {
    const w = window.open('', '_blank');
    if (!w) { alert('Allow pop-ups to export the PDF'); return; }
    const body = filtered.map((r) =>
      `<tr><td>${escHtml(r.name)}</td><td>${escHtml(r.branch)}</td><td>${escHtml(r.checkIn ?? '—')}</td><td>${escHtml(r.checkOut ?? '—')}</td><td>${escHtml(r.status)}</td></tr>`,
    ).join('');
    w.document.write(`<!doctype html><html><head><title>Live Attendance ${today}</title>
      <style>body{font-family:Arial,sans-serif;padding:24px;color:#1c1b2e}h2{margin:0 0 4px}p{color:#666;margin:0 0 16px;font-size:13px}
      table{width:100%;border-collapse:collapse;font-size:13px}th{background:#2F55F4;color:#fff;text-align:left;padding:8px}td{padding:8px;border-bottom:1px solid #eee}</style>
      </head><body><h2>Live Attendance</h2><p>${today} · ${filtered.length} record(s)</p>
      <table><thead><tr><th>Employee</th><th>Branch</th><th>Check-In</th><th>Check-Out</th><th>Status</th></tr></thead>
      <tbody>${body || '<tr><td colspan="5">No records</td></tr>'}</tbody></table>
      <script>window.onload=function(){window.print()}</script></body></html>`);
    w.document.close();
  }

  return (
    <div className="space-y-6">
      <PageHero title="Live Attendance" subtitle="Real-time check-in feed across all branches">
        <span className={`chip ${isLive ? 'chip-present' : 'chip-half'}`}>
          {isLive ? '● Live' : 'Offline'}
        </span>
        <button onClick={exportExcel} disabled={filtered.length === 0} className="flex h-10 items-center gap-2 rounded-xl bg-white/15 px-4 text-sm font-medium text-white ring-1 ring-white/25 hover:bg-white/25 disabled:opacity-50">
          <FileSpreadsheet className="h-4 w-4" /> Excel
        </button>
        <button onClick={exportPdf} disabled={filtered.length === 0} className="flex h-10 items-center gap-2 rounded-xl bg-white px-4 text-sm font-semibold text-brand-600 hover:bg-white/90 disabled:opacity-50">
          <FileText className="h-4 w-4" /> PDF
        </button>
      </PageHero>

      <ApprovalsCard />

      {/* Filters */}
      <div className="flex flex-wrap items-center gap-3">
        <div className="relative min-w-[200px] flex-1">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search employee or branch…"
            className="h-10 w-full rounded-xl border border-border bg-card pl-9 pr-3 text-sm outline-none focus:ring-2 focus:ring-ring/40"
          />
        </div>
        <select value={branchFilter} onChange={(e) => setBranchFilter(e.target.value)} className="h-10 rounded-xl border border-border bg-card px-3 text-sm outline-none focus:ring-2 focus:ring-ring/40">
          <option value="ALL">All branches</option>
          {branches.map((b) => <option key={b} value={b}>{b}</option>)}
        </select>
        <select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)} className="h-10 rounded-xl border border-border bg-card px-3 text-sm outline-none focus:ring-2 focus:ring-ring/40">
          <option value="ALL">All statuses</option>
          {statuses.map((s) => <option key={s} value={s}>{s}</option>)}
        </select>
        <span className="text-xs text-muted-foreground">{filtered.length} of {rows.length}</span>
      </div>

      <Card>
        <CardContent className="p-0">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border/60 text-left text-xs uppercase tracking-wide text-muted-foreground">
                  <th className="px-6 py-3 font-medium">Employee</th>
                  <th className="px-6 py-3 font-medium">Branch</th>
                  <th className="px-6 py-3 font-medium">Check-In</th>
                  <th className="px-6 py-3 font-medium">Check-Out</th>
                  <th className="px-6 py-3 font-medium">Status</th>
                </tr>
              </thead>
              <tbody>
                {filtered.length === 0 && (
                  <tr>
                    <td colSpan={5} className="px-6 py-10 text-center text-muted-foreground">
                      {rows.length === 0 ? (isLive ? 'No check-ins yet today' : 'Waiting for live data…') : 'No records match your filters'}
                    </td>
                  </tr>
                )}
                {filtered.map((r) => (
                  <tr key={r.id} className="border-b border-border/40 last:border-0 hover:bg-muted/40">
                    <td className="px-6 py-4 font-medium">{r.name}</td>
                    <td className="px-6 py-4 text-muted-foreground">{r.branch}</td>
                    <td className="px-6 py-4">{r.checkIn ?? '—'}</td>
                    <td className="px-6 py-4">{r.checkOut ?? '—'}</td>
                    <td className="px-6 py-4">
                      <span className={`chip ${chipClass[r.status]}`}>{r.status}</span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

/** Out-of-geofence selfie check-ins waiting for HR/admin sign-off. Hidden when empty. */
function ApprovalsCard() {
  const { data, mutate } = useSWR<{ approvals: PendingApproval[] }>(
    '/admin/attendance/approvals',
    fetcher,
    { shouldRetryOnError: false, refreshInterval: 30_000 },
  );
  const approvals = data?.approvals ?? [];
  const [busyId, setBusyId] = useState<string | null>(null);

  async function decide(id: string, action: 'approve' | 'reject') {
    if (action === 'reject' && !confirm('Reject this check-in? The day will be marked absent.')) return;
    setBusyId(id);
    try {
      await api(`/admin/attendance/${id}/${action}`, { method: 'PATCH' });
      await mutate();
    } catch (e) {
      alert(e instanceof Error ? e.message : `Failed to ${action}`);
    } finally {
      setBusyId(null);
    }
  }

  async function viewSelfie(id: string) {
    try {
      window.open(await apiBlobUrl(`/admin/attendance/${id}/selfie`), '_blank');
    } catch {
      alert('Could not open selfie');
    }
  }

  if (approvals.length === 0) return null;

  return (
    <Card className="border-amber-300/60">
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <MapPinOff className="h-4 w-4 text-amber-600" />
          Outside-geofence check-ins awaiting approval ({approvals.length})
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        {approvals.map((a) => (
          <div key={a.id} className="flex flex-wrap items-center gap-3 rounded-xl border border-border/60 bg-muted/30 p-4">
            <div className="min-w-0 flex-1">
              <div className="font-semibold">{a.name} <span className="text-xs text-muted-foreground">({a.employeeCode}) · {a.branch}</span></div>
              <div className="text-xs text-muted-foreground">{a.date} · Check-in {a.checkIn ?? '—'}</div>
              {a.reason && <div className="mt-1 text-xs text-amber-700">{a.reason}</div>}
            </div>
            {a.hasSelfie && (
              <button onClick={() => viewSelfie(a.id)} title="View selfie" className="flex h-9 items-center gap-1.5 rounded-lg border border-border bg-card px-3 text-xs font-semibold text-muted-foreground hover:text-foreground">
                <Camera className="h-4 w-4" /> Selfie
              </button>
            )}
            <button onClick={() => decide(a.id, 'approve')} disabled={busyId === a.id} className="flex h-9 items-center gap-1.5 rounded-lg bg-emerald-600 px-3 text-xs font-semibold text-white hover:bg-emerald-700 disabled:opacity-50">
              {busyId === a.id ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />} Approve
            </button>
            <button onClick={() => decide(a.id, 'reject')} disabled={busyId === a.id} className="flex h-9 items-center gap-1.5 rounded-lg bg-rose-50 px-3 text-xs font-semibold text-rose-700 hover:bg-rose-100 disabled:opacity-50">
              <X className="h-4 w-4" /> Reject
            </button>
          </div>
        ))}
        <p className="text-xs text-muted-foreground">Approved check-ins count for attendance & payroll. Rejected ones are marked absent.</p>
      </CardContent>
    </Card>
  );
}
