'use client';

import { useState } from 'react';
import useSWR from 'swr';
import { PageHero } from '@/components/page-hero';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { FileSpreadsheet, FileText, Search, Check, X, Camera, Loader2, MapPinOff, ClipboardPen } from 'lucide-react';
import { useLiveAttendance, type LiveAttendanceRow } from '@/hooks/useApi';
import { fetcher, api, apiBlobUrl, apiUpload } from '@/lib/api';

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
  checkOut: string | null;
  reason: string | null;
  punchMode: string;
  punchReason: string | null;
  raisedByHr: boolean;
  hasSelfie: boolean;
}

interface EmployeeOption { id: string; name: string; employeeCode?: string; status?: string }

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
  const [departmentFilter, setDepartmentFilter] = useState('ALL');
  const [designationFilter, setDesignationFilter] = useState('ALL');
  const [statusFilter, setStatusFilter] = useState('ALL');

  const branches = [...new Set(rows.map((r) => r.branch).filter(Boolean))];
  const departments = [...new Set(rows.map((r) => r.department).filter(Boolean))].sort();
  const designations = [...new Set(rows.map((r) => r.designation).filter(Boolean))].sort();
  const statuses = [...new Set(rows.map((r) => r.status).filter(Boolean))];
  const q = search.trim().toLowerCase();
  const filtered = rows.filter((r) => {
    const mBranch = branchFilter === 'ALL' || r.branch === branchFilter;
    const mDept = departmentFilter === 'ALL' || r.department === departmentFilter;
    const mDesig = designationFilter === 'ALL' || r.designation === designationFilter;
    const mStatus = statusFilter === 'ALL' || r.status === statusFilter;
    const mSearch = !q || [r.name, r.branch, r.department, r.designation]
      .some((v) => v?.toLowerCase().includes(q) ?? false);
    return mBranch && mDept && mDesig && mStatus && mSearch;
  });

  const today = new Date().toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });

  function exportExcel() {
    downloadCsv(
      `live-attendance-${new Date().toISOString().slice(0, 10)}.csv`,
      ['Employee', 'Branch', 'Department', 'Designation', 'Check-In', 'Check-Out', 'Status'],
      filtered.map((r) => [r.name, r.branch, r.department, r.designation, r.checkIn, r.checkOut, r.status]),
    );
  }

  function exportPdf() {
    const w = window.open('', '_blank');
    if (!w) { alert('Allow pop-ups to export the PDF'); return; }
    const body = filtered.map((r) =>
      `<tr><td>${escHtml(r.name)}</td><td>${escHtml(r.branch)}</td><td>${escHtml(r.department)}</td><td>${escHtml(r.designation)}</td><td>${escHtml(r.checkIn ?? '—')}</td><td>${escHtml(r.checkOut ?? '—')}</td><td>${escHtml(r.status)}</td></tr>`,
    ).join('');
    w.document.write(`<!doctype html><html><head><title>Live Attendance ${today}</title>
      <style>body{font-family:Arial,sans-serif;padding:24px;color:#1c1b2e}h2{margin:0 0 4px}p{color:#666;margin:0 0 16px;font-size:13px}
      table{width:100%;border-collapse:collapse;font-size:13px}th{background:#2F55F4;color:#fff;text-align:left;padding:8px}td{padding:8px;border-bottom:1px solid #eee}</style>
      </head><body><h2>Live Attendance</h2><p>${today} · ${filtered.length} record(s)</p>
      <table><thead><tr><th>Employee</th><th>Branch</th><th>Department</th><th>Designation</th><th>Check-In</th><th>Check-Out</th><th>Status</th></tr></thead>
      <tbody>${body || '<tr><td colspan="7">No records</td></tr>'}</tbody></table>
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
      <ManualPunchCard />

      {/* Filters */}
      <div className="flex flex-wrap items-center gap-3">
        <div className="relative min-w-[200px] flex-1">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search employee, branch, department or designation…"
            className="h-10 w-full rounded-xl border border-border bg-card pl-9 pr-3 text-sm outline-none focus:ring-2 focus:ring-ring/40"
          />
        </div>
        <select value={branchFilter} onChange={(e) => setBranchFilter(e.target.value)} className="h-10 rounded-xl border border-border bg-card px-3 text-sm outline-none focus:ring-2 focus:ring-ring/40">
          <option value="ALL">All branches</option>
          {branches.map((b) => <option key={b} value={b}>{b}</option>)}
        </select>
        <select value={departmentFilter} onChange={(e) => setDepartmentFilter(e.target.value)} className="h-10 rounded-xl border border-border bg-card px-3 text-sm outline-none focus:ring-2 focus:ring-ring/40">
          <option value="ALL">All departments</option>
          {departments.map((d) => <option key={d} value={d}>{d}</option>)}
        </select>
        <select value={designationFilter} onChange={(e) => setDesignationFilter(e.target.value)} className="h-10 rounded-xl border border-border bg-card px-3 text-sm outline-none focus:ring-2 focus:ring-ring/40">
          <option value="ALL">All designations</option>
          {designations.map((d) => <option key={d} value={d}>{d}</option>)}
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
                  <th className="px-6 py-3 font-medium">Department</th>
                  <th className="px-6 py-3 font-medium">Designation</th>
                  <th className="px-6 py-3 font-medium">Check-In</th>
                  <th className="px-6 py-3 font-medium">Check-Out</th>
                  <th className="px-6 py-3 font-medium">Status</th>
                </tr>
              </thead>
              <tbody>
                {filtered.length === 0 && (
                  <tr>
                    <td colSpan={7} className="px-6 py-10 text-center text-muted-foreground">
                      {rows.length === 0 ? (isLive ? 'No check-ins yet today' : 'Waiting for live data…') : 'No records match your filters'}
                    </td>
                  </tr>
                )}
                {filtered.map((r) => (
                  <tr key={r.id} className="border-b border-border/40 last:border-0 hover:bg-muted/40">
                    <td className="px-6 py-4 font-medium">{r.name}</td>
                    <td className="px-6 py-4 text-muted-foreground">{r.branch}</td>
                    <td className="px-6 py-4 text-muted-foreground">{r.department ?? '—'}</td>
                    <td className="px-6 py-4 text-muted-foreground">{r.designation ?? '—'}</td>
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

/**
 * Punches waiting for the reporting manager / HR to sign off: out-of-geofence
 * check-ins, late arrivals, and manual / selfie punches. Hidden when empty.
 */
function ApprovalsCard() {
  const { data, mutate } = useSWR<{ approvals: PendingApproval[] }>(
    '/admin/attendance/approvals',
    fetcher,
    { shouldRetryOnError: false, refreshInterval: 30_000 },
  );
  const approvals = data?.approvals ?? [];
  const [busyId, setBusyId] = useState<string | null>(null);

  async function decide(id: string, action: 'approve' | 'reject') {
    if (action === 'reject' && !confirm('Reject this punch? The day will not be paid.')) return;
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
          Punches awaiting approval ({approvals.length})
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        {approvals.map((a) => (
          <div key={a.id} className="flex flex-wrap items-center gap-3 rounded-xl border border-border/60 bg-muted/30 p-4">
            <div className="min-w-0 flex-1">
              <div className="font-semibold">{a.name} <span className="text-xs text-muted-foreground">({a.employeeCode}) · {a.branch}</span></div>
              <div className="text-xs text-muted-foreground">
                {a.date} · In {a.checkIn ?? '—'} · Out {a.checkOut ?? '—'}
                {a.punchMode !== 'GEO' && (
                  <span className="ml-1.5 rounded-full bg-amber-100 px-1.5 py-0.5 text-[10px] font-bold text-amber-700">
                    {a.punchMode === 'SELFIE' ? 'SELFIE PUNCH' : 'MANUAL PUNCH'}
                    {a.raisedByHr ? ' · BY HR' : ''}
                  </span>
                )}
              </div>
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
        <p className="text-xs text-muted-foreground">
          Approved punches count for attendance &amp; payroll. Rejected ones are not paid. Manual and selfie punches skip the
          geofence and shift-time checks by design — approve only what you can verify.
        </p>
      </CardContent>
    </Card>
  );
}

/**
 * Raise a manual or selfie punch on an employee's behalf — for when the normal
 * gate can't be satisfied (face verification failing, or the employee working
 * away from the branch geofence).
 *
 * Geofence and shift-time checks are skipped by design; the punch still lands
 * in the reporting manager's approval queue, so HR entering it is not approval.
 */
function ManualPunchCard() {
  const { data } = useSWR<{ employees: EmployeeOption[] }>('/admin/employees', fetcher, { shouldRetryOnError: false });
  const employees = (data?.employees ?? []).filter((e) => e.status !== 'INACTIVE');
  const { mutate: refreshApprovals } = useSWR<{ approvals: PendingApproval[] }>('/admin/attendance/approvals', fetcher, { shouldRetryOnError: false });

  const [open, setOpen] = useState(false);
  const [employeeId, setEmployeeId] = useState('');
  const [mode, setMode] = useState<'MANUAL' | 'SELFIE'>('MANUAL');
  const [date, setDate] = useState(new Date().toISOString().slice(0, 10));
  const [checkIn, setCheckIn] = useState('');
  const [checkOut, setCheckOut] = useState('');
  const [reason, setReason] = useState('');
  const [selfie, setSelfie] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [ok, setOk] = useState<string | null>(null);

  function reset() {
    setEmployeeId(''); setMode('MANUAL'); setCheckIn(''); setCheckOut('');
    setReason(''); setSelfie(null); setErr(null);
  }

  async function submit() {
    setErr(null); setOk(null);
    if (!employeeId) { setErr('Select an employee'); return; }
    if (!checkIn && !checkOut) { setErr('Enter a check-in time, a check-out time, or both'); return; }
    if (reason.trim().length < 3) { setErr('Add a reason the manager can act on'); return; }
    if (mode === 'SELFIE' && !selfie) { setErr('Attach the selfie for a selfie punch'); return; }

    setBusy(true);
    try {
      const fd = new FormData();
      fd.append('employeeId', employeeId);
      fd.append('mode', mode);
      fd.append('date', date);
      if (checkIn) fd.append('checkIn', checkIn);
      if (checkOut) fd.append('checkOut', checkOut);
      fd.append('reason', reason.trim());
      if (selfie) fd.append('selfie', selfie);
      await apiUpload('/admin/attendance/manual-punch', fd);
      setOk('Punch recorded — sent to the reporting manager for approval.');
      reset();
      setOpen(false);
      await refreshApprovals();
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Could not record the punch');
    } finally {
      setBusy(false);
    }
  }

  const field = 'h-10 w-full rounded-xl border border-border bg-background px-3 text-sm outline-none focus:ring-2 focus:ring-ring/40';

  return (
    <Card>
      <CardHeader className="flex flex-row flex-wrap items-center justify-between gap-2 space-y-0">
        <CardTitle className="flex items-center gap-2 text-base">
          <ClipboardPen className="h-4 w-4 text-brand-600" /> Manual / selfie punch
        </CardTitle>
        <button
          onClick={() => { setOpen((v) => !v); setOk(null); }}
          className="h-9 rounded-lg border border-border px-3 text-xs font-semibold text-brand-600 hover:bg-brand-50"
        >
          {open ? 'Close' : 'Raise a punch'}
        </button>
      </CardHeader>
      <CardContent className="space-y-3">
        {ok && <p className="text-sm text-emerald-700">{ok}</p>}
        {!open && !ok && (
          <p className="text-xs text-muted-foreground">
            For an employee who could not check in or out normally — face verification failing, or working away from the branch
            geofence. Geofence and shift-time checks are skipped; the reporting manager still has to approve it before it is paid.
          </p>
        )}
        {open && (
          <>
            <div className="grid gap-3 sm:grid-cols-2">
              <label className="text-xs font-medium text-muted-foreground">
                Employee
                <select value={employeeId} onChange={(e) => setEmployeeId(e.target.value)} className={`mt-1 ${field}`}>
                  <option value="">Select an employee…</option>
                  {employees.map((e) => (
                    <option key={e.id} value={e.id}>{e.name}{e.employeeCode ? ` (${e.employeeCode})` : ''}</option>
                  ))}
                </select>
              </label>
              <label className="text-xs font-medium text-muted-foreground">
                Punch type
                <select value={mode} onChange={(e) => setMode(e.target.value as 'MANUAL' | 'SELFIE')} className={`mt-1 ${field}`}>
                  <option value="MANUAL">Manual punch (typed times, no photo)</option>
                  <option value="SELFIE">Selfie punch (photo attached)</option>
                </select>
              </label>
              <label className="text-xs font-medium text-muted-foreground">
                Date
                <input type="date" value={date} max={new Date().toISOString().slice(0, 10)} onChange={(e) => setDate(e.target.value)} className={`mt-1 ${field}`} />
              </label>
              <div className="grid grid-cols-2 gap-3">
                <label className="text-xs font-medium text-muted-foreground">
                  Check-in
                  <input type="time" value={checkIn} onChange={(e) => setCheckIn(e.target.value)} className={`mt-1 ${field}`} />
                </label>
                <label className="text-xs font-medium text-muted-foreground">
                  Check-out
                  <input type="time" value={checkOut} onChange={(e) => setCheckOut(e.target.value)} className={`mt-1 ${field}`} />
                </label>
              </div>
            </div>

            {mode === 'SELFIE' && (
              <label className="block text-xs font-medium text-muted-foreground">
                Selfie
                <input
                  type="file"
                  accept="image/*"
                  onChange={(e) => setSelfie(e.target.files?.[0] ?? null)}
                  className="mt-1 block w-full text-sm file:mr-3 file:rounded-lg file:border-0 file:bg-brand-50 file:px-3 file:py-2 file:text-sm file:font-semibold file:text-brand-600"
                />
              </label>
            )}

            <label className="block text-xs font-medium text-muted-foreground">
              Reason (shown to the approving manager)
              <textarea
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                rows={2}
                placeholder="e.g. Site visit at Erode — outside the branch zone all day"
                className="mt-1 w-full rounded-xl border border-border bg-background p-3 text-sm outline-none focus:ring-2 focus:ring-ring/40"
              />
            </label>

            {err && <p className="text-sm text-destructive">{err}</p>}

            <div className="flex justify-end gap-2">
              <button onClick={() => { setOpen(false); reset(); }} className="h-10 rounded-xl border border-border px-4 text-sm font-medium">Cancel</button>
              <button onClick={submit} disabled={busy} className="flex h-10 items-center gap-2 rounded-xl brand-gradient px-5 text-sm font-semibold text-white disabled:opacity-60">
                {busy && <Loader2 className="h-4 w-4 animate-spin" />} Send for approval
              </button>
            </div>
          </>
        )}
      </CardContent>
    </Card>
  );
}
