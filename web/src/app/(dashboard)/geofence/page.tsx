'use client';

import { useState } from 'react';
import useSWR from 'swr';
import dynamic from 'next/dynamic';
import { fetcher, api } from '@/lib/api';
import { PageHero } from '@/components/page-hero';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { MapPin, Loader2, Pencil, Trash2, Plus, X } from 'lucide-react';

// Leaflet touches `window`, so load the map only on the client.
const BranchMap = dynamic(() => import('@/components/branch-map'), {
  ssr: false,
  loading: () => (
    <div className="flex h-[360px] items-center justify-center rounded-2xl bg-muted/40 text-muted-foreground">
      Loading map…
    </div>
  ),
});

interface Branch {
  id: string;
  name: string;
  address: string;
  geofenceLat: number;
  geofenceLng: number;
  geofenceRadius: number;
  strictMode: boolean;
}
interface Violation {
  id: string;
  lat: number;
  lng: number;
  distance: number;
  timestamp: string;
}

interface Draft {
  id: string | null; // null = creating a new branch
  name: string;
  address: string;
  lat: number;
  lng: number;
  radius: number;
  strict: boolean;
}

const input = 'h-10 w-full rounded-xl border border-border bg-background px-3 text-sm outline-none focus:ring-2 focus:ring-ring/40';

