'use client';

import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { UserCheck, UserX, Clock4, CalendarOff, FileClock, ArrowUpRight } from 'lucide-react';
import { useDashboardStats, type DashboardStats } from '@/hooks/useApi';

// Zeroed fallback so the dashboard renders instantly, then upgrades to live values.
const fallback: DashboardStats = {
  presentNow: 0, absent: 0, lateArrivals: 0, onLeave: 0, pendingApprovals: 0,
  totalStaff: 0, branches: 0, checkedIn: 0, attendanceRate: 0,
};

export default function DashboardPage() {
  const { data, isLive } = useDashboardStats(fallback);
  const fmt = (n: number) => (isLive ? n.toLocaleString() : '—');

  const stats = [
    { label: 'Present Now', value: fmt(data.presentNow), icon: UserCheck, tint: 'text-emerald-600', bg: 'bg-emerald-50' },
    { label: 'Absent', value: fmt(data.absent), icon: UserX, tint: 'text-rose-600', bg: 'bg-rose-50' },
    { label: 'Late Arrivals', value: fmt(data.lateArrivals), icon: Clock4, tint: 'text-amber-600', bg: 'bg-amber-50' },
    { label: 'On Leave', value: fmt(data.onLeave), icon: CalendarOff, tint: 'text-indigo-600', bg: 'bg-indigo-50' },
    { label: 'Pending Approvals', value: fmt(data.pendingApprovals), icon: FileClock, tint: 'text-violet-600', bg: 'bg-violet-50' },
  ];

  return (
    <div className="space-y-8">
      <div className="flex items-end justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Dashboard</h1>
          <p className="text-sm text-muted-foreground">Live overview across all branches</p>
        </div>
        <span className={`chip ${isLive ? 'chip-present' : 'chip-half'}`}>
          {isLive ? '● Live' : 'Sample data'}
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

      <div className="grid grid-cols-2 gap-4 md:grid-cols-5">
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
          <CardContent className="flex h-64 items-center justify-center rounded-xl bg-muted/40 text-muted-foreground">
            {/* TODO: React Leaflet map with employee location dots */}
            Map placeholder
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Attendance Trend (7 days)</CardTitle>
          </CardHeader>
          <CardContent className="flex h-64 items-center justify-center rounded-xl bg-muted/40 text-muted-foreground">
            {/* TODO: Recharts line chart */}
            Chart placeholder
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
