import { describe, expect, it } from 'vitest';
import {
  checkGeofence,
  distanceToEdge,
  interiorPoint,
  parsePolygon,
  pointInPolygon,
  polygonWrite,
  type LatLng,
} from '../src/services/geofence/geofence.service.js';
import { classifyFix } from '../src/services/tracking/tracking.service.js';

// Geofences drawn round a building on the Geofence page, next to the circles
// every branch had before. Pure — no database.

const M_PER_DEG_LAT = 111_195;
const C = { lat: 11.58414, lng: 77.727966 };
const mPerDegLng = M_PER_DEG_LAT * Math.cos((C.lat * Math.PI) / 180);
/** A point `east` / `north` metres from C. */
const at = (east: number, north: number): LatLng => ({ lat: C.lat + north / M_PER_DEG_LAT, lng: C.lng + east / mPerDegLng });

// A 40 m × 20 m showroom centred on C.
const showroom = [at(-20, -10), at(20, -10), at(20, 10), at(-20, 10)];
const branch = (polygon: unknown) => ({ geofenceLat: C.lat, geofenceLng: C.lng, geofenceRadius: 5, geofencePolygon: polygon });

describe('building outlines', () => {
  it('reads the stored JSON text — the old check never parsed it, so outlines never applied', () => {
    expect(parsePolygon(JSON.stringify(showroom))).toHaveLength(4);
    expect(parsePolygon(JSON.stringify(showroom.map((p) => [p.lng, p.lat])))?.[0]).toEqual(showroom[0]);
    expect(parsePolygon('not json')).toBeNull();
    expect(parsePolygon(JSON.stringify(showroom.slice(0, 2)))).toBeNull();
    expect(parsePolygon(null)).toBeNull();
  });

  it('anywhere inside the building is inside — even by a wall, where the 5 m circle would say outside', () => {
    const g = checkGeofence(at(18, 8), branch(JSON.stringify(showroom)));
    expect(g).toMatchObject({ inside: true, status: 'INSIDE', beyond: 0, shape: 'polygon' });
    expect(checkGeofence(at(18, 8), branch(null)).status).toBe('OUTSIDE');
  });

  it('just outside the walls is borderline; further out is outside, measured from the wall', () => {
    expect(checkGeofence(at(26, 0), branch(JSON.stringify(showroom))).status).toBe('BORDERLINE');
    const out = checkGeofence(at(80, 0), branch(JSON.stringify(showroom)));
    expect(out.status).toBe('OUTSIDE');
    expect(out.beyond).toBeCloseTo(60, 0);
  });

  it('measures to the nearest wall or corner', () => {
    expect(distanceToEdge(at(0, 30), showroom)).toBeCloseTo(20, 0);
    expect(distanceToEdge(at(23, 14), showroom)).toBeCloseTo(5, 0); // 3-4-5 off the corner
  });

  it('puts the branch pin inside even an L-shaped building', () => {
    const ell = [at(0, 0), at(40, 0), at(40, 10), at(10, 10), at(10, 40), at(0, 40)];
    const pin = interiorPoint(ell);
    expect(pointInPolygon(pin, ell)).toBe(true);
  });

  it('a blurry fix whose circle reaches the wall counts as borderline in tracking', () => {
    const p = at(45, 0); // 25 m outside the east wall
    expect(classifyFix({ ...p, accuracy: 5 }, branch(JSON.stringify(showroom))).status).toBe('OUTSIDE');
    expect(classifyFix({ ...p, accuracy: 30 }, branch(JSON.stringify(showroom))).status).toBe('BORDERLINE');
  });

  it('circles behave exactly as before', () => {
    const g = checkGeofence(at(150, 0), { ...branch(null), geofenceRadius: 100 });
    expect(g).toMatchObject({ status: 'OUTSIDE', shape: 'circle' });
    expect(g.distance).toBeCloseTo(150, 0);
    expect(g.beyond).toBeCloseTo(50, 0);
  });
});

describe('saving an outline', () => {
  it('stores the corners and moves the pin inside', () => {
    const w = polygonWrite(showroom);
    if (typeof w === 'string') throw new Error(w);
    expect(parsePolygon(w.geofencePolygon)).toHaveLength(4);
    expect(pointInPolygon({ lat: w.geofenceLat!, lng: w.geofenceLng! }, showroom)).toBe(true);
  });

  it('null goes back to the circle', () => {
    expect(polygonWrite(null)).toEqual({ geofencePolygon: null });
  });

  it('refuses something that is not one building', () => {
    expect(polygonWrite([at(0, 0), at(5000, 0), at(0, 10)])).toMatch(/2 km/);
    expect(polygonWrite([at(0, 0), at(5, 0)])).toMatch(/3 corners/);
  });
});
