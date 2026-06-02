/**
 * Geofence service — circle (radius) and polygon point-in-polygon checks.
 * See CLAUDE.md "Geofence AI Logic".
 */

export interface LatLng {
  lat: number;
  lng: number;
}

export interface GeofenceConfig {
  geofenceLat: number;
  geofenceLng: number;
  geofenceRadius: number;
  geofencePolygon?: unknown; // GeoJSON-ish ring of [lng, lat] or {lat,lng}
}

export interface GeofenceResult {
  inside: boolean;
  distance: number; // meters from center (circle) or 0 if polygon
  status: 'INSIDE' | 'OUTSIDE' | 'BORDERLINE';
  confidence: 'high' | 'low';
}

const EARTH_RADIUS_M = 6_371_000;

/** Haversine distance in meters between two coordinates. */
export function haversine(a: LatLng, b: LatLng): number {
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const lat1 = toRad(a.lat);
  const lat2 = toRad(b.lat);
  const h =
    Math.sin(dLat / 2) ** 2 + Math.sin(dLng / 2) ** 2 * Math.cos(lat1) * Math.cos(lat2);
  return 2 * EARTH_RADIUS_M * Math.asin(Math.sqrt(h));
}

/** Ray-casting point-in-polygon. Polygon is an array of {lat,lng}. */
export function pointInPolygon(point: LatLng, polygon: LatLng[]): boolean {
  let inside = false;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const xi = polygon[i].lng;
    const yi = polygon[i].lat;
    const xj = polygon[j].lng;
    const yj = polygon[j].lat;
    const intersect =
      yi > point.lat !== yj > point.lat &&
      point.lng < ((xj - xi) * (point.lat - yi)) / (yj - yi) + xi;
    if (intersect) inside = !inside;
  }
  return inside;
}

const BORDERLINE_METERS = 10;

export function checkGeofence(point: LatLng, branch: GeofenceConfig, gpsAccuracy?: number): GeofenceResult {
  const confidence: GeofenceResult['confidence'] = gpsAccuracy && gpsAccuracy > 50 ? 'low' : 'high';

  if (Array.isArray(branch.geofencePolygon) && branch.geofencePolygon.length >= 3) {
    const inside = pointInPolygon(point, branch.geofencePolygon as LatLng[]);
    return { inside, distance: 0, status: inside ? 'INSIDE' : 'OUTSIDE', confidence };
  }

  const distance = haversine(point, { lat: branch.geofenceLat, lng: branch.geofenceLng });
  const delta = distance - branch.geofenceRadius;
  let status: GeofenceResult['status'];
  if (delta <= -BORDERLINE_METERS) status = 'INSIDE';
  else if (delta <= BORDERLINE_METERS) status = 'BORDERLINE';
  else status = 'OUTSIDE';

  return { inside: distance <= branch.geofenceRadius, distance, status, confidence };
}
