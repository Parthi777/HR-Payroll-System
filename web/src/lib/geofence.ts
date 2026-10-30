/** A corner of a building outline drawn on the Geofence page. */
export interface Corner { lat: number; lng: number }

/** The stored outline (JSON text) as corners, or null for a circle. Mirrors the server's parsePolygon. */
export function parseOutline(raw: string | null | undefined): Corner[] | null {
  if (!raw) return null;
  try {
    const v = JSON.parse(raw) as unknown;
    if (!Array.isArray(v)) return null;
    const pts = v
      .map((p) => (Array.isArray(p) ? { lat: Number(p[1]), lng: Number(p[0]) } : { lat: Number(p?.lat), lng: Number(p?.lng) }))
      .filter((p) => Number.isFinite(p.lat) && Number.isFinite(p.lng));
    return pts.length >= 3 ? pts : null;
  } catch {
    return null;
  }
}

/** The four corners of the lat/lng-aligned rectangle with `a` and `b` as opposite corners. */
export const rectangle = (a: Corner, b: Corner): Corner[] => [
  { lat: a.lat, lng: a.lng },
  { lat: a.lat, lng: b.lng },
  { lat: b.lat, lng: b.lng },
  { lat: b.lat, lng: a.lng },
];

interface Fence {
  geofenceLat: number;
  geofenceLng: number;
  geofenceRadius: number;
  geofencePolygon?: string | null;
}

/** Ray-casting point-in-polygon, as the server does it. */
function pointInOutline(p: Corner, outline: Corner[]): boolean {
  let inside = false;
  for (let i = 0, j = outline.length - 1; i < outline.length; j = i++) {
    const a = outline[i];
    const b = outline[j];
    if (a.lat > p.lat !== b.lat > p.lat && p.lng < ((b.lng - a.lng) * (p.lat - a.lat)) / (b.lat - a.lat) + a.lng) inside = !inside;
  }
  return inside;
}

/** Metres between two points (haversine). */
function metres(a: Corner, b: Corner): number {
  const r = (d: number) => (d * Math.PI) / 180;
  const h = Math.sin(r(b.lat - a.lat) / 2) ** 2 + Math.cos(r(a.lat)) * Math.cos(r(b.lat)) * Math.sin(r(b.lng - a.lng) / 2) ** 2;
  return 2 * 6_371_000 * Math.asin(Math.sqrt(h));
}

/**
 * Whether a point is inside a branch's fence — its drawn outline, or else its
 * circle. Mirrors checkGeofence on the server, for counting who is at a branch.
 */
export function insideFence(p: Corner, fence: Fence): boolean {
  const outline = parseOutline(fence.geofencePolygon);
  if (outline) return pointInOutline(p, outline);
  return metres(p, { lat: fence.geofenceLat, lng: fence.geofenceLng }) <= fence.geofenceRadius;
}
