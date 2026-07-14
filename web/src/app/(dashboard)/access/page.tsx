'use client';

import { useState } from 'react';
import useSWR from 'swr';
import { fetcher, api } from '@/lib/api';
import { PageHero } from '@/components/page-hero';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { ShieldCheck, UserPlus, Loader2, X, KeyRound, Smartphone } from 'lucide-react';

interface AdminRow {
  id: string;
  name: string;
  email: string;
  role: string;
  isActive: boolean;
}
interface EmployeeRow {
  id: string;
  name: string;
  employeeCode: string;
  phone: string;
  status: string;
}

const ROLES = ['SUPER_ADMIN', 'HR_MANAGER', 'BRANCH_MANAGER', 'PAYROLL_ADMIN'];
const roleChip: Record<string, string> = {
  SUPER_ADMIN: 'bg-rose-50 text-rose-700',
  HR_MANAGER: 'bg-indigo-50 text-indigo-700',
  BRANCH_MANAGER: 'bg-amber-50 text-amber-700',
  PAYROLL_ADMIN: 'bg-emerald-50 text-emerald-700',
};

export default function AccessPage() {
  const { data, error, isLoading, mutate } = useSWR<{ admins: AdminRow[] }>('/admin/users', fetcher, { shouldRetryOnError: false });
  const admins = data?.admins ?? [];
  const [showAdd, setShowAdd] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);

  async function update(id: string, body: Record<string, unknown>) {
    setBusyId(id);
    try {
      await api(`/admin/users/${id}`, { method: 'PUT', body: JSON.stringify(body) });
      await mutate();
    } catch (e) {
      alert(e instanceof Error ? e.message : 'Update failed');
    } finally {
      setBusyId(null);
    }
  }

  async function resetPassword(a: AdminRow) {
    const pwd = prompt(`New password for ${a.email} (min 8 chars):`);
    if (!pwd) return;
    if (pwd.length < 8) { alert('Password must be at least 8 characters.'); return; }
    await update(a.id, { password: pwd });
    alert(`Password updated for ${a.email}. Share it privately and store it in a password manager.`);
  }

  const forbidden = error instanceof Error && /permission|forbidden/i.test(error.message);

  return (
    <div className="space-y-6">
      <PageHero title="User Access" subtitle="Who can sign in to the web app & mobile admin — and with what role">
        <button onClick={() => setShowAdd(true)} className="flex h-10 items-center gap-2 rounded-xl bg-white px-4 text-sm font-semibold text-brand-600 hover:bg-white/90">
          <UserPlus className="h-4 w-4" /> Add Admin
        </button>
      </PageHero>

      {isLoading && <div className="flex items-center gap-2 text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin" /> Loading…</div>}
      {error && (
        <Card><CardContent className="p-5 text-sm text-destructive">
          {forbidden ? 'Only a Super Admin can manage user access.' : 'Couldn’t load admin users. Sign in and ensure the backend is running.'}
        </CardContent></Card>
      )}

      {!isLoading && !error && (
        <Card>
          <CardHeader><CardTitle className="text-base flex items-center gap-2"><ShieldCheck className="h-4 w-4" /> Admins & Managers ({admins.length})</CardTitle></CardHeader>
          <CardContent className="space-y-3">
            {admins.map((a) => (
              <div key={a.id} className="flex flex-wrap items-center gap-3 rounded-xl border border-border/60 bg-muted/30 p-4">
                <div className="flex h-10 w-10 items-center justify-center rounded-full brand-gradient text-xs font-bold text-white">
                  {a.name.split(' ').map((n) => n[0]).join('').slice(0, 2)}
                </div>
                <div className="min-w-0 flex-1">
                  <div className="truncate font-semibold">{a.name}</div>
                  <div className="truncate text-xs text-muted-foreground">{a.email}</div>
                </div>

                <select
                  value={a.role}
                  disabled={busyId === a.id}
                  onChange={(e) => update(a.id, { role: e.target.value })}
                  className={`h-9 rounded-lg border-0 px-2 text-xs font-semibold outline-none ${roleChip[a.role] ?? 'bg-muted'}`}
                >
                  {ROLES.map((r) => <option key={r} value={r}>{r.replace('_', ' ')}</option>)}
                </select>

                <button onClick={() => resetPassword(a)} title="Reset password" className="flex h-9 w-9 items-center justify-center rounded-lg border border-border bg-card text-muted-foreground hover:text-foreground">
                  <KeyRound className="h-4 w-4" />
                </button>

                <label className="flex cursor-pointer items-center gap-2 text-xs font-medium">
                  <input
                    type="checkbox"
                    checked={a.isActive}
                    disabled={busyId === a.id}
                    onChange={(e) => update(a.id, { isActive: e.target.checked })}
                    className="h-4 w-4 accent-brand-600"
                  />
                  {a.isActive ? <span className="text-emerald-600">Enabled</span> : <span className="text-rose-600">Disabled</span>}
                </label>
              </div>
            ))}
          </CardContent>
        </Card>
      )}

      {!error && <EmployeeAccessCard />}

      {showAdd && <AddAdminModal onClose={() => setShowAdd(false)} onSaved={() => { setShowAdd(false); mutate(); }} />}
    </div>
  );
}

