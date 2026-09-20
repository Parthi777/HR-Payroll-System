'use client';

import { useCallback, useEffect, useState } from 'react';
import { AlertTriangle, Check, Copy, Loader2, MonitorSmartphone, Plus, RotateCcw, Trash2 } from 'lucide-react';
import { api } from '@/lib/api';
import { PageHero } from '@/components/page-hero';

interface Kiosk {
  id: string;
  name: string;
  branchId: string;
  branch: { id: string; name: string };
  isActive: boolean;
  pairedAt: string | null;
  lastSeenAt: string | null;
  pairingPending: boolean;
  branchLocationSet: boolean;
}

interface Branch {
  id: string;
  name: string;
}

/** A pairing code, which exists on screen and nowhere else. */
interface Handover {
  kioskName: string;
  code: string;
  minutes: number;
}

/**
 * Tablets that punch for a branch.
 *
 * The page is mostly about one thing: a pairing code is a credential that turns
 * any tablet into a device able to mark that branch's staff present. So it is
 * shown once, it expires, and switching a kiosk off here stops it on its next
 * request rather than whenever its token would have run out.
 */
export default function KiosksPage() {
  const [kiosks, setKiosks] = useState<Kiosk[] | null>(null);
  const [branches, setBranches] = useState<Branch[]>([]);
  const [liveness, setLiveness] = useState<{ enabled: boolean; region: string } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [handover, setHandover] = useState<Handover | null>(null);

  const load = useCallback(async () => {
    try {
      const [list, branchList] = await Promise.all([
        api<{ kiosks: Kiosk[]; liveness: { enabled: boolean; region: string } }>('/admin/kiosks'),
        api<{ branches: Branch[] }>('/admin/branches'),
      ]);
      setKiosks(list.kiosks);
      setLiveness(list.liveness);
      setBranches(branchList.branches);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not load the kiosks');
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  async function repair(kiosk: Kiosk) {
    setBusyId(kiosk.id);
    setError(null);
    try {
      const res = await api<{ pairingCode: string; expiresInMinutes: number }>(
        `/admin/kiosks/${kiosk.id}/pairing-code`, { method: 'POST' },
      );
      setHandover({ kioskName: kiosk.name, code: res.pairingCode, minutes: res.expiresInMinutes });
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not issue a code');
    } finally {
      setBusyId(null);
    }
  }

  async function setActive(kiosk: Kiosk, isActive: boolean) {
    if (!isActive && !confirm(`Switch off ${kiosk.name}?\n\nThe tablet stops working immediately and has to be paired again.`)) return;
    setBusyId(kiosk.id);
    setError(null);
    try {
      await api(`/admin/kiosks/${kiosk.id}`, { method: 'PATCH', body: JSON.stringify({ isActive }) });
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not change the kiosk');
    } finally {
      setBusyId(null);
    }
  }

  async function remove(kiosk: Kiosk) {
    if (!confirm(`Remove ${kiosk.name}?\n\nAttendance already marked on it is kept. The tablet stops working.`)) return;
    setBusyId(kiosk.id);
    try {
      await api(`/admin/kiosks/${kiosk.id}`, { method: 'DELETE' });
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not remove the kiosk');
    } finally {
      setBusyId(null);
    }
  }

  return (
    <div className="space-y-6">
      <PageHero
        title="Kiosks"
        subtitle="Tablets at a branch door that staff punch on — employee code, then a look at the camera."
      >
        <button
          onClick={() => { setShowForm((v) => !v); setHandover(null); }}
          className="flex h-11 items-center gap-2 rounded-xl bg-white px-4 text-sm font-semibold text-brand-600"
        >
          <Plus className="h-4 w-4" /> Add kiosk
        </button>
      </PageHero>

      {error && <p className="rounded-xl bg-destructive/10 p-3 text-sm text-destructive">{error}</p>}

      {liveness && !liveness.enabled && (
        <p className="flex items-start gap-2.5 rounded-2xl border border-amber-500/30 bg-amber-50 p-4 text-sm text-amber-900">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
          <span>
            <strong>The live-person check is off.</strong> Punches are matched against the enrolled face,
            but a printed photo held up to the tablet would also pass. Keep the tablet where someone can
            see it, or ask us to switch on AWS liveness.
          </span>
        </p>
      )}

      {handover && <CodeHandover handover={handover} onDone={() => setHandover(null)} />}

      {showForm && !handover && (
        <NewKioskForm
          branches={branches}
          onCancel={() => setShowForm(false)}
          onCreated={(h) => { setHandover(h); setShowForm(false); void load(); }}
        />
      )}

      {kiosks === null ? (
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" /> Loading…
        </div>
      ) : kiosks.length === 0 ? (
        <div className="rounded-2xl border border-border bg-card p-10 text-center">
          <MonitorSmartphone className="mx-auto h-8 w-8 text-muted-foreground" />
          <h2 className="mt-3 font-semibold">No kiosks yet</h2>
          <p className="mx-auto mt-1 max-w-md text-sm text-muted-foreground">
            Add one for a branch, then open <span className="font-mono">/kiosk</span> on the tablet and type
            the pairing code. Staff punch with their employee code and a look at the camera — no phone needed.
          </p>
        </div>
      ) : (
        <ul className="grid gap-4 sm:grid-cols-2">
          {kiosks.map((kiosk) => (
            <li key={kiosk.id} className={`rounded-2xl border border-border bg-card p-5 ${kiosk.isActive ? '' : 'opacity-60'}`}>
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="font-bold">{kiosk.name}</div>
                  <div className="text-sm text-muted-foreground">{kiosk.branch.name}</div>
                </div>
                <span className={`shrink-0 rounded-full px-2 py-0.5 text-xs font-semibold ${
                  !kiosk.isActive ? 'bg-slate-200 text-slate-600'
                    : kiosk.pairingPending ? 'bg-amber-100 text-amber-800'
                    : kiosk.pairedAt ? 'bg-emerald-100 text-emerald-700'
                    : 'bg-slate-200 text-slate-600'
                }`}>
                  {!kiosk.isActive ? 'Off' : kiosk.pairingPending ? 'Waiting to pair' : kiosk.pairedAt ? 'Paired' : 'Not paired'}
                </span>
              </div>

              {!kiosk.branchLocationSet && (
                <p className="mt-3 flex items-start gap-2 rounded-xl bg-amber-50 p-3 text-xs text-amber-900">
                  <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                  {kiosk.branch.name} has no location on the map yet, so punches here will be refused. Set it
                  under Geofence first.
                </p>
              )}

              <dl className="mt-4 space-y-1 text-xs text-muted-foreground">
                <div>Paired {kiosk.pairedAt ? new Date(kiosk.pairedAt).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' }) : '—'}</div>
                <div>Last used {kiosk.lastSeenAt ? new Date(kiosk.lastSeenAt).toLocaleString('en-IN', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }) : 'never'}</div>
              </dl>

              <div className="mt-4 flex flex-wrap gap-2">
                {busyId === kiosk.id ? (
                  <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
                ) : (
                  <>
                    <button onClick={() => repair(kiosk)} className="inline-flex items-center gap-1.5 rounded-lg border border-border px-3 py-1.5 text-xs font-medium hover:bg-muted">
                      <RotateCcw className="h-3.5 w-3.5" /> {kiosk.pairedAt ? 'New pairing code' : 'Pairing code'}
                    </button>
                    <button onClick={() => setActive(kiosk, !kiosk.isActive)} className="rounded-lg border border-border px-3 py-1.5 text-xs font-medium hover:bg-muted">
                      {kiosk.isActive ? 'Switch off' : 'Switch on'}
                    </button>
                    <button onClick={() => remove(kiosk)} className="inline-flex items-center gap-1.5 rounded-lg border border-border px-3 py-1.5 text-xs font-medium text-destructive hover:bg-destructive/5">
                      <Trash2 className="h-3.5 w-3.5" /> Remove
                    </button>
                  </>
                )}
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function NewKioskForm({
  branches,
  onCreated,
  onCancel,
}: {
  branches: Branch[];
  onCreated: (h: Handover) => void;
  onCancel: () => void;
}) {
  const [name, setName] = useState('');
  const [branchId, setBranchId] = useState(branches[0]?.id ?? '');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => { if (!branchId && branches[0]) setBranchId(branches[0].id); }, [branches, branchId]);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const res = await api<{ pairingCode: string; expiresInMinutes: number }>('/admin/kiosks', {
        method: 'POST',
        body: JSON.stringify({ name: name.trim(), branchId }),
      });
      onCreated({ kioskName: name.trim(), code: res.pairingCode, minutes: res.expiresInMinutes });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not create the kiosk');
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit} className="space-y-4 rounded-2xl border border-border bg-card p-6">
      <h2 className="font-semibold">New kiosk</h2>
      <div className="grid gap-4 sm:grid-cols-2">
        <label className="block">
          <span className="mb-1 block text-sm font-medium">Name</span>
          <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Reception tablet" className={inputClass} required />
          <span className="mt-1 block text-xs text-muted-foreground">Where it stands, so you know which is which.</span>
        </label>
        <label className="block">
          <span className="mb-1 block text-sm font-medium">Branch</span>
          <select value={branchId} onChange={(e) => setBranchId(e.target.value)} className={inputClass} required>
            {branches.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
          </select>
          <span className="mt-1 block text-xs text-muted-foreground">Only this branch&rsquo;s staff can punch on it.</span>
        </label>
      </div>

      {error && <p className="text-sm text-destructive">{error}</p>}

      <div className="flex gap-2">
        <button type="submit" disabled={busy || !branchId} className="flex items-center gap-2 rounded-xl brand-gradient px-4 py-2.5 text-sm font-semibold text-white disabled:opacity-60">
          {busy && <Loader2 className="h-4 w-4 animate-spin" />}
          {busy ? 'Creating…' : 'Create and show code'}
        </button>
        <button type="button" onClick={onCancel} className="rounded-xl border border-border px-4 py-2.5 text-sm">Cancel</button>
      </div>
    </form>
  );
}

/** The pairing code, shown once — it is stored only as a hash. */
function CodeHandover({ handover, onDone }: { handover: Handover; onDone: () => void }) {
  const [copied, setCopied] = useState(false);
  return (
    <div className="space-y-4 rounded-2xl border-2 border-emerald-500/40 bg-emerald-50 p-6">
      <div>
        <h2 className="font-semibold text-emerald-900">Pair {handover.kioskName}</h2>
        <p className="text-sm text-emerald-800">
          On the tablet, open <span className="font-mono">/kiosk</span>, enter your workspace address and this
          code. It works once and expires in {handover.minutes} minutes. <strong>It is not shown again</strong> —
          issue a new one if it is lost.
        </p>
      </div>

      <div className="rounded-xl bg-white p-6 text-center">
        <div className="font-mono text-4xl font-bold tracking-[0.2em]">{handover.code}</div>
      </div>

      <div className="flex flex-wrap gap-2">
        <button
          onClick={async () => { await navigator.clipboard.writeText(handover.code); setCopied(true); setTimeout(() => setCopied(false), 2000); }}
          className="flex items-center gap-2 rounded-xl bg-emerald-600 px-4 py-2.5 text-sm font-semibold text-white"
        >
          {copied ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}
          {copied ? 'Copied' : 'Copy code'}
        </button>
        <button onClick={onDone} className="rounded-xl border border-emerald-600/30 px-4 py-2.5 text-sm">Done</button>
      </div>
    </div>
  );
}

const inputClass =
  'w-full rounded-xl border border-border bg-muted/40 px-3 py-2.5 text-sm outline-none focus:border-primary';
