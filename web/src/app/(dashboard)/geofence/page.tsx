'use client';

import { useState } from 'react';
import useSWR from 'swr';
import dynamic from 'next/dynamic';
import { fetcher, api } from '@/lib/api';
import { PageHero } from '@/components/page-hero';
import { can, SETUP_ROLES } from '@/lib/permissions';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { MapPin, Loader2, Pencil, Trash2, Plus, X, LocateFixed, Circle as CircleIcon, Square, Hexagon, Undo2, Eraser } from 'lucide-react';
import { parseOutline, rectangle, type Corner } from '@/lib/geofence';

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
  /** JSON corners when the fence is drawn round the building. */
  geofencePolygon?: string | null;
}
interface Violation {
  id: string;
  lat: number;
  lng: number;
  distance: number;
  timestamp: string;
  employeeName?: string;
  employeeCode?: string;
  branchName?: string;
}

interface Draft {
  id: string | null; // null = creating a new branch
  name: string;
  address: string;
  lat: number;
  lng: number;
  radius: number;
  strict: boolean;
  /** Circle round a pin, a rectangle from two corners, or an outline clicked corner by corner. */
  shape: Shape;
  corners: Corner[];
  /** Rectangle mode: the first corner, waiting for the opposite one. */
  rectStart: Corner | null;
}

type Shape = 'circle' | 'rectangle' | 'outline';

const SHAPES: { key: Shape; label: string; icon: typeof Square; hint: string }[] = [
  { key: 'circle', label: 'Circle', icon: CircleIcon, hint: 'Click the map or drag the pin to set the centre, then choose a radius.' },
  { key: 'rectangle', label: 'Rectangle', icon: Square, hint: 'Click one corner of the building, then the opposite corner. Click again to start over.' },
  { key: 'outline', label: 'Building outline', icon: Hexagon, hint: 'Click each corner of the building in order, going round it. Drag a numbered corner to adjust it.' },
];

const input = 'h-10 w-full rounded-xl border border-border bg-background px-3 text-sm outline-none focus:ring-2 focus:ring-ring/40';

