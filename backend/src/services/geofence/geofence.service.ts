/**
 * Geofence service — circle (radius) and polygon checks.
 * See CLAUDE.md "Geofence AI Logic".
 *
 * A branch is a circle unless it has a polygon (`Branch.geofencePolygon`, a
 * JSON list of corners drawn round the building on the Geofence page). Then
 * the polygon is the fence, and the circle fields only place the branch's pin.
 */

export interface LatLng {
  lat: number;
  lng: number;
}

export interface GeofenceConfig {
  geofenceLat: number;
  geofenceLng: number;
  geofenceRadius: number;
  /** JSON text as stored, or already parsed: [{lat,lng}…] or GeoJSON-ish [[lng,lat]…]. */
  geofencePolygon?: unknown;
}

export interface GeofenceResult {
  inside: boolean;
  /** Metres from the fence centre: the circle's centre, or the polygon's middle. */
  distance: number;
  /** Metres outside the fence edge; 0 when inside. What "how far away" means. */
  beyond: number;
  status: 'INSIDE' | 'OUTSIDE' | 'BORDERLINE';
  confidence: 'high' | 'low';
  shape: 'circle' | 'polygon';
}

const EARTH_RADIUS_M = 6_371_000;
const toRad = (d: number) => (d * Math.PI) / 180;

/** Haversine distance in meters between two coordinates. */
export function haversine(a: LatLng, b: LatLng): number {
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

/**
 * The stored polygon as corners, or null when the branch is a circle.
 *
 * The column is JSON text, and the old check tested `Array.isArray` on that
 * string — so a polygon could never take effect. This is where it is read.
 */
export function parsePolygon(raw: unknown): LatLng[] | null {
  let value = raw;
  if (typeof value === 'string') {
    try {
      value = JSON.parse(value);
    } catch {
      return null;
    }
  }
  if (!Array.isArray(value)) return null;
  const corners = value
    .map((p): LatLng => (Array.isArray(p) ? { lat: Number(p[1]), lng: Number(p[0]) } : { lat: Number(p?.lat), lng: Number(p?.lng) }))
    .filter((p) => Number.isFinite(p.lat) && Number.isFinite(p.lng));
  return corners.length >= 3 ? corners : null;
}

/** The average of the corners — the polygon's "centre" for distances and labels. */
export function polygonCentre(polygon: LatLng[]): LatLng {
  return {
    lat: polygon.reduce((n, p) => n + p.lat, 0) / polygon.length,
    lng: polygon.reduce((n, p) => n + p.lng, 0) / polygon.length,
  };
}

/**
 * A point certainly inside the polygon — where the branch pin goes and where
 * a kiosk punches. The centre, unless the shape is concave enough to leave it
 * outside (an L-shaped building); then the middle of the first corner
 * triangle that lies inside.
 */
export function interiorPoint(polygon: LatLng[]): LatLng {
  const c = polygonCentre(polygon);
  if (pointInPolygon(c, polygon)) return c;
  for (let i = 1; i < polygon.length - 1; i++) {
    const t = polygonCentre([polygon[0], polygon[i], polygon[i + 1]]);
    if (pointInPolygon(t, polygon)) return t;
  }
  return c;
}

/** Shortest distance in metres from a point to the polygon's outline. */
export function distanceToEdge(point: LatLng, polygon: LatLng[]): number {
  // Flat metres around the point — exact enough at building scale.
  const kx = EARTH_RADIUS_M * toRad(1) * Math.cos(toRad(point.lat));
  const ky = EARTH_RADIUS_M * toRad(1);
  const xy = (p: LatLng) => [(p.lng - point.lng) * kx, (p.lat - point.lat) * ky] as const;
  let best = Infinity;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const [ax, ay] = xy(polygon[j]);
    const [bx, by] = xy(polygon[i]);
    const dx = bx - ax;
    const dy = by - ay;
    const len = dx * dx + dy * dy;
    const t = len === 0 ? 0 : Math.max(0, Math.min(1, -(ax * dx + ay * dy) / len));
    best = Math.min(best, Math.hypot(ax + t * dx, ay + t * dy));
  }
  return best;
}

const BORDERLINE_METERS = 10;

export function checkGeofence(point: LatLng, branch: GeofenceConfig, gpsAccuracy?: number): GeofenceResult {
  const confidence: GeofenceResult['confidence'] = gpsAccuracy && gpsAccuracy > 50 ? 'low' : 'high';

  const polygon = parsePolygon(branch.geofencePolygon);
  if (polygon) {
    // Inside the drawn outline is inside, however close to a wall — the
    // building is the point of drawing one. Just outside it is borderline.
    const inside = pointInPolygon(point, polygon);
    const beyond = inside ? 0 : distanceToEdge(point, polygon);
    const status: GeofenceResult['status'] = inside ? 'INSIDE' : beyond <= BORDERLINE_METERS ? 'BORDERLINE' : 'OUTSIDE';
    return { inside, distance: haversine(point, polygonCentre(polygon)), beyond, status, confidence, shape: 'polygon' };
  }

  const distance = haversine(point, { lat: branch.geofenceLat, lng: branch.geofenceLng });
  const delta = distance - branch.geofenceRadius;
  let status: GeofenceResult['status'];
  if (delta <= -BORDERLINE_METERS) status = 'INSIDE';
  else if (delta <= BORDERLINE_METERS) status = 'BORDERLINE';
  else status = 'OUTSIDE';

  return {
    inside: distance <= branch.geofenceRadius,
    distance,
    beyond: Math.max(0, delta),
    status,
    confidence,
    shape: 'circle',
  };
}

/** "You are 40m away from X" — from the edge for a building, from the centre for a circle, as before. */
export const awayMetres = (geo: GeofenceResult) => Math.round(geo.shape === 'polygon' ? geo.beyond : geo.distance);

/** How a drawn outline is stored, and where it puts the branch pin. */
export interface PolygonWrite {
  geofencePolygon: string | null;
  geofenceLat?: number;
  geofenceLng?: number;
}

/** Corners more than this far from their middle are not one building. */
const MAX_POLYGON_SPAN_M = 2000;

/**
 * Validate corners from the Geofence page and turn them into the columns to
 * save. `null` clears the outline, and the branch is a circle again. The pin
 * moves inside the outline, because the kiosk punches at the pin.
 * Returns an error message instead of throwing, so each route words its own 400.
 */
export function polygonWrite(corners: LatLng[] | null): PolygonWrite | string {
  if (corners === null) return { geofencePolygon: null };
  if (corners.length < 3) return 'An outline needs at least 3 corners';
  const centre = polygonCentre(corners);
  if (corners.some((p) => haversine(p, centre) > MAX_POLYGON_SPAN_M)) {
    return 'That outline is more than 2 km across — draw round the building itself';
  }
  const pin = interiorPoint(corners);
  return {
    geofencePolygon: JSON.stringify(corners.map((p) => ({ lat: +p.lat.toFixed(7), lng: +p.lng.toFixed(7) }))),
    geofenceLat: pin.lat,
    geofenceLng: pin.lng,
  };
}
