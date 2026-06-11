'use client';

import { useRef, useState } from 'react';
import useSWR from 'swr';
import { fetcher, api, apiUpload } from '@/lib/api';
import { PageHero } from '@/components/page-hero';
import { Card, CardContent } from '@/components/ui/card';
import { UserPlus, Loader2, X, ScanFace, Check } from 'lucide-react';

interface EmployeeRow {
  id: string;
  name: string;
  employeeCode: string;
  phone: string;
  status: string;
  faceTemplateId?: string | null;
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
  const [open, setOpen] = useState(false);

  return (
    <div className="space-y-6">
      <PageHero title="Employees" subtitle={`${employees.length} staff · live from database`}>
        <button onClick={() => setOpen(true)} className="flex h-10 items-center gap-2 rounded-xl bg-white px-4 text-sm font-semibold text-brand-600 hover:bg-white/90">
          <UserPlus className="h-4 w-4" /> Add Employee
        </button>
      </PageHero>

      {isLoading && <div className="flex items-center gap-2 text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin" /> Loading…</div>}
      {error && <Card><CardContent className="p-5 text-sm text-destructive">Couldn&apos;t load employees. Sign in and ensure the backend is running.</CardContent></Card>}

      {!isLoading && !error && (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {employees.length === 0 && <Card><CardContent className="p-5 text-sm text-muted-foreground">No employees yet — add one.</CardContent></Card>}
          {employees.map((e) => (
            <Card key={e.id}>
              <CardContent className="flex flex-col gap-3 p-5">
                <div className="flex items-center gap-4">
                  <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-full brand-gradient text-sm font-bold text-white">
                    {e.name.split(' ').map((n) => n[0]).join('').slice(0, 2)}
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="truncate font-semibold">{e.name}</div>
                    <div className="truncate text-xs text-muted-foreground">{e.employeeCode} · {e.branch?.name ?? '—'}</div>
                  </div>
                  <span className={`chip ${chipClass[e.status] ?? 'chip-leave'}`}>{e.status}</span>
                </div>
                <EnrollFaceButton employee={e} onEnrolled={() => mutate()} />
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      {open && <AddEmployeeModal onClose={() => setOpen(false)} onSaved={() => { setOpen(false); mutate(); }} />}
    </div>
  );
}

function AddEmployeeModal({ onClose, onSaved }: { onClose: () => void; onSaved: () => void }) {
  const { data: br } = useSWR<{ branches: Named[] }>('/admin/branches', fetcher, { shouldRetryOnError: false });
  const { data: dp } = useSWR<{ departments: Named[] }>('/admin/departments', fetcher, { shouldRetryOnError: false });
  const { data: dg } = useSWR<{ designations: Named[] }>('/admin/designations', fetcher, { shouldRetryOnError: false });
  const { data: sh } = useSWR<{ shifts: Named[] }>('/shifts', fetcher, { shouldRetryOnError: false });

  const [f, setF] = useState({
    name: '', employeeCode: '', phone: '', email: '', salary: '', password: '',
    joiningDate: new Date().toISOString().slice(0, 10),
    branchId: '', departmentId: '', designationId: '', shiftId: '',
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
    if (!f.password || f.password.length < 4) {
      setErr('Set an app login password (min 4 characters) for the employee.');
      return;
    }
    setSaving(true);
    try {
      await api('/admin/employees', {
        method: 'POST',
        body: JSON.stringify({
          ...f,
          email: f.email || undefined,
          salary: Number(f.salary),
        }),
      });
      onSaved();
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Failed to add employee');
    } finally {
      setSaving(false);
    }
  }

  const input = 'h-10 w-full rounded-xl border border-border bg-background px-3 text-sm outline-none focus:ring-2 focus:ring-ring/40';

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={onClose}>
      <div className="w-full max-w-lg rounded-2xl bg-card p-6 shadow-brand" onClick={(e) => e.stopPropagation()}>
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-lg font-bold">Add Employee</h2>
          <button onClick={onClose} className="text-muted-foreground hover:text-foreground"><X className="h-5 w-5" /></button>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <input className={input} placeholder="Full name *" value={f.name} onChange={(e) => set('name', e.target.value)} />
          <input className={input} placeholder="Employee code *" value={f.employeeCode} onChange={(e) => set('employeeCode', e.target.value)} />
          <input className={input} placeholder="Phone * (+91…)" value={f.phone} onChange={(e) => set('phone', e.target.value)} />
          <input className={input} placeholder="Email" value={f.email} onChange={(e) => set('email', e.target.value)} />
          <input className={input} type="password" placeholder="App login password *" value={f.password} onChange={(e) => set('password', e.target.value)} />
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
        </div>
        {err && <p className="mt-3 text-sm text-destructive">{err}</p>}
        <div className="mt-5 flex justify-end gap-2">
          <button onClick={onClose} className="h-10 rounded-xl border border-border px-4 text-sm font-medium">Cancel</button>
          <button onClick={save} disabled={saving} className="flex h-10 items-center gap-2 rounded-xl brand-gradient px-5 text-sm font-semibold text-white disabled:opacity-60">
            {saving && <Loader2 className="h-4 w-4 animate-spin" />} Save
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
