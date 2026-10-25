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
export type TrackState = 'INSIDE' | 'OUTSIDE' | 'OFF' | 'NO_SIGNAL';

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
}

export interface TrackBranch {
  id: string;
  name: string;
  geofenceLat: number;
  geofenceLng: number;
  geofenceRadius: number;
  strictMode: boolean;
}

export type LiveTracking =
  | { enabled: false; intervalSec: number; branches: TrackBranch[] }
  | {
      enabled: true;
      intervalSec: number;
      generatedAt: string;
      branches: TrackBranch[];
      untrackedCheckedIn: number;
      employees: TrackedEmployee[];
    };

/** Polls every 30s — the phones report every 2 minutes, so faster buys nothing. */
export function useLiveTracking(branchId: string) {
  const { data, error, isLoading, mutate } = useSWR<LiveTracking>(
    `/admin/tracking/live${branchId ? `?branchId=${branchId}` : ''}`,
    fetcher,
    { refreshInterval: 30_000, shouldRetryOnError: false },
  );
  return { data, error, isLoading, isLive: !!data && !error, mutate };
}
