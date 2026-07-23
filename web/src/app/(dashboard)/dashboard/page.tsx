'use client';

import useSWR from 'swr';
import dynamic from 'next/dynamic';
import {
  ResponsiveContainer, AreaChart, Area, BarChart, Bar, XAxis, YAxis,
  Tooltip, CartesianGrid, Legend,
} from 'recharts';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { UserCheck, UserX, Clock4, CalendarOff, FileClock, ArrowUpRight, Users, Building2 } from 'lucide-react';
import { useDashboardStats, type DashboardStats } from '@/hooks/useApi';
import { fetcher } from '@/lib/api';

interface TrendDay { label: string; present: number; late: number; absent: number }
interface BranchStat { branch: string; present: number; total: number }

const BranchMap = dynamic(() => import('@/components/branch-map'), {
  ssr: false,
  loading: () => <div className="flex h-64 items-center justify-center text-muted-foreground">Loading map…</div>,
});

// Zeroed fallback so the dashboard renders instantly, then upgrades to live values.
const fallback: DashboardStats = {
  presentNow: 0, absent: 0, lateArrivals: 0, onLeave: 0, pendingApprovals: 0,
  totalStaff: 0, branches: 0, checkedIn: 0, attendanceRate: 0,
};

interface MapBranch { id: string; name: string; geofenceLat: number; geofenceLng: number; geofenceRadius: number; strictMode: boolean }

