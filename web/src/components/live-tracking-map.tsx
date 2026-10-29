'use client';

import { useEffect, useMemo, useState } from 'react';
import { Circle, CircleMarker, MapContainer, Marker, Polyline, TileLayer, Tooltip, ZoomControl, useMap } from 'react-leaflet';
import L from 'leaflet';
import { Crosshair, Layers } from 'lucide-react';
import 'leaflet/dist/leaflet.css';
import type { TrackBranch, TrackedEmployee, TrackState } from '@/hooks/useApi';

/**
 * Colour per state. Inside uses the deeper brand green (#00835E) rather than
 * #00A174, because the initials on the marker are white.
 */
export const STATE_COLOR: Record<TrackState, string> = {
  INSIDE: '#00835E',
  OUTSIDE: '#E11D48',
  OFF: '#B45309',
  NO_SIGNAL: '#64748B',
};

export const STATE_LABEL: Record<TrackState, string> = {
  INSIDE: 'Inside',
  OUTSIDE: 'Away',
  OFF: 'GPS off',
  NO_SIGNAL: 'No signal',
};

export interface TrackPoint {
  ts: string;
  lat: number;
  lng: number;
  accuracy: number | null;
  status: string | null;
  distance: number | null;
  mock: boolean;
}

export const initials = (name: string) =>
  name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0]!.toUpperCase())
    .join('') || '?';

const time = (iso: string) => new Date(iso).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' });

function personIcon(e: TrackedEmployee, selected: boolean) {
  const size = selected ? 40 : 34;
  const cls = ['lt-pin', e.state === 'OUTSIDE' ? 'lt-pulse' : '', selected ? 'lt-selected' : ''].join(' ');
  return L.divIcon({
    className: 'lt-person',
    iconSize: [size, size],
    iconAnchor: [size / 2, size / 2],
    html: `<div class="${cls}" style="--c:${STATE_COLOR[e.state]};width:${size}px;height:${size}px">${initials(e.name)}</div>`,
  });
}

