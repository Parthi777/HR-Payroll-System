'use client';

import { useEffect, useState } from 'react';
import { MapContainer, TileLayer, Circle, CircleMarker, Marker, Popup, useMapEvents, useMap } from 'react-leaflet';
import L from 'leaflet';
import { LocateFixed, Loader2 } from 'lucide-react';
import 'leaflet/dist/leaflet.css';

export interface MapBranch {
  id: string;
  name: string;
  geofenceLat: number;
  geofenceLng: number;
  geofenceRadius: number;
  strictMode: boolean;
}

// Leaflet's default marker icons break under bundlers — point them at the CDN.
const markerIcon = L.icon({
  iconUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon.png',
  iconRetinaUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon-2x.png',
  shadowUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-shadow.png',
  iconSize: [25, 41],
  iconAnchor: [12, 41],
  popupAnchor: [1, -34],
  shadowSize: [41, 41],
});

function ClickCapture({ onMapClick }: { onMapClick: (lat: number, lng: number) => void }) {
  useMapEvents({
    click(e) {
      onMapClick(e.latlng.lat, e.latlng.lng);
    },
  });
  return null;
}

/** Fly to the draft point when it jumps far (current-location / branch switch),
 *  but stay put for small click/drag adjustments so editing isn't jumpy. */
function Recenter({ lat, lng }: { lat: number; lng: number }) {
  const map = useMap();
  useEffect(() => {
    const c = map.getCenter();
    if (Math.abs(c.lat - lat) > 0.005 || Math.abs(c.lng - lng) > 0.005) {
      map.flyTo([lat, lng], Math.max(map.getZoom(), 17));
    }
  }, [map, lat, lng]);
  return null;
}

/** Fly to the located position at street-level zoom whenever a GPS fix arrives. */
function FlyToMe({ me }: { me: { lat: number; lng: number; ts: number } | null }) {
  const map = useMap();
  useEffect(() => {
    if (me) map.flyTo([me.lat, me.lng], Math.max(map.getZoom(), 18));
  }, [map, me]);
  return null;
}

/** Free geocoding — Nominatim for exact names, then Photon as a typo-tolerant
 *  fallback (e.g. "kavindapadi" → Kavandapady), biased to India. */
async function geocode(query: string): Promise<{ lat: number; lng: number } | null> {
  try {
    const res = await fetch(
      `https://nominatim.openstreetmap.org/search?format=json&limit=1&countrycodes=in&q=${encodeURIComponent(query)}`,
      { headers: { Accept: 'application/json' } },
    );
    const results = (await res.json()) as { lat: string; lon: string }[];
    if (results[0]) return { lat: Number(results[0].lat), lng: Number(results[0].lon) };
  } catch { /* fall through to Photon */ }
  const res = await fetch(
    `https://photon.komoot.io/api/?limit=1&lang=en&bbox=68.1,6.5,97.4,35.7&q=${encodeURIComponent(query)}`,
  );
  const geo = (await res.json()) as { features?: { geometry?: { coordinates?: [number, number] } }[] };
  const c = geo.features?.[0]?.geometry?.coordinates;
  return c ? { lat: c[1], lng: c[0] } : null;
}