export default function DashboardPage() {
  const { data, isLive } = useDashboardStats(fallback);
  const { data: bd } = useSWR<{ branches: MapBranch[] }>('/admin/geofence', fetcher, { shouldRetryOnError: false });
  const { data: td } = useSWR<{ trend: TrendDay[]; branches: BranchStat[] }>('/admin/dashboard/trend', fetcher, { shouldRetryOnError: false, refreshInterval: 60_000 });
  const fmt = (n: number) => (isLive ? n.toLocaleString() : '—');
  const trend = td?.trend ?? [];
  const branchStats = td?.branches ?? [];

  const stats = [
    { label: 'Present Now', value: fmt(data.presentNow), icon: UserCheck, tint: 'text-emerald-600', bg: 'bg-emerald-50' },
    { label: 'Absent', value: fmt(data.absent), icon: UserX, tint: 'text-rose-600', bg: 'bg-rose-50' },
    { label: 'Late Arrivals', value: fmt(data.lateArrivals), icon: Clock4, tint: 'text-amber-600', bg: 'bg-amber-50' },
    { label: 'On Leave', value: fmt(data.onLeave), icon: CalendarOff, tint: 'text-indigo-600', bg: 'bg-indigo-50' },
    { label: 'Pending Approvals', value: fmt(data.pendingApprovals), icon: FileClock, tint: 'text-violet-600', bg: 'bg-violet-50' },
    { label: 'Checked In', value: fmt(data.checkedIn), icon: UserCheck, tint: 'text-brand-600', bg: 'bg-brand-50' },
    { label: 'Total Staff', value: fmt(data.totalStaff), icon: Users, tint: 'text-slate-600', bg: 'bg-slate-100' },
    { label: 'Branches', value: fmt(data.branches), icon: Building2, tint: 'text-cyan-600', bg: 'bg-cyan-50' },
  ];

  return (
    <div className="space-y-8">
      <div className="flex items-end justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Dashboard</h1>
          <p className="text-sm text-muted-foreground">Live overview across all branches</p>
        </div>
        <span className={`chip ${isLive ? 'chip-present' : 'chip-half'}`}>
          {isLive ? '● Live' : 'Offline'}
        </span>
      </div>

      {/* Hero summary panel */}
      <div className="brand-gradient overflow-hidden rounded-2xl p-6 text-white shadow-brand">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div>
            <div className="text-sm text-white/75">Today&apos;s Attendance Rate</div>
            <div className="mt-1 text-4xl font-bold">{isLive ? `${data.attendanceRate}%` : '—%'}</div>
            <div className="mt-1 inline-flex items-center gap-1 text-xs text-white/80">
              <ArrowUpRight className="h-3.5 w-3.5" /> vs. yesterday
            </div>
          </div>
          <div className="grid grid-cols-3 gap-6 text-center">
            <div>
              <div className="text-2xl font-bold">{fmt(data.totalStaff)}</div>
              <div className="text-xs text-white/70">Total Staff</div>
            </div>
            <div>
              <div className="text-2xl font-bold">{fmt(data.branches)}</div>
              <div className="text-xs text-white/70">Branches</div>
            </div>
            <div>
              <div className="text-2xl font-bold">{fmt(data.checkedIn)}</div>
              <div className="text-xs text-white/70">Checked In</div>
            </div>
          </div>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
        {stats.map(({ label, value, icon: Icon, tint, bg }) => (
          <Card key={label}>
            <CardContent className="flex flex-col gap-3 p-5">
              <div className={`flex h-10 w-10 items-center justify-center rounded-xl ${bg}`}>
                <Icon className={`h-5 w-5 ${tint}`} />
              </div>
              <div>
                <div className="text-2xl font-bold">{value}</div>
                <div className="text-xs font-medium text-muted-foreground">{label}</div>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>

      <div className="grid gap-4 md:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Live Map</CardTitle>
          </CardHeader>
          <CardContent>
            <BranchMap branches={bd?.branches ?? []} height={256} />
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Attendance Trend (7 days)</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="h-64">
              {trend.length === 0 ? (
                <div className="flex h-full items-center justify-center text-sm text-muted-foreground">No data yet</div>
              ) : (
                <ResponsiveContainer width="100%" height="100%">
                  <AreaChart data={trend} margin={{ top: 8, right: 8, left: -18, bottom: 0 }}>
                    <defs>
                      <linearGradient id="gPresent" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="5%" stopColor="#16A34A" stopOpacity={0.35} />
                        <stop offset="95%" stopColor="#16A34A" stopOpacity={0} />
                      </linearGradient>
                    </defs>
                    <CartesianGrid strokeDasharray="3 3" stroke="#eee" vertical={false} />
                    <XAxis dataKey="label" tick={{ fontSize: 12 }} tickLine={false} axisLine={false} />
                    <YAxis tick={{ fontSize: 12 }} tickLine={false} axisLine={false} allowDecimals={false} />
                    <Tooltip contentStyle={{ borderRadius: 12, border: '1px solid #eee', fontSize: 13 }} />
                    <Legend wrapperStyle={{ fontSize: 12 }} />
                    <Area type="monotone" dataKey="present" name="Present" stroke="#16A34A" strokeWidth={2} fill="url(#gPresent)" />
                    <Area type="monotone" dataKey="late" name="Late" stroke="#B45309" strokeWidth={2} fillOpacity={0} />
                    <Area type="monotone" dataKey="absent" name="Absent" stroke="#E11D48" strokeWidth={2} fillOpacity={0} />
                  </AreaChart>
                </ResponsiveContainer>
              )}
            </div>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Branch-wise Present Today</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="h-64">
            {branchStats.length === 0 ? (
              <div className="flex h-full items-center justify-center text-sm text-muted-foreground">No branch data yet</div>
            ) : (
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={branchStats} margin={{ top: 8, right: 8, left: -18, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#eee" vertical={false} />
                  <XAxis dataKey="branch" tick={{ fontSize: 12 }} tickLine={false} axisLine={false} />
                  <YAxis tick={{ fontSize: 12 }} tickLine={false} axisLine={false} allowDecimals={false} />
                  <Tooltip contentStyle={{ borderRadius: 12, border: '1px solid #eee', fontSize: 13 }} />
                  <Legend wrapperStyle={{ fontSize: 12 }} />
                  <Bar dataKey="present" name="Present" fill="#2F55F4" radius={[6, 6, 0, 0]} />
                  <Bar dataKey="total" name="Total staff" fill="#dbe2ff" radius={[6, 6, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            )}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
