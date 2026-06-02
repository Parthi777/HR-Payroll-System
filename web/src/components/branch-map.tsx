'use client';

import { MapContainer, TileLayer, Circle, Marker, Popup } from 'react-leaflet';
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

export default function BranchMap({ branches, height = 360 }: { branches: MapBranch[]; height?: number }) {
  const valid = branches.filter((b) => b.geofenceLat && b.geofenceLng);
  const center: [number, number] = valid.length
    ? [
        valid.reduce((s, b) => s + b.geofenceLat, 0) / valid.length,
        valid.reduce((s, b) => s + b.geofenceLng, 0) / valid.length,
      ]
    : [11.4452, 77.6822]; // fallback: Bhavani

  return (
    <MapContainer
      center={center}
      zoom={valid.length > 1 ? 9 : 14}
      scrollWheelZoom={false}
      style={{ height, width: '100%', borderRadius: 16 }}
    >
      <TileLayer
        attribution='&copy; OpenStreetMap contributors'
        url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
      />
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
    </MapContainer>
  );
}