export default function BranchMap({
  branches,
  height = 360,
  onMapClick,
  draft,
}: {
  branches: MapBranch[];
  height?: number;
  /** When set, map clicks report coordinates (used by the geofence editor). */
  onMapClick?: (lat: number, lng: number) => void;
  /** Live preview of the geofence being edited (dashed indigo circle). */
  draft?: { lat: number; lng: number; radius: number } | null;
}) {
  const valid = branches.filter((b) => b.geofenceLat && b.geofenceLng);
  const [satellite, setSatellite] = useState(false);
  const [query, setQuery] = useState('');
  const [searching, setSearching] = useState(false);
  const [me, setMe] = useState<{ lat: number; lng: number; accuracy: number; ts: number } | null>(null);
  const [locating, setLocating] = useState(false);

  /** Google-Maps-style locate: fly to the GPS fix, show the blue dot, and (in
   *  edit mode) drag the geofence pin exactly there. */
  function locate() {
    if (!navigator.geolocation) { alert('This browser does not support location'); return; }
    setLocating(true);
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        const p = { lat: pos.coords.latitude, lng: pos.coords.longitude, accuracy: pos.coords.accuracy, ts: Date.now() };
        setMe(p);
        onMapClick?.(p.lat, p.lng);
        setLocating(false);
      },
      (e) => {
        alert(e.code === e.PERMISSION_DENIED
          ? 'Location permission denied — allow it in the browser and try again.'
          : `Could not get location: ${e.message}`);
        setLocating(false);
      },
      { enableHighAccuracy: true, timeout: 15000, maximumAge: 0 },
    );
  }
  const center: [number, number] = draft
    ? [draft.lat, draft.lng]
    : valid.length
      ? [
          valid.reduce((s, b) => s + b.geofenceLat, 0) / valid.length,
          valid.reduce((s, b) => s + b.geofenceLng, 0) / valid.length,
        ]
      : [11.4452, 77.6822]; // fallback: Bhavani

  async function search() {
    if (!query.trim() || !onMapClick) return;
    setSearching(true);
    try {
      const hit = await geocode(query);
      if (hit) onMapClick(hit.lat, hit.lng);
      else alert('Place not found — try adding the town/city name');
    } catch {
      alert('Search failed — check your internet connection');
    } finally {
      setSearching(false);
    }
  }

  return (
    // `isolate` confines Leaflet's internal z-indexes (panes/controls go up to 1000)
    // so the map can never overlap the app header, drawer, or backdrop.
    <div className="relative z-0 isolate">
    {onMapClick && (
      <div className="absolute left-12 right-14 top-2 z-[1001] flex gap-2 sm:right-auto sm:w-80">
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); search(); } }}
          placeholder="Search place / address…"
          className="h-9 min-w-0 flex-1 rounded-lg border border-border bg-card px-3 text-sm shadow outline-none focus:ring-2 focus:ring-ring/40"
        />
        <button
          type="button"
          onClick={search}
          disabled={searching}
          className="h-9 shrink-0 rounded-lg bg-brand-600 px-3 text-xs font-semibold text-white shadow disabled:opacity-60"
        >
          {searching ? '…' : 'Go'}
        </button>
      </div>
    )}
    <button
      type="button"
      onClick={() => setSatellite((s) => !s)}
      title="Toggle satellite view"
      className="absolute right-2 top-2 z-[1001] h-9 rounded-lg border border-border bg-card px-3 text-xs font-semibold shadow"
    >
      {satellite ? 'Map' : 'Satellite'}
    </button>
    <button
      type="button"
      onClick={locate}
      disabled={locating}
      title="Go to my current location"
      className="absolute bottom-4 right-2 z-[1001] flex h-11 w-11 items-center justify-center rounded-full border border-border bg-card shadow-lg hover:bg-muted disabled:opacity-60"
    >
      {locating ? <Loader2 className="h-5 w-5 animate-spin text-brand-600" /> : <LocateFixed className="h-5 w-5 text-brand-600" />}
    </button>
    <MapContainer
      center={center}
      zoom={valid.length > 1 && !draft ? 9 : 14}
      maxZoom={19}
      scrollWheelZoom={!!onMapClick}
      style={{ height, width: '100%', borderRadius: 16, cursor: onMapClick ? 'crosshair' : undefined }}
    >
      {satellite ? (
        <TileLayer
          attribution="Tiles &copy; Esri — Source: Esri, Maxar, Earthstar Geographics"
          url="https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}"
          maxZoom={19}
        />
      ) : (
        <TileLayer
          attribution='&copy; OpenStreetMap contributors'
          url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
          maxZoom={19}
        />
      )}
      {onMapClick && <ClickCapture onMapClick={onMapClick} />}
      <FlyToMe me={me} />
      {me && (
        <>
          <Circle
            center={[me.lat, me.lng]}
            radius={me.accuracy}
            pathOptions={{ color: '#4285F4', fillColor: '#4285F4', fillOpacity: 0.08, weight: 1 }}
          />
          <CircleMarker
            center={[me.lat, me.lng]}
            radius={7}
            pathOptions={{ color: '#ffffff', weight: 2.5, fillColor: '#4285F4', fillOpacity: 1 }}
          />
        </>
      )}
      {valid.map((b) => {
        const color = b.strictMode ? '#e11d48' : '#16a34a';
        return (
          <div key={b.id}>
            <Marker position={[b.geofenceLat, b.geofenceLng]} icon={markerIcon}>
              <Popup>
                <strong>{b.name}</strong>
                <br />
                {b.strictMode ? 'Strict' : 'Soft'} · {b.geofenceRadius}m radius
              </Popup>
            </Marker>
            <Circle
              center={[b.geofenceLat, b.geofenceLng]}
              radius={b.geofenceRadius}
              pathOptions={{ color, fillColor: color, fillOpacity: 0.12 }}
            />
          </div>
        );
      })}
      {draft && (
        <>
          <Recenter lat={draft.lat} lng={draft.lng} />
          <Marker
            position={[draft.lat, draft.lng]}
            icon={markerIcon}
            draggable={!!onMapClick}
            eventHandlers={
              onMapClick
                ? {
                    dragend: (e) => {
                      const p = (e.target as L.Marker).getLatLng();
                      onMapClick(p.lat, p.lng);
                    },
                  }
                : undefined
            }
          />
          <Circle
            center={[draft.lat, draft.lng]}
            radius={draft.radius}
            pathOptions={{ color: '#6C5CE7', fillColor: '#6C5CE7', fillOpacity: 0.15, dashArray: '6 6' }}
          />
        </>
      )}
    </MapContainer>
    </div>
  );
}