export default function GeofencePage() {
  const { data: bd, error, isLoading, mutate } = useSWR<{ branches: Branch[] }>('/admin/branches', fetcher, { shouldRetryOnError: false });
  const { data: vd } = useSWR<{ violations: Violation[] }>('/admin/geofence/violations', fetcher, { shouldRetryOnError: false });
  const branches = bd?.branches ?? [];
  const violations = vd?.violations ?? [];

  const [draft, setDraft] = useState<Draft | null>(null);
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [locating, setLocating] = useState(false);
  const [gpsInfo, setGpsInfo] = useState<string | null>(null);

  /** Fill lat/lng from the browser's GPS — stand at the branch for an exact fix. */
  function useMyLocation() {
    if (!navigator.geolocation) {
      setErr('This browser does not support geolocation.');
      return;
    }
    setLocating(true);
    setGpsInfo(null);
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        setDraft((d) => (d ? { ...d, lat: pos.coords.latitude, lng: pos.coords.longitude } : d));
        setGpsInfo(`GPS fix: ±${Math.round(pos.coords.accuracy)}m accuracy`);
        setLocating(false);
      },
      (e) => {
        setErr(
          e.code === e.PERMISSION_DENIED
            ? 'Location permission denied — allow it in the browser and try again.'
            : `Could not get location: ${e.message}`,
        );
        setLocating(false);
      },
      { enableHighAccuracy: true, timeout: 15000, maximumAge: 0 },
    );
  }

  const startEdit = (b: Branch) => {
    const outline = parseOutline(b.geofencePolygon);
    setDraft({
      id: b.id, name: b.name, address: b.address, lat: b.geofenceLat, lng: b.geofenceLng, radius: b.geofenceRadius, strict: b.strictMode,
      shape: outline ? 'outline' : 'circle', corners: outline ?? [], rectStart: null,
    });
  };
  const startNew = () =>
    setDraft({
      id: null, name: '', address: '', lat: branches[0]?.geofenceLat ?? 11.4452, lng: branches[0]?.geofenceLng ?? 77.6822, radius: 100, strict: false,
      shape: 'circle', corners: [], rectStart: null,
    });

  /** What a click on the map means depends on the shape being drawn. */
  function mapClick(lat: number, lng: number) {
    setDraft((d) => {
      if (!d) return d;
      if (d.shape === 'circle') return { ...d, lat, lng };
      if (d.shape === 'outline') return { ...d, corners: [...d.corners, { lat, lng }] };
      // Rectangle: first click is one corner, the second the opposite one.
      if (!d.rectStart) return { ...d, rectStart: { lat, lng }, corners: [{ lat, lng }] };
      return { ...d, rectStart: null, corners: rectangle(d.rectStart, { lat, lng }) };
    });
  }
  const setShape = (shape: Shape) =>
    setDraft((d) => (d ? { ...d, shape, rectStart: null, corners: shape === 'circle' ? d.corners : shape === d.shape ? d.corners : [] } : d));
  const isOutline = draft ? draft.shape !== 'circle' : false;

  async function save() {
    if (!draft) return;
    if (!draft.name || !draft.address) {
      setErr('Name and address are required.');
      return;
    }
    if (draft.shape !== 'circle' && draft.corners.length < 3) {
      setErr(draft.shape === 'rectangle' ? 'Click two opposite corners of the building.' : 'Click at least 3 corners round the building.');
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
      // The outline is the fence when drawn; null puts the branch back on its circle.
      geofencePolygon: draft.shape === 'circle' ? null : draft.corners,
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

  // Branch managers see the fences; only the owner and HR move them (the API refuses anyone else).
  const canEdit = can(SETUP_ROLES);

  return (
    <div className="space-y-6">
      <PageHero title="Geofence" subtitle="Flexible work zones — click the map to move a fence · live">
        {canEdit && <button onClick={startNew} className="flex h-10 items-center gap-2 rounded-xl bg-white px-4 text-sm font-semibold text-brand-600 hover:bg-white/90">
          <Plus className="h-4 w-4" /> Add Branch
        </button>}
      </PageHero>

      {!isLoading && !error && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">
              {draft ? `Editing: ${draft.name || 'New branch'} — ${SHAPES.find((x) => x.key === draft.shape)!.hint}` : 'Branch Map'}
            </CardTitle>
          </CardHeader>
          <CardContent>
            <BranchMap
              branches={branches.filter((b) => b.id !== draft?.id)}
              draft={draft ? { lat: draft.lat, lng: draft.lng, radius: draft.radius } : null}
              onMapClick={draft ? mapClick : undefined}
              draftCorners={isOutline ? draft!.corners : null}
              onCornerMove={(i, lat, lng) =>
                setDraft((d) => (d ? { ...d, shape: d.shape === 'rectangle' ? 'outline' : d.shape, corners: d.corners.map((c, j) => (j === i ? { lat, lng } : c)) } : d))
              }
              onRecentre={isOutline ? (lat, lng) => setDraft((d) => (d ? { ...d, lat, lng } : d)) : undefined}
            />
            <p className="mt-2 text-xs text-muted-foreground">
              Red = strict zone · Green = soft zone {draft && '· Dashed indigo = the fence you are editing'}
              {isOutline && ' · Tip: switch to Satellite to see the roof you are tracing'}
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

            <div className="flex flex-wrap items-center gap-3">
              <button
                type="button"
                onClick={useMyLocation}
                disabled={locating}
                className="flex h-10 items-center gap-2 rounded-xl border border-brand-600/40 bg-brand-50 px-4 text-sm font-semibold text-brand-600 hover:bg-brand-50/70 disabled:opacity-60"
              >
                {locating ? <Loader2 className="h-4 w-4 animate-spin" /> : <LocateFixed className="h-4 w-4" />}
                {locating ? 'Getting GPS fix…' : 'Use my current location'}
              </button>
              {gpsInfo && <span className="text-xs font-medium text-emerald-600">{gpsInfo}</span>}
              <span className="text-xs text-muted-foreground">Stand at the branch for the most accurate fence centre — then fine-tune by dragging the pin.</span>
            </div>

            <div>
              <div className="mb-1.5 text-sm font-medium">Fence shape</div>
              <div className="flex flex-wrap gap-2">
                {SHAPES.map(({ key, label, icon: Icon }) => (
                  <button
                    key={key}
                    type="button"
                    onClick={() => setShape(key)}
                    className={`flex h-10 items-center gap-2 rounded-xl border px-4 text-sm font-semibold transition ${
                      draft.shape === key ? 'border-brand-600 bg-brand-600 text-white' : 'border-border bg-card text-muted-foreground hover:text-foreground'
                    }`}
                  >
                    <Icon className="h-4 w-4" /> {label}
                  </button>
                ))}
              </div>
              <p className="mt-1.5 text-xs text-muted-foreground">{SHAPES.find((x) => x.key === draft.shape)!.hint}</p>
            </div>

            {isOutline && (
              <div className="flex flex-wrap items-center gap-2 rounded-xl border border-border/70 bg-muted/30 p-3">
                <span className={`text-sm font-medium ${draft.corners.length >= 3 ? 'text-emerald-700' : 'text-amber-700'}`}>
                  {draft.corners.length === 0
                    ? 'No corners yet — click the map'
                    : draft.corners.length < 3
                      ? `${draft.corners.length} corner${draft.corners.length > 1 ? 's' : ''} — ${draft.shape === 'rectangle' ? 'now click the opposite corner' : `${3 - draft.corners.length} more needed`}`
                      : `${draft.corners.length} corners — inside this outline counts as at the branch`}
                </span>
                <div className="ml-auto flex gap-2">
                  {draft.shape === 'outline' && (
                    <button
                      type="button"
                      disabled={draft.corners.length === 0}
                      onClick={() => setDraft({ ...draft, corners: draft.corners.slice(0, -1) })}
                      className="flex h-8 items-center gap-1.5 rounded-lg border border-border bg-card px-3 text-xs font-semibold disabled:opacity-50"
                    >
                      <Undo2 className="h-3.5 w-3.5" /> Undo corner
                    </button>
                  )}
                  <button
                    type="button"
                    disabled={draft.corners.length === 0}
                    onClick={() => setDraft({ ...draft, corners: [], rectStart: null })}
                    className="flex h-8 items-center gap-1.5 rounded-lg border border-border bg-card px-3 text-xs font-semibold disabled:opacity-50"
                  >
                    <Eraser className="h-3.5 w-3.5" /> Clear
                  </button>
                </div>
              </div>
            )}

            {!isOutline && <div>
              <div className="mb-1 flex items-center justify-between text-sm">
                <span className="font-medium">Geofence radius</span>
                <span className="text-muted-foreground">
                  {Math.round(draft.radius * 3.28084)} ft ({draft.radius.toFixed(1)} m)
                </span>
              </div>
              <div className="flex items-center gap-3">
                <input
                  type="range"
                  min={3}
                  max={3300}
                  step={1}
                  value={Math.round(draft.radius * 3.28084)}
                  onChange={(e) => setDraft({ ...draft, radius: Number((parseInt(e.target.value) / 3.28084).toFixed(2)) })}
                  className="w-full accent-brand-600"
                />
                <input
                  type="number"
                  min={3}
                  max={33000}
                  value={Math.round(draft.radius * 3.28084)}
                  onChange={(e) => {
                    const ft = Number(e.target.value);
                    if (Number.isFinite(ft) && ft >= 3) setDraft({ ...draft, radius: Number((ft / 3.28084).toFixed(2)) });
                  }}
                  className="h-9 w-24 rounded-lg border border-border bg-background px-2 text-sm outline-none focus:ring-2 focus:ring-ring/40"
                />
                <span className="text-xs text-muted-foreground">ft</span>
              </div>
              <div className="flex justify-between text-[11px] text-muted-foreground"><span>3 ft</span><span>3,300 ft (~1 km)</span></div>
              <p className="mt-1 text-[11px] text-amber-600">
                Note: phone GPS is typically accurate to ±15–50 ft. A fence under ~50 ft may reject genuine
                check-ins standing at the door — 150–300 ft is a safe strict-mode radius.
              </p>
            </div>}

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
                      {b.address} · {b.geofenceLat.toFixed(4)}, {b.geofenceLng.toFixed(4)} ·{' '}
                      {parseOutline(b.geofencePolygon)
                        ? `building outline, ${parseOutline(b.geofencePolygon)!.length} corners`
                        : `radius ${Math.round(b.geofenceRadius * 3.28084)} ft`}
                    </div>
                  </div>
                  <span className={`chip ${b.strictMode ? 'chip-off' : 'chip-present'}`}>{b.strictMode ? 'Strict' : 'Soft'}</span>
                  {canEdit && <div className="flex gap-2">
                    <button onClick={() => startEdit(b)} title="Edit branch & geofence" className="flex h-9 w-9 items-center justify-center rounded-lg border border-border bg-card text-muted-foreground hover:text-foreground">
                      <Pencil className="h-4 w-4" />
                    </button>
                    <button onClick={() => remove(b)} title="Delete branch" className="flex h-9 w-9 items-center justify-center rounded-lg bg-rose-50 text-rose-600 hover:bg-rose-100">
                      <Trash2 className="h-4 w-4" />
                    </button>
                  </div>}
                </div>
              ))}
            </CardContent>
          </Card>

          <Card>
            <CardHeader><CardTitle className="text-base">Violations ({violations.length})</CardTitle></CardHeader>
            <CardContent>
              {violations.length === 0 && <div className="text-sm text-muted-foreground">No violations logged. 🎉</div>}
              {violations.length > 0 && (
                <div className="max-h-[26rem] space-y-3 overflow-y-auto pr-1">
                  {violations.map((v) => (
                    <div key={v.id} className="rounded-xl border border-border/60 bg-rose-50/50 p-3 text-sm">
                      <div className="font-semibold">{v.employeeName ?? 'Employee'} <span className="text-xs font-normal text-muted-foreground">{v.employeeCode}{v.branchName ? ` · ${v.branchName}` : ''}</span></div>
                      <div className="font-medium text-rose-600">{Math.round(v.distance)}m outside zone</div>
                      <div className="text-xs text-muted-foreground">{new Date(v.timestamp).toLocaleString()}</div>
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        </div>
      )}
    </div>
  );
}