/** Employee app access — quick enable/disable without leaving this page. */
function EmployeeAccessCard() {
  const { data, isLoading, mutate } = useSWR<{ employees: EmployeeRow[] }>('/admin/employees', fetcher, { shouldRetryOnError: false });
  const employees = data?.employees ?? [];
  const [busyId, setBusyId] = useState<string | null>(null);

  async function setStatus(e: EmployeeRow, active: boolean) {
    setBusyId(e.id);
    try {
      await api(`/admin/employees/${e.id}`, { method: 'PUT', body: JSON.stringify({ status: active ? 'ACTIVE' : 'INACTIVE' }) });
      await mutate();
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Update failed');
    } finally {
      setBusyId(null);
    }
  }

  return (
    <Card>
      <CardHeader><CardTitle className="text-base flex items-center gap-2"><Smartphone className="h-4 w-4" /> Employee App Access ({employees.length})</CardTitle></CardHeader>
      <CardContent className="space-y-2">
        {isLoading && <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />}
        {!isLoading && employees.length === 0 && <div className="text-sm text-muted-foreground">No employees yet.</div>}
        {employees.map((e) => (
          <div key={e.id} className="flex items-center gap-3 rounded-xl border border-border/60 bg-muted/30 px-4 py-2.5">
            <div className="min-w-0 flex-1">
              <span className="font-medium">{e.name}</span>
              <span className="ml-2 text-xs text-muted-foreground">{e.employeeCode} · {e.phone}</span>
            </div>
            <label className="flex cursor-pointer items-center gap-2 text-xs font-medium">
              <input
                type="checkbox"
                checked={e.status === 'ACTIVE'}
                disabled={busyId === e.id}
                onChange={(ev) => setStatus(e, ev.target.checked)}
                className="h-4 w-4 accent-brand-600"
              />
              {e.status === 'ACTIVE' ? <span className="text-emerald-600">Enabled</span> : <span className="text-rose-600">Disabled</span>}
            </label>
          </div>
        ))}
        <p className="pt-1 text-xs text-muted-foreground">Disabled employees cannot log in to the app or check in. Full employee editing lives on the Employees page.</p>
      </CardContent>
    </Card>
  );
}

function AddAdminModal({ onClose, onSaved }: { onClose: () => void; onSaved: () => void }) {
  const [f, setF] = useState({ name: '', email: '', role: 'HR_MANAGER', password: '' });
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const input = 'h-10 w-full rounded-xl border border-border bg-background px-3 text-sm outline-none focus:ring-2 focus:ring-ring/40';

  async function save() {
    setErr(null);
    if (!f.name || !f.email || f.password.length < 8) {
      setErr('Name, email and a password of at least 8 characters are required.');
      return;
    }
    setSaving(true);
    try {
      await api('/admin/users', { method: 'POST', body: JSON.stringify(f) });
      onSaved();
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Failed to create admin');
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={onClose}>
      <div className="w-full max-w-md rounded-2xl bg-card p-6 shadow-brand" onClick={(e) => e.stopPropagation()}>
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-lg font-bold">Add Admin / Manager</h2>
          <button onClick={onClose} className="text-muted-foreground hover:text-foreground"><X className="h-5 w-5" /></button>
        </div>
        <div className="space-y-3">
          <input className={input} placeholder="Full name *" value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} />
          <input className={input} type="email" placeholder="Email (their Google login too) *" value={f.email} onChange={(e) => setF({ ...f, email: e.target.value })} />
          <select className={input} value={f.role} onChange={(e) => setF({ ...f, role: e.target.value })}>
            {ROLES.map((r) => <option key={r} value={r}>{r.replace('_', ' ')}</option>)}
          </select>
          <input className={input} type="password" placeholder="Password (min 8) *" value={f.password} onChange={(e) => setF({ ...f, password: e.target.value })} />
        </div>
        {err && <p className="mt-3 text-sm text-destructive">{err}</p>}
        <div className="mt-5 flex justify-end gap-2">
          <button onClick={onClose} className="h-10 rounded-xl border border-border px-4 text-sm font-medium">Cancel</button>
          <button onClick={save} disabled={saving} className="flex h-10 items-center gap-2 rounded-xl brand-gradient px-5 text-sm font-semibold text-white disabled:opacity-60">
            {saving && <Loader2 className="h-4 w-4 animate-spin" />} Create
          </button>
        </div>
      </div>
    </div>
  );
}
