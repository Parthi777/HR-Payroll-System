'use client';

import { useState } from 'react';
import useSWR from 'swr';
import { fetcher, api } from '@/lib/api';
import { PageHero } from '@/components/page-hero';
import { Card, CardContent } from '@/components/ui/card';
import { Plus, Clock, Loader2, Pencil, Trash2, X } from 'lucide-react';

interface ShiftRow {
  id: string;
  name: string;
  startTime: string;
  endTime: string;
  gracePeriod: number;
  otThresholdHours?: number;
  isNightShift: boolean;
}

export default function ShiftsPage() {
  const { data, error, isLoading, mutate } = useSWR<{ shifts: ShiftRow[] }>('/shifts', fetcher, {
    shouldRetryOnError: false,
  });
  const shifts = data?.shifts ?? [];
  const [modal, setModal] = useState<{ shift: ShiftRow | null } | null>(null);

  async function remove(s: ShiftRow) {
    if (!confirm(`Delete shift "${s.name}"?`)) return;
    try {
      await api(`/admin/shifts/${s.id}`, { method: 'DELETE' });
      await mutate();
    } catch (e) {
      alert(e instanceof Error ? e.message : 'Delete failed');
    }
  }

  return (
    <div className="space-y-6">
      <PageHero title="Shifts" subtitle="Shift types, grace periods & rotations · live">
        <button onClick={() => setModal({ shift: null })} className="flex h-10 items-center gap-2 rounded-xl bg-white px-4 text-sm font-semibold text-brand-600 hover:bg-white/90">
          <Plus className="h-4 w-4" /> New Shift
        </button>
      </PageHero>

      {isLoading && <div className="flex items-center gap-2 text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin" /> Loading shifts…</div>}
      {error && <Card><CardContent className="p-5 text-sm text-destructive">Couldn&apos;t load shifts. Sign in and ensure the backend is running.</CardContent></Card>}

      {!isLoading && !error && (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {shifts.length === 0 && (
            <Card><CardContent className="p-5 text-sm text-muted-foreground">No shifts defined — create one.</CardContent></Card>
          )}
          {shifts.map((s) => (
            <Card key={s.id}>
              <CardContent className="p-5">
                <div className="mb-3 flex items-start justify-between">
                  <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-brand-50 text-brand-600">
                    <Clock className="h-5 w-5" />
                  </div>
                  <div className="flex gap-1">
                    <button onClick={() => setModal({ shift: s })} title="Edit shift" className="flex h-8 w-8 items-center justify-center rounded-lg border border-border text-muted-foreground hover:text-foreground">
                      <Pencil className="h-3.5 w-3.5" />
                    </button>
                    <button onClick={() => remove(s)} title="Delete shift" className="flex h-8 w-8 items-center justify-center rounded-lg bg-rose-50 text-rose-600 hover:bg-rose-100">
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  </div>
                </div>
                <div className="text-lg font-bold">{s.name}</div>
                <div className="text-sm text-muted-foreground">{s.startTime} – {s.endTime}</div>
                <div className="mt-4 flex flex-wrap items-center gap-2 text-xs">
                  {s.isNightShift && <span className="chip chip-leave">Night</span>}
                  <span className="text-muted-foreground">Grace {s.gracePeriod}m</span>
                  <span className="text-muted-foreground">· OT after {s.otThresholdHours ?? 10}h</span>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      {modal && (
        <ShiftModal
          shift={modal.shift}
          onClose={() => setModal(null)}
          onSaved={() => { setModal(null); mutate(); }}
        />
      )}
    </div>
  );
}

function ShiftModal({ shift, onClose, onSaved }: { shift: ShiftRow | null; onClose: () => void; onSaved: () => void }) {
  const editing = !!shift;
  const [f, setF] = useState({
    name: shift?.name ?? '',
    startTime: shift?.startTime ?? '09:00',
    endTime: shift?.endTime ?? '18:00',
    gracePeriod: shift ? String(shift.gracePeriod) : '15',
    otThresholdHours: shift?.otThresholdHours != null ? String(shift.otThresholdHours) : '10',
    isNightShift: shift?.isNightShift ?? false,
  });
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function save() {
    setErr(null);
    if (!f.name || !/^\d{2}:\d{2}$/.test(f.startTime) || !/^\d{2}:\d{2}$/.test(f.endTime)) {
      setErr('Name and valid HH:MM times are required.');
      return;
    }
    setSaving(true);
    try {
      const body = JSON.stringify({
        name: f.name,
        startTime: f.startTime,
        endTime: f.endTime,
        gracePeriod: parseInt(f.gracePeriod) || 0,
        otThresholdHours: parseFloat(f.otThresholdHours) || 0,
        isNightShift: f.isNightShift,
      });
      if (editing) await api(`/admin/shifts/${shift!.id}`, { method: 'PUT', body });
      else await api('/admin/shifts', { method: 'POST', body });
      onSaved();
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Failed to save shift');
    } finally {
      setSaving(false);
    }
  }

  const input = 'h-10 w-full rounded-xl border border-border bg-background px-3 text-sm outline-none focus:ring-2 focus:ring-ring/40';

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={onClose}>
      <div className="w-full max-w-md rounded-2xl bg-card p-6 shadow-brand" onClick={(e) => e.stopPropagation()}>
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-lg font-bold">{editing ? `Edit ${shift!.name}` : 'New Shift'}</h2>
          <button onClick={onClose} className="text-muted-foreground hover:text-foreground"><X className="h-5 w-5" /></button>
        </div>
        <div className="space-y-3">
          <input className={input} placeholder="Shift name * (e.g. Morning Shift)" value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} />
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="mb-1 block text-xs text-muted-foreground">Start time</label>
              <input className={input} type="time" value={f.startTime} onChange={(e) => setF({ ...f, startTime: e.target.value })} />
            </div>
            <div>
              <label className="mb-1 block text-xs text-muted-foreground">End time</label>
              <input className={input} type="time" value={f.endTime} onChange={(e) => setF({ ...f, endTime: e.target.value })} />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="mb-1 block text-xs text-muted-foreground">Grace period (min late allowed)</label>
              <input className={input} type="number" min={0} max={120} value={f.gracePeriod} onChange={(e) => setF({ ...f, gracePeriod: e.target.value })} />
            </div>
            <div>
              <label className="mb-1 block text-xs text-muted-foreground">OT after (hours/day)</label>
              <input className={input} type="number" min={0} max={24} step={0.5} value={f.otThresholdHours} onChange={(e) => setF({ ...f, otThresholdHours: e.target.value })} />
            </div>
          </div>
          <p className="text-xs text-muted-foreground">Overtime is counted only for duty time beyond the &quot;OT after&quot; hours each day.</p>
          <label className="flex cursor-pointer items-center gap-3 text-sm">
            <input type="checkbox" checked={f.isNightShift} onChange={(e) => setF({ ...f, isNightShift: e.target.checked })} className="h-4 w-4 accent-brand-600" />
            Night shift (crosses midnight)
          </label>
        </div>
        {err && <p className="mt-3 text-sm text-destructive">{err}</p>}
        <div className="mt-5 flex justify-end gap-2">
          <button onClick={onClose} className="h-10 rounded-xl border border-border px-4 text-sm font-medium">Cancel</button>
          <button onClick={save} disabled={saving} className="flex h-10 items-center gap-2 rounded-xl brand-gradient px-5 text-sm font-semibold text-white disabled:opacity-60">
            {saving && <Loader2 className="h-4 w-4 animate-spin" />} {editing ? 'Save Changes' : 'Create Shift'}
          </button>
        </div>
      </div>
    </div>
  );
}