export default function GeofencePage() {
  const { data: bd, error, isLoading, mutate } = useSWR<{ branches: Branch[] }>('/admin/branches', fetcher, { shouldRetryOnError: false });
  const { data: vd } = useSWR<{ violations: Violation[] }>('/admin/geofence/violations', fetcher, { shouldRetryOnError: false });
  const branches = bd?.branches ?? [];
  const violations = vd?.violations ?? [];

  const [draft, setDraft] = useState<Draft | null>(null);
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const startEdit = (b: Branch) =>
    setDraft({ id: b.id, name: b.name, address: b.address, lat: b.geofenceLat, lng: b.geofenceLng, radius: b.geofenceRadius, strict: b.strictMode });
  const startNew = () =>
    setDraft({ id: null, name: '', address: '', lat: branches[0]?.geofenceLat ?? 11.4452, lng: branches[0]?.geofenceLng ?? 77.6822, radius: 100, strict: false });

  async function save() {
    if (!draft) return;
    if (!draft.name || !draft.address) {
      setErr('Name and address are required.');
      return;
    }
    setSaving(true);
    setErr(null);
    const body = JSON.stringify({
      name: draft.name,
      address: draft.address,
      geofenceLat: draft.lat,
      geofenceLng: draft.lng,
      geofenceRadius: draft.radius,
      strictMode: draft.strict,
    });
    try {
      if (draft.id) await api(`/admin/branches/${draft.id}`, { method: 'PUT', body });
      else await api('/admin/branches', { method: 'POST', body });
      setDraft(null);
      await mutate();
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Save failed');
    } finally {
      setSaving(false);
    }
  }

  async function remove(b: Branch) {
    if (!confirm(`Delete branch "${b.name}"? This cannot be undone.`)) return;
    try {
      await api(`/admin/branches/${b.id}`, { method: 'DELETE' });
      if (draft?.id === b.id) setDraft(null);
      await mutate();
    } catch (e) {
      alert(e instanceof Error ? e.message : 'Delete failed');
    }
  }

  return (
    <div className="space-y-6">
      <PageHero title="Geofence" subtitle="Flexible work zones — click the map to move a fence · live">
        <button onClick={startNew} className="flex h-10 items-center gap-2 rounded-xl bg-white px-4 text-sm font-semibold text-brand-600 hover:bg-white/90">
          <Plus className="h-4 w-4" /> Add Branch
        </button>
      </PageHero>

      {!isLoading && !error && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">
              {draft ? `Editing: ${draft.name || 'New branch'} — click the map to set the centre` : 'Branch Map'}
            </CardTitle>
          </CardHeader>
          <CardContent>
            <BranchMap
              branches={branches.filter((b) => b.id !== draft?.id)}
              draft={draft ? { lat: draft.lat, lng: draft.lng, radius: draft.radius } : null}
              onMapClick={draft ? (lat, lng) => setDraft((d) => (d ? { ...d, lat, lng } : d)) : undefined}
            />
            <p className="mt-2 text-xs text-muted-foreground">
              Red = strict zone · Green = soft zone {draft && '· Dashed indigo = the fence you are editing'}
            </p>
          </CardContent>
        </Card>
      )}

      {/* Editor panel */}
      {draft && (
        <Card>
          <CardHeader className="flex flex-row items-center justify-between">
            <CardTitle className="text-base">{draft.id ? 'Edit Branch & Geofence' : 'New Branch'}</CardTitle>
            <button onClick={() => setDraft(null)} className="text-muted-foreground hover:text-foreground"><X className="h-5 w-5" /></button>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid gap-3 sm:grid-cols-2">
              <input className={input} placeholder="Branch name *" value={draft.name} onChange={(e) => setDraft({ ...draft, name: e.target.value })} />
              <input className={input} placeholder="Address *" value={draft.address} onChange={(e) => setDraft({ ...draft, address: e.target.value })} />
              <input className={input} type="number" step="0.0001" placeholder="Latitude" value={draft.lat} onChange={(e) => setDraft({ ...draft, lat: parseFloat(e.target.value) || 0 })} />
              <input className={input} type="number" step="0.0001" placeholder="Longitude" value={draft.lng} onChange={(e) => setDraft({ ...draft, lng: parseFloat(e.target.value) || 0 })} />
            </div>

            <div>
              <div className="mb-1 flex items-center justify-between text-sm">
                <span className="font-medium">Geofence radius</span>
                <span className="text-muted-foreground">{draft.radius} m</span>
              </div>
              <input
                type="range"
                min={20}
                max={2000}
                step={10}
                value={draft.radius}
                onChange={(e) => setDraft({ ...draft, radius: parseInt(e.target.value) })}
                className="w-full accent-brand-600"
              />
              <div className="flex justify-between text-[11px] text-muted-foreground"><span>20 m</span><span>2 km</span></div>
            </div>

            <label className="flex cursor-pointer items-center gap-3 text-sm">
              <input type="checkbox" checked={draft.strict} onChange={(e) => setDraft({ ...draft, strict: e.target.checked })} className="h-4 w-4 accent-brand-600" />
              <span>
                <span className="font-medium">Strict mode</span>
                <span className="text-muted-foreground"> — block check-ins outside the fence (soft mode allows but flags them)</span>
              </span>
            </label>

            {err && <p className="text-sm text-destructive">{err}</p>}
            <div className="flex justify-end gap-2">
              <button onClick={() => setDraft(null)} className="h-10 rounded-xl border border-border px-4 text-sm font-medium">Cancel</button>
              <button onClick={save} disabled={saving} className="flex h-10 items-center gap-2 rounded-xl brand-gradient px-5 text-sm font-semibold text-white disabled:opacity-60">
                {saving && <Loader2 className="h-4 w-4 animate-spin" />} {draft.id ? 'Save Changes' : 'Create Branch'}
              </button>
            </div>
          </CardContent>
        </Card>
      )}

      {isLoading && <div className="flex items-center gap-2 text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin" /> Loading…</div>}
      {error && <Card><CardContent className="p-5 text-sm text-destructive">Couldn&apos;t load geofences. Sign in and ensure the backend is running.</CardContent></Card>}

      {!isLoading && !error && (
        <div className="grid gap-4 lg:grid-cols-3">
          <Card className="lg:col-span-2">
            <CardHeader><CardTitle className="text-base">Branches ({branches.length})</CardTitle></CardHeader>
            <CardContent className="space-y-3">
              {branches.length === 0 && <div className="text-sm text-muted-foreground">No branches yet — add one.</div>}
              {branches.map((b) => (
                <div key={b.id} className="flex flex-wrap items-center gap-3 rounded-xl border border-border/60 bg-muted/30 p-4">
                  <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-brand-50 text-brand-600"><MapPin className="h-5 w-5" /></div>
                  <div className="min-w-0 flex-1">
                    <div className="truncate font-semibold">{b.name}</div>
                    <div className="text-xs text-muted-foreground">
                      {b.address} · {b.geofenceLat.toFixed(4)}, {b.geofenceLng.toFixed(4)} · radius {b.geofenceRadius}m
                    </div>
                  </div>
                  <span className={`chip ${b.strictMode ? 'chip-off' : 'chip-present'}`}>{b.strictMode ? 'Strict' : 'Soft'}</span>
                  <div className="flex gap-2">
                    <button onClick={() => startEdit(b)} title="Edit branch & geofence" className="flex h-9 w-9 items-center justify-center rounded-lg border border-border bg-card text-muted-foreground hover:text-foreground">
                      <Pencil className="h-4 w-4" />
                    </button>
                    <button onClick={() => remove(b)} title="Delete branch" className="flex h-9 w-9 items-center justify-center rounded-lg bg-rose-50 text-rose-600 hover:bg-rose-100">
                      <Trash2 className="h-4 w-4" />
                    </button>
                  </div>
                </div>
              ))}
            </CardContent>
          </Card>

          <Card>
            <CardHeader><CardTitle className="text-base">Violations ({violations.length})</CardTitle></CardHeader>
            <CardContent className="space-y-3">
              {violations.length === 0 && <div className="text-sm text-muted-foreground">No violations logged. 🎉</div>}
              {violations.map((v) => (
                <div key={v.id} className="rounded-xl border border-border/60 bg-rose-50/50 p-3 text-sm">
                  <div className="font-medium text-rose-600">{Math.round(v.distance)}m outside zone</div>
                  <div className="text-xs text-muted-foreground">{new Date(v.timestamp).toLocaleString()}</div>
                </div>
              ))}
            </CardContent>
          </Card>
        </div>
      )}
    </div>
  );
}
