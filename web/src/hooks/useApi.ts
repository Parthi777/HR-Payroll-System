'use client';

import useSWR from 'swr';
import { fetcher } from '@/lib/api';

/** Dashboard real-time overview (see CLAUDE.md "Dashboard (Home)"). */
export interface DashboardStats {
  presentNow: number;
  absent: number;
  lateArrivals: number;
  onLeave: number;
  pendingApprovals: number;
  totalStaff: number;
  branches: number;
  checkedIn: number;
  attendanceRate: number;
}

export interface LiveAttendanceRow {
  id: string;
  name: string;
  branch: string;
  department: string;
  designation: string;
  checkIn: string | null;
  checkOut: string | null;
  status: 'Present' | 'Late' | 'Absent' | 'On Leave';
}

/**
 * Generic typed hook. `fallback` keeps the UI populated before the backend is up
 * (and on error), so pages render immediately and upgrade to live data seamlessly.
 */
function useApiData<T>(path: string, fallback: T) {
  const { data, error, isLoading, mutate } = useSWR<T>(path, fetcher, {
    fallbackData: fallback,
    revalidateOnFocus: false,
    shouldRetryOnError: false,
  });
  return { data: data ?? fallback, error, isLoading, isLive: !!data && !error, mutate };
}

export function useDashboardStats(fallback: DashboardStats) {
  return useApiData<DashboardStats>('/admin/dashboard/stats', fallback);
}

export function useLiveAttendance(fallback: LiveAttendanceRow[]) {
  // Polls every 10s for the live monitor feed.
  const { data, error, isLoading, mutate } = useSWR<LiveAttendanceRow[]>(
    '/admin/attendance/live',
    fetcher,
    { fallbackData: fallback, refreshInterval: 10_000, shouldRetryOnError: false },
  );
  return { data: data ?? fallback, error, isLoading, isLive: !!data && !error, mutate };
}

/** Where a tracked employee is right now — see docs/LIVE-TRACKING.md. */
/** FIELD: a field worker outside the fence — that is their job, not absence. */
export type TrackState = 'INSIDE' | 'OUTSIDE' | 'OFF' | 'NO_SIGNAL' | 'FIELD';

export interface TrackedEmployee {
  attendanceId: string;
  employeeId: string;
  name: string;
  employeeCode: string;
  branchId: string;
  branch: string;
  department: string;
  designation: string;
  checkIn: string | null;
  /** Checks in anywhere; shown "On field" rather than away. */
  fieldWorker?: boolean;
  state: TrackState;
  /** ISO — when the current state began ("away for 23 min"). */
  since: string;
  last: { lat: number; lng: number; accuracy: number | null; ts: string; distance: number | null; status: string | null } | null;
  insideMin: number;
  outsideMin: number;
  offMin: number;
  noSignalMin: number;
  episodes: number;
  mockFixes: number;
  /** The day so far as consecutive stretches — drawn as a small timeline. */
  segments: TrackSegment[];
}

export interface TrackSegment {
  state: TrackState;
  from: string;
  to: string;
}

export interface TrackBranch {
  id: string;
  name: string;
  geofenceLat: number;
  geofenceLng: number;
  geofenceRadius: number;
  strictMode: boolean;
  /** JSON corners when the fence is a drawn building outline. */
  geofencePolygon?: string | null;
}

export type LiveTracking =
  | { enabled: false; intervalSec: number; branches: TrackBranch[] }
  | {
      enabled: true;
      intervalSec: number;
      generatedAt: string;
      branches: TrackBranch[];
      untrackedCheckedIn: number;
      /** Checked in without tracking, per branch id. */
      untrackedByBranch: Record<string, number>;
      employees: TrackedEmployee[];
    };

/**
 * A street address for a point. Rounded to ~100 m, the same square the server
 * caches on, so a person standing still is looked up once, not every poll.
 */
export function useAddress(lat: number | null | undefined, lng: number | null | undefined) {
  const key = lat != null && lng != null ? `/admin/tracking/address?lat=${lat.toFixed(3)}&lng=${lng.toFixed(3)}` : null;
  const { data, isLoading } = useSWR<{ address: string | null }>(key, fetcher, {
    revalidateOnFocus: false,
    revalidateIfStale: false,
    dedupingInterval: 10 * 60_000,
    shouldRetryOnError: false,
  });
  return { address: data?.address ?? null, isLoading: !!key && isLoading };
}

/** Polls every 30s — the phones report every 2 minutes, so faster buys nothing. */
export function useLiveTracking(branchId: string) {
  const { data, error, isLoading, mutate } = useSWR<LiveTracking>(
    `/admin/tracking/live${branchId ? `?branchId=${branchId}` : ''}`,
    fetcher,
    { refreshInterval: 30_000, shouldRetryOnError: false },
  );
  return { data, error, isLoading, isLive: !!data && !error, mutate };
}