function branchIcon(name: string) {
  const safe = name.replace(/[<>&"]/g, '');
  return L.divIcon({ className: 'lt-person', iconSize: [0, 0], html: `<span class="lt-branch">🏢 ${safe}</span>` });
}

/**
 * Frames everything once per `fitKey` — first load, a branch change — and
 * never on a poll, so the map does not jump while someone is looking at it.
 */
function FitTo({ points, fitKey }: { points: [number, number][]; fitKey: string }) {
  const map = useMap();
  useEffect(() => {
    if (points.length === 0) return;
    if (points.length === 1) map.setView(points[0], 16);
    else map.fitBounds(L.latLngBounds(points), { padding: [48, 48], maxZoom: 17 });
  }, [map, fitKey]);
  return null;
}

/** Brings the selected person's day into view. */
function FocusPath({ path, focusKey }: { path: [number, number][]; focusKey: string | null }) {
  const map = useMap();
  useEffect(() => {
    if (!focusKey || path.length === 0) return;
    if (path.length === 1) map.flyTo(path[0], Math.max(map.getZoom(), 16), { duration: 0.6 });
    else map.flyToBounds(L.latLngBounds(path), { padding: [60, 60], maxZoom: 17, duration: 0.6 });
  }, [map, focusKey, path.length > 0]);
  return null;
}

/** "Track": fly to where one person is now. `key` changes on every press, so a second press re-centres. */
function FlyToPoint({ focus }: { focus: { lat: number; lng: number; key: number } | null }) {
  const map = useMap();
  useEffect(() => {
    if (focus) map.flyTo([focus.lat, focus.lng], Math.max(map.getZoom(), 16), { duration: 0.8 });
  }, [map, focus]);
  return null;
}

/** "Fit everyone" — a button that lives on the map, so it needs the map instance. */
function Recenter({ points }: { points: [number, number][] }) {
  const map = useMap();
  return (
    <button
      type="button"
      title="Show everyone"
      onClick={() => points.length && map.fitBounds(L.latLngBounds(points), { padding: [48, 48], maxZoom: 17 })}
      className="absolute right-3 top-3 z-[1000] flex h-9 w-9 items-center justify-center rounded-xl border border-border bg-card text-foreground shadow-md hover:bg-muted"
    >
      <Crosshair className="h-4 w-4" />
    </button>
  );
}

export default function LiveTrackingMap({
  branches,
  employees,
  selected,
  path,
  onSelect,
  fitKey,
  focus,
}: {
  branches: TrackBranch[];
  employees: TrackedEmployee[];
  selected: string | null;
  path: TrackPoint[];
  onSelect: (attendanceId: string) => void;
  /** Changes when the view should be re-framed (e.g. the branch filter). */
  fitKey: string;
  /** Set by the Track button: fly here, over the path framing. */
  focus?: { lat: number; lng: number; key: number } | null;
}) {
  const [satellite, setSatellite] = useState(false);
  const placed = branches.filter((b) => b.geofenceLat || b.geofenceLng);
  const people = employees.filter((e) => e.last);

  const everyone = useMemo<[number, number][]>(
    () => [
      ...people.map((e) => [e.last!.lat, e.last!.lng] as [number, number]),
      ...placed.map((b) => [b.geofenceLat, b.geofenceLng] as [number, number]),
    ],
    [JSON.stringify(people.map((e) => e.attendanceId)), placed.length],
  );

  // Consecutive fixes in one state make one stroke: the day reads as green
  // stretches and red stretches instead of hundreds of tiny segments.
  const strokes: { away: boolean; points: [number, number][] }[] = [];
  for (const p of path) {
    const away = p.status === 'OUTSIDE';
    const last = strokes[strokes.length - 1];
    const pt: [number, number] = [p.lat, p.lng];
    if (last && last.away === away) last.points.push(pt);
    else strokes.push({ away, points: last ? [last.points[last.points.length - 1], pt] : [pt] });
  }
  const pathPoints = path.map((p) => [p.lat, p.lng] as [number, number]);
  const sel = people.find((e) => e.attendanceId === selected);
  const centre: [number, number] = everyone[0] ?? [11.4452, 77.6822];

  return (
    // `isolate` keeps Leaflet's z-indexes (up to 1000) under the app header.
    <div className="relative isolate z-0 h-full w-full overflow-hidden rounded-2xl">
      <MapContainer center={centre} zoom={14} maxZoom={19} zoomControl={false} scrollWheelZoom className="h-full w-full">
        {satellite ? (
          <TileLayer
            attribution="Tiles &copy; Esri — Source: Esri, Maxar, Earthstar Geographics"
            url="https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}"
            maxZoom={19}
          />
        ) : (
          <TileLayer
            attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
            url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
            className="lt-tiles"
            maxZoom={19}
          />
        )}
        <ZoomControl position="bottomright" />
        <FitTo points={everyone} fitKey={fitKey} />
        <FocusPath path={pathPoints} focusKey={focus ? null : selected} />
        <FlyToPoint focus={focus ?? null} />
        <Recenter points={everyone} />

        {placed.map((b) => (
          <div key={b.id}>
            <Circle
              center={[b.geofenceLat, b.geofenceLng]}
              radius={b.geofenceRadius}
              pathOptions={{ color: '#00835E', weight: 1.5, dashArray: '6 6', fillColor: '#00A174', fillOpacity: 0.08 }}
            />
            <Marker position={[b.geofenceLat, b.geofenceLng]} icon={branchIcon(b.name)} interactive={false} />
          </div>
        ))}

        {strokes.map((s, i) => (
          <Polyline
            key={i}
            positions={s.points}
            pathOptions={{ color: s.away ? '#E11D48' : '#00835E', weight: 5, opacity: 0.85, lineCap: 'round', lineJoin: 'round' }}
          />
        ))}
        {path.length > 0 && (
          <CircleMarker center={pathPoints[0]} radius={6} pathOptions={{ color: '#ffffff', weight: 2, fillColor: '#171C20', fillOpacity: 1 }}>
            <Tooltip direction="top" offset={[0, -6]}>First location · {time(path[0].ts)}</Tooltip>
          </CircleMarker>
        )}
        {sel?.last?.accuracy != null && (
          <Circle
            center={[sel.last.lat, sel.last.lng]}
            radius={sel.last.accuracy}
            pathOptions={{ color: STATE_COLOR[sel.state], weight: 1, fillOpacity: 0.08 }}
          />
        )}

        {people.map((e) => (
          <Marker
            key={e.attendanceId}
            position={[e.last!.lat, e.last!.lng]}
            icon={personIcon(e, e.attendanceId === selected)}
            zIndexOffset={e.attendanceId === selected ? 1000 : e.state === 'OUTSIDE' ? 500 : 0}
            eventHandlers={{ click: () => onSelect(e.attendanceId) }}
          >
            <Tooltip direction="top" offset={[0, -18]}>
              <strong>{e.name}</strong> · {STATE_LABEL[e.state]} · {time(e.last!.ts)}
            </Tooltip>
          </Marker>
        ))}
      </MapContainer>

      <button
        type="button"
        onClick={() => setSatellite((s) => !s)}
        className="absolute left-3 top-3 z-[1000] flex h-9 items-center gap-1.5 rounded-xl border border-border bg-card px-3 text-xs font-semibold shadow-md hover:bg-muted"
      >
        <Layers className="h-3.5 w-3.5" /> {satellite ? 'Map' : 'Satellite'}
      </button>

      <div className="absolute bottom-3 left-3 z-[1000] flex flex-wrap gap-x-3 gap-y-1 rounded-xl border border-border bg-card/95 px-3 py-2 text-[11px] font-medium shadow-md backdrop-blur">
        {(Object.keys(STATE_LABEL) as TrackState[]).map((s) => (
          <span key={s} className="flex items-center gap-1.5">
            <span className="h-2.5 w-2.5 rounded-full" style={{ background: STATE_COLOR[s] }} />
            {STATE_LABEL[s]}
          </span>
        ))}
      </div>
    </div>
  );
}
