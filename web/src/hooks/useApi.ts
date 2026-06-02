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
