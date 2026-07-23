'use client';

import { useRef, useState } from 'react';
import useSWR from 'swr';
import { fetcher, api, apiUpload } from '@/lib/api';
import { PageHero } from '@/components/page-hero';
import { Card, CardContent } from '@/components/ui/card';
import { PasswordInput } from '@/components/password-input';
import { UserPlus, Loader2, X, ScanFace, Check, Pencil, Trash2, Upload, KeyRound, Search } from 'lucide-react';

/** Client-side CSV download. */
function downloadCsv(filename: string, header: string[], rows: (string | number | null | undefined)[][]) {
  const esc = (v: string | number | null | undefined) => `"${String(v ?? '').replace(/"/g, '""')}"`;
  const csv = [header.map(esc).join(','), ...rows.map((r) => r.map(esc).join(','))].join('\n');
  const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv' }));
  const a = document.createElement('a');
  a.href = url; a.download = filename; a.click();
  URL.revokeObjectURL(url);
}

interface EmployeeRow {
  id: string;
  name: string;
  employeeCode: string;
  phone: string;
  email?: string | null;
  salary: number;
  status: string;
  faceTemplateId?: string | null;
  branchId: string;
  departmentId: string;
  designationId: string;
  shiftId: string;
  joiningDate: string;
  reportingManagerId?: string | null;
  pfEnabled?: boolean;
  esiEnabled?: boolean;
  branch?: { name: string } | null;
}
interface Named { id: string; name: string }

const chipClass: Record<string, string> = {
  ACTIVE: 'chip-present',
  INACTIVE: 'chip-off',
  SUSPENDED: 'chip-half',
};

