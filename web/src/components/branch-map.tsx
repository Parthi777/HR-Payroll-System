'use client';

import { useEffect } from 'react';
import { MapContainer, TileLayer, Circle, Marker, Popup, useMapEvents, useMap } from 'react-leaflet';
import L from 'leaflet';
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
      map.flyTo([lat, lng], Math.max(map.getZoom(), 16));
    }
  }, [map, lat, lng]);
  return null;
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
  const center: [number, number] = draft
    ? [draft.lat, draft.lng]
    : valid.length
      ? [
          valid.reduce((s, b) => s + b.geofenceLat, 0) / valid.length,
          valid.reduce((s, b) => s + b.geofenceLng, 0) / valid.length,
        ]
      : [11.4452, 77.6822]; // fallback: Bhavani

  return (
    // `isolate` confines Leaflet's internal z-indexes (panes/controls go up to 1000)
    // so the map can never overlap the app header, drawer, or backdrop.
    <div className="relative z-0 isolate">
    <MapContainer
      center={center}
      zoom={valid.length > 1 && !draft ? 9 : 14}
      scrollWheelZoom={false}
      style={{ height, width: '100%', borderRadius: 16, cursor: onMapClick ? 'crosshair' : undefined }}
    >
      <TileLayer
        attribution='&copy; OpenStreetMap contributors'
        url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
      />
      {onMapClick && <ClickCapture onMapClick={onMapClick} />}
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
