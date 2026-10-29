/**
 * "Where is that?" — a street address for a live-tracking fix, for the Live
 * Tracking page.
 *
 * OpenStreetMap's Nominatim: free and keyless, but its usage policy allows at
 * most one request a second, needs an identifying User-Agent, and asks that
 * results be cached. So every lookup goes through here: one at a time, at
 * least 1.1 s apart, cached per ~100 m square. The browser never calls it,
 * and the employee's name never leaves — only the coordinates.
 */
import { logger } from '../../utils/logger.js';

const ENDPOINT = process.env.REVERSE_GEOCODE_URL ?? 'https://nominatim.openstreetmap.org/reverse';
const USER_AGENT = 'KayaazhPayroll/1.0 (+https://hr.kayaazh.com)';
const MIN_GAP_MS = 1100;
const TIMEOUT_MS = 8000;
const CACHE_TTL_MS = 7 * 24 * 60 * 60_000;
const CACHE_MAX = 5000;

/** Three decimals is ~110 m — close enough for "which road", and what makes the cache hit. */
export const cacheKey = (lat: number, lng: number) => `${lat.toFixed(3)},${lng.toFixed(3)}`;

interface NominatimAddress {
  house_number?: string; road?: string; pedestrian?: string; amenity?: string; shop?: string; building?: string;
  neighbourhood?: string; suburb?: string; quarter?: string; hamlet?: string; village?: string;
  town?: string; city?: string; municipality?: string; county?: string; state_district?: string; state?: string;
  postcode?: string;
}

/**
 * Nominatim's address parts → one short line, most specific first:
 * "12, Bhavani Main Road, Kavindapadi, Erode". Falls back to the first parts
 * of `display_name` when the structured address says nothing useful.
 */
export function formatAddress(a: NominatimAddress | undefined, displayName?: string): string | null {
  if (a) {
    const place = a.amenity ?? a.shop ?? a.building;
    const street = [a.house_number, a.road ?? a.pedestrian].filter(Boolean).join(', ');
    const area = a.neighbourhood ?? a.suburb ?? a.quarter ?? a.hamlet ?? a.village;
    const town = a.town ?? a.city ?? a.municipality ?? a.county ?? a.state_district;
    const parts = [place, street, area, town].filter((p, i, all): p is string => !!p && all.indexOf(p) === i);
    if (parts.length >= 2) return parts.join(', ');
  }
  if (displayName) {
    // Postcodes and the country add length, not meaning.
    const parts = displayName.split(',').map((s) => s.trim()).filter((s) => s && !/^\d+$/.test(s) && s !== 'India');
    return parts.slice(0, 4).join(', ') || null;
  }
  return null;
}

const cache = new Map<string, { address: string | null; at: number }>();
let queue: Promise<unknown> = Promise.resolve();
let lastCall = 0;

/** One request at a time, spaced out — Nominatim's limit is per client, not per caller. */
function throttled<T>(fn: () => Promise<T>): Promise<T> {
  const run = queue.then(async () => {
    const wait = lastCall + MIN_GAP_MS - Date.now();
    if (wait > 0) await new Promise((r) => setTimeout(r, wait));
    lastCall = Date.now();
    return fn();
  });
  queue = run.catch(() => undefined);
  return run;
}

/** A short street address for a point, or null when none can be found. Never throws. */
export async function reverseGeocode(lat: number, lng: number): Promise<string | null> {
  const key = cacheKey(lat, lng);
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < CACHE_TTL_MS) return hit.address;

  const address = await throttled(async () => {
    const url = `${ENDPOINT}?format=jsonv2&zoom=18&addressdetails=1&accept-language=en&lat=${lat.toFixed(5)}&lon=${lng.toFixed(5)}`;
    try {
      const res = await fetch(url, { headers: { 'User-Agent': USER_AGENT }, signal: AbortSignal.timeout(TIMEOUT_MS) });
      if (!res.ok) {
        logger.warn({ status: res.status }, 'reverse geocode refused');
        return undefined; // not cached — worth asking again later
      }
      const body = (await res.json()) as { address?: NominatimAddress; display_name?: string };
      return formatAddress(body.address, body.display_name);
    } catch (err) {
      logger.warn({ err }, 'reverse geocode failed');
      return undefined;
    }
  });
  if (address === undefined) return null;

  if (cache.size >= CACHE_MAX) cache.delete(cache.keys().next().value as string);
  cache.set(key, { address, at: Date.now() });
  return address;
}