export default function EmployeesPage() {
  const { data, error, isLoading, mutate } = useSWR<{ employees: EmployeeRow[] }>('/admin/employees', fetcher, { shouldRetryOnError: false });
  const employees = data?.employees ?? [];
  const [modal, setModal] = useState<{ mode: 'add' } | { mode: 'edit'; employee: EmployeeRow } | null>(null);
  const [showBulk, setShowBulk] = useState(false);
  const [dlBusy, setDlBusy] = useState(false);
  const [search, setSearch] = useState('');
  const [branchFilter, setBranchFilter] = useState('ALL');

  const branches = [...new Set(employees.map((e) => e.branch?.name).filter(Boolean))] as string[];
  const q = search.trim().toLowerCase();
  const filtered = employees.filter((e) => {
    const matchesBranch = branchFilter === 'ALL' || e.branch?.name === branchFilter;
    const matchesSearch = !q || [e.name, e.employeeCode, e.phone].some((v) => v?.toLowerCase().includes(q));
    return matchesBranch && matchesSearch;
  });

  async function downloadCredentials() {
    setDlBusy(true);
    try {
      const res = await api<{ employees: { employeeCode: string; name: string; phone: string; branch: string; password: string }[] }>('/admin/employees/credentials');
      downloadCsv('employee-credentials.csv', ['Employee Code', 'Name', 'Phone', 'Branch', 'App Password'],
        res.employees.map((e) => [e.employeeCode, e.name, e.phone, e.branch, e.password]));
    } catch (e) {
      alert(e instanceof Error ? e.message : 'Only a Super Admin can download credentials');
    } finally {
      setDlBusy(false);
    }
  }

  async function deactivate(e: EmployeeRow) {
    if (!confirm(`Deactivate ${e.name}? They will no longer be able to log in or check in.`)) return;
    try {
      await api(`/admin/employees/${e.id}`, { method: 'DELETE' });
      await mutate();
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Failed to deactivate');
    }
  }

  return (
    <div className="space-y-6">
      <PageHero title="Employees" subtitle={`${employees.length} staff · live from database`}>
        <button onClick={downloadCredentials} disabled={dlBusy} title="Download all employees' login credentials (Super Admin)" className="flex h-10 items-center gap-2 rounded-xl bg-white/15 px-4 text-sm font-medium text-white ring-1 ring-white/25 hover:bg-white/25 disabled:opacity-50">
          {dlBusy ? <Loader2 className="h-4 w-4 animate-spin" /> : <KeyRound className="h-4 w-4" />} Credentials
        </button>
        <button onClick={() => setShowBulk(true)} className="flex h-10 items-center gap-2 rounded-xl bg-white/15 px-4 text-sm font-medium text-white ring-1 ring-white/25 hover:bg-white/25">
          <Upload className="h-4 w-4" /> Bulk Upload
        </button>
        <button onClick={() => setModal({ mode: 'add' })} className="flex h-10 items-center gap-2 rounded-xl bg-white px-4 text-sm font-semibold text-brand-600 hover:bg-white/90">
          <UserPlus className="h-4 w-4" /> Add Employee
        </button>
      </PageHero>

      {showBulk && <BulkUploadModal onClose={() => setShowBulk(false)} onDone={() => mutate()} />}

      {!isLoading && !error && (
        <div className="flex flex-wrap items-center gap-3">
          <div className="relative flex-1 min-w-[200px]">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search name, code or phone…"
              className="h-10 w-full rounded-xl border border-border bg-card pl-9 pr-3 text-sm outline-none focus:ring-2 focus:ring-ring/40"
            />
          </div>
          <select
            value={branchFilter}
            onChange={(e) => setBranchFilter(e.target.value)}
            className="h-10 rounded-xl border border-border bg-card px-3 text-sm outline-none focus:ring-2 focus:ring-ring/40"
          >
            <option value="ALL">All branches</option>
            {branches.map((b) => <option key={b} value={b}>{b}</option>)}
          </select>
          <span className="text-xs text-muted-foreground">{filtered.length} of {employees.length}</span>
        </div>
      )}

      {isLoading && <div className="flex items-center gap-2 text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin" /> Loading…</div>}
      {error && <Card><CardContent className="p-5 text-sm text-destructive">Couldn&apos;t load employees. Sign in and ensure the backend is running.</CardContent></Card>}

      {!isLoading && !error && (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {employees.length === 0 && <Card><CardContent className="p-5 text-sm text-muted-foreground">No employees yet — add one.</CardContent></Card>}
          {employees.length > 0 && filtered.length === 0 && <Card><CardContent className="p-5 text-sm text-muted-foreground">No employees match your search.</CardContent></Card>}
          {filtered.map((e) => (
            <Card key={e.id}>
              <CardContent className="flex flex-col gap-3 p-5">
                <div className="flex items-center gap-4">
                  <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-full brand-gradient text-sm font-bold text-white">
                    {e.name.split(' ').map((n) => n[0]).join('').slice(0, 2)}
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="truncate font-semibold">{e.name}</div>
                    <div className="truncate text-xs text-muted-foreground">{e.employeeCode} · {e.branch?.name ?? '—'}</div>
                    <div className="truncate text-xs text-muted-foreground">{e.phone}</div>
                  </div>
                  <span className={`chip ${chipClass[e.status] ?? 'chip-leave'}`}>{e.status}</span>
                </div>
                <div className="flex gap-2">
                  <button onClick={() => setModal({ mode: 'edit', employee: e })} className="flex h-9 flex-1 items-center justify-center gap-2 rounded-xl border border-border text-xs font-medium text-muted-foreground hover:bg-muted/50 hover:text-foreground">
                    <Pencil className="h-3.5 w-3.5" /> Edit
                  </button>
                  <button onClick={() => deactivate(e)} className="flex h-9 w-9 items-center justify-center rounded-xl bg-rose-50 text-rose-600 hover:bg-rose-100" title="Deactivate">
                    <Trash2 className="h-4 w-4" />
                  </button>
                </div>
                <EnrollFaceButton employee={e} onEnrolled={() => mutate()} />
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      {modal && (
        <EmployeeModal
          employee={modal.mode === 'edit' ? modal.employee : null}
          onClose={() => setModal(null)}
          onSaved={() => { setModal(null); mutate(); }}
        />
      )}
    </div>
  );
}

function EmployeeModal({ employee, onClose, onSaved }: { employee: EmployeeRow | null; onClose: () => void; onSaved: () => void }) {
  const { data: br } = useSWR<{ branches: Named[] }>('/admin/branches', fetcher, { shouldRetryOnError: false });
  const { data: dp } = useSWR<{ departments: Named[] }>('/admin/departments', fetcher, { shouldRetryOnError: false });
  const { data: dg } = useSWR<{ designations: Named[] }>('/admin/designations', fetcher, { shouldRetryOnError: false });
  const { data: sh } = useSWR<{ shifts: Named[] }>('/shifts', fetcher, { shouldRetryOnError: false });
  const { data: mg } = useSWR<{ managers: (Named & { role: string })[] }>('/admin/employees/managers', fetcher, { shouldRetryOnError: false });
  // Suggest the next code in the series for new employees (auto-generated).
  const { data: nc } = useSWR<{ nextCode: string }>(employee ? null : '/admin/employees/next-code', fetcher, { shouldRetryOnError: false });
  const editing = !!employee;

  const [f, setF] = useState({
    name: employee?.name ?? '',
    employeeCode: employee?.employeeCode ?? '',
    phone: employee?.phone ?? '',
    email: employee?.email ?? '',
    salary: employee ? String(employee.salary) : '',
    password: '',
    joiningDate: employee?.joiningDate?.slice(0, 10) ?? new Date().toISOString().slice(0, 10),
    branchId: employee?.branchId ?? '',
    departmentId: employee?.departmentId ?? '',
    designationId: employee?.designationId ?? '',
    shiftId: employee?.shiftId ?? '',
    reportingManagerId: employee?.reportingManagerId ?? '',
    pfEnabled: employee?.pfEnabled ?? false,
    esiEnabled: employee?.esiEnabled ?? false,
  });
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const set = (k: string, v: string) => setF((p) => ({ ...p, [k]: v }));

  async function save() {
    setErr(null);
    if (!f.name || !f.phone || !f.branchId || !f.departmentId || !f.designationId || !f.shiftId || !f.salary) {
      setErr('Please fill all required fields.');
      return;
    }
    if (!editing && (!f.password || f.password.length < 4)) {
      setErr('Set an app login password (min 4 characters) for the employee.');
      return;
    }
    if (editing && f.password && f.password.length < 4) {
      setErr('New password must be at least 4 characters (or leave it blank to keep the current one).');
      return;
    }
    setSaving(true);
    try {
      const body = JSON.stringify({
        ...f,
        // Blank code → server auto-generates the next in the series.
        employeeCode: f.employeeCode.trim() || undefined,
        email: f.email || undefined,
        password: f.password || undefined,
        salary: Number(f.salary),
        reportingManagerId: f.reportingManagerId || null,
      });
      if (editing) await api(`/admin/employees/${employee!.id}`, { method: 'PUT', body });
      else await api('/admin/employees', { method: 'POST', body });
      onSaved();
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Failed to save employee');
    } finally {
      setSaving(false);
    }
  }

  const input = 'h-10 w-full rounded-xl border border-border bg-background px-3 text-sm outline-none focus:ring-2 focus:ring-ring/40';

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={onClose}>
      <div className="max-h-[90vh] w-full max-w-lg overflow-y-auto rounded-2xl bg-card p-6 shadow-brand" onClick={(e) => e.stopPropagation()}>
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-lg font-bold">{editing ? `Edit ${employee!.name}` : 'Add Employee'}</h2>
          <button onClick={onClose} className="text-muted-foreground hover:text-foreground"><X className="h-5 w-5" /></button>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <input className={input} placeholder="Full name *" value={f.name} onChange={(e) => set('name', e.target.value)} />
          <input className={input} placeholder={editing ? 'Employee code' : `Auto: ${nc?.nextCode ?? '…'} (or type one)`} value={f.employeeCode} onChange={(e) => set('employeeCode', e.target.value)} disabled={editing} />
          <input className={input} placeholder="Phone * (+91…)" value={f.phone} onChange={(e) => set('phone', e.target.value)} />
          <input className={input} placeholder="Email" value={f.email} onChange={(e) => set('email', e.target.value)} />
          <PasswordInput className={input} placeholder={editing ? 'New password (blank = keep)' : 'App login password *'} value={f.password} onChange={(v) => set('password', v)} />
          <input className={input} type="number" placeholder="Salary (₹/mo) *" value={f.salary} onChange={(e) => set('salary', e.target.value)} />
          <input className={input} type="date" value={f.joiningDate} onChange={(e) => set('joiningDate', e.target.value)} />
          <select className={input} value={f.branchId} onChange={(e) => set('branchId', e.target.value)}>
            <option value="">Branch *</option>
            {br?.branches.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
          </select>
          <select className={input} value={f.shiftId} onChange={(e) => set('shiftId', e.target.value)}>
            <option value="">Shift *</option>
            {sh?.shifts.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
          </select>
          <select className={input} value={f.departmentId} onChange={(e) => set('departmentId', e.target.value)}>
            <option value="">Department *</option>
            {dp?.departments.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
          </select>
          <select className={input} value={f.designationId} onChange={(e) => set('designationId', e.target.value)}>
            <option value="">Designation *</option>
            {dg?.designations.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
          </select>
          <select className={`${input} col-span-2`} value={f.reportingManagerId} onChange={(e) => set('reportingManagerId', e.target.value)} title="Leave/outside check-in approvals route to this manager">
            <option value="">Reporting manager (approvals) — none</option>
            {mg?.managers.map((m) => <option key={m.id} value={m.id}>{m.name} · {m.role.replace('_', ' ')}</option>)}
          </select>
          <label className="flex cursor-pointer items-center gap-2 text-sm">
            <input type="checkbox" checked={f.pfEnabled} onChange={(e) => setF((p) => ({ ...p, pfEnabled: e.target.checked }))} className="h-4 w-4 accent-brand-600" />
            PF deduction applies
          </label>
          <label className="flex cursor-pointer items-center gap-2 text-sm">
            <input type="checkbox" checked={f.esiEnabled} onChange={(e) => setF((p) => ({ ...p, esiEnabled: e.target.checked }))} className="h-4 w-4 accent-brand-600" />
            ESI deduction applies
          </label>
        </div>
        {err && <p className="mt-3 text-sm text-destructive">{err}</p>}
        <div className="mt-5 flex justify-end gap-2">
          <button onClick={onClose} className="h-10 rounded-xl border border-border px-4 text-sm font-medium">Cancel</button>
          <button onClick={save} disabled={saving} className="flex h-10 items-center gap-2 rounded-xl brand-gradient px-5 text-sm font-semibold text-white disabled:opacity-60">
            {saving && <Loader2 className="h-4 w-4 animate-spin" />} {editing ? 'Save Changes' : 'Save'}
          </button>
        </div>
      </div>
    </div>
  );
}

function EnrollFaceButton({ employee, onEnrolled }: { employee: EmployeeRow; onEnrolled: () => void }) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [status, setStatus] = useState<'idle' | 'uploading' | 'done' | 'error'>(
    employee.faceTemplateId ? 'done' : 'idle',
  );
  const [msg, setMsg] = useState<string | null>(null);

  async function onPick(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setStatus('uploading');
    setMsg(null);
    try {
      const fd = new FormData();
      fd.append('image', file);
      await apiUpload(`/admin/employees/${employee.id}/enroll-face`, fd);
      setStatus('done');
      onEnrolled();
    } catch (err) {
      setStatus('error');
      setMsg(err instanceof Error ? err.message : 'Enrollment failed');
    } finally {
      if (inputRef.current) inputRef.current.value = '';
    }
  }

  const enrolled = status === 'done';
  return (
    <div>
      <input ref={inputRef} type="file" accept="image/*" className="hidden" onChange={onPick} />
      <button
        onClick={() => inputRef.current?.click()}
        disabled={status === 'uploading'}
        className={`flex w-full items-center justify-center gap-2 rounded-xl border px-3 py-2 text-xs font-medium ${
          enrolled
            ? 'border-emerald-200 bg-emerald-50 text-emerald-700'
            : 'border-border text-muted-foreground hover:bg-muted/50'
        }`}
      >
        {status === 'uploading' ? (
          <Loader2 className="h-3.5 w-3.5 animate-spin" />
        ) : enrolled ? (
          <Check className="h-3.5 w-3.5" />
        ) : (
          <ScanFace className="h-3.5 w-3.5" />
        )}
        {status === 'uploading' ? 'Enrolling…' : enrolled ? 'Face enrolled — re-enroll' : 'Enroll Face'}
      </button>
      {msg && <p className="mt-1 text-[11px] text-destructive">{msg}</p>}
    </div>
  );
}

interface BulkResult { imported: number; created: { employeeCode: string; name: string; phone: string; password: string }[]; errors: string[] }

function BulkUploadModal({ onClose, onDone }: { onClose: () => void; onDone: () => void }) {
  const [file, setFile] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<BulkResult | null>(null);
  const [err, setErr] = useState<string | null>(null);

  function downloadTemplate() {
    downloadCsv('employee-import-template.csv',
      ['name', 'phone', 'salary', 'branch', 'department', 'designation', 'shift', 'email', 'password'],
      [['Ravi Kumar', '9876543210', '15000', 'Bhavani Branch', 'Sales', 'Executive', 'General Shift', 'ravi@example.com', '']]);
  }

  async function upload() {
    if (!file) { setErr('Choose a CSV file first'); return; }
    setBusy(true); setErr(null);
    try {
      const fd = new FormData();
      fd.append('file', file);
      const res = await apiUpload<BulkResult>('/admin/employees/bulk-import', fd);
      setResult(res);
      onDone();
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Import failed');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={onClose}>
      <div className="max-h-[90vh] w-full max-w-lg overflow-y-auto rounded-2xl bg-card p-6 shadow-brand" onClick={(e) => e.stopPropagation()}>
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-lg font-bold">Bulk Upload Employees</h2>
          <button onClick={onClose} className="text-muted-foreground hover:text-foreground"><X className="h-5 w-5" /></button>
        </div>

        {!result ? (
          <>
            <p className="text-sm text-muted-foreground">
              Upload a CSV with columns <b>name, phone, salary</b> (required) and optionally branch, department,
              designation, shift, email, password. Codes auto-generate; blank passwords are auto-created.
            </p>
            <button onClick={downloadTemplate} className="mt-3 text-sm font-semibold text-brand-600 hover:underline">
              ↓ Download CSV template
            </button>
            <input type="file" accept=".csv,text/csv" onChange={(e) => setFile(e.target.files?.[0] ?? null)}
              className="mt-4 block w-full text-sm file:mr-3 file:rounded-lg file:border-0 file:bg-brand-50 file:px-3 file:py-2 file:text-sm file:font-semibold file:text-brand-600" />
            {err && <p className="mt-3 text-sm text-destructive">{err}</p>}
            <div className="mt-5 flex justify-end gap-2">
              <button onClick={onClose} className="h-10 rounded-xl border border-border px-4 text-sm font-medium">Cancel</button>
              <button onClick={upload} disabled={busy} className="flex h-10 items-center gap-2 rounded-xl brand-gradient px-5 text-sm font-semibold text-white disabled:opacity-60">
                {busy && <Loader2 className="h-4 w-4 animate-spin" />} Import
              </button>
            </div>
          </>
        ) : (
          <>
            <p className="text-sm font-semibold text-emerald-600">Imported {result.imported} employee(s).</p>
            {result.errors.length > 0 && (
              <div className="mt-2 rounded-lg bg-rose-50 p-3 text-xs text-rose-700">
                {result.errors.map((e, i) => <div key={i}>{e}</div>)}
              </div>
            )}
            {result.created.length > 0 && (
              <button
                onClick={() => downloadCsv('imported-credentials.csv', ['Employee Code', 'Name', 'Phone', 'App Password'],
                  result.created.map((c) => [c.employeeCode, c.name, c.phone, c.password]))}
                className="mt-3 flex h-10 items-center gap-2 rounded-xl bg-brand-50 px-4 text-sm font-semibold text-brand-600"
              >
                <KeyRound className="h-4 w-4" /> Download credentials of imported staff
              </button>
            )}
            <div className="mt-5 flex justify-end">
              <button onClick={onClose} className="h-10 rounded-xl brand-gradient px-5 text-sm font-semibold text-white">Done</button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
