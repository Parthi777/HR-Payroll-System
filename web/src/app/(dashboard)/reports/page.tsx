'use client';

import useSWR from 'swr';
import { fetcher } from '@/lib/api';
import { PageHero } from '@/components/page-hero';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { UserCheck, UserX, Clock4, CalendarOff, FileClock, TrendingUp } from 'lucide-react';

interface Stats {
  presentNow: number; absent: number; lateArrivals: number; onLeave: number;
  pendingApprovals: number; totalStaff: number; attendanceRate: number; checkedIn: number;
}

export default function ReportsPage() {
  const { data } = useSWR<Stats>('/admin/dashboard/stats', fetcher, { shouldRetryOnError: false, refreshInterval: 15000 });
  const s = data;

  const cards = [
    { label: 'Attendance Rate (today)', value: s ? `${s.attendanceRate}%` : '—', icon: TrendingUp, tint: 'text-emerald-600', bg: 'bg-emerald-50' },
    { label: 'Present', value: s?.checkedIn ?? '—', icon: UserCheck, tint: 'text-emerald-600', bg: 'bg-emerald-50' },
    { label: 'Absent', value: s?.absent ?? '—', icon: UserX, tint: 'text-rose-600', bg: 'bg-rose-50' },
    { label: 'Late Arrivals', value: s?.lateArrivals ?? '—', icon: Clock4, tint: 'text-amber-600', bg: 'bg-amber-50' },
    { label: 'On Leave', value: s?.onLeave ?? '—', icon: CalendarOff, tint: 'text-indigo-600', bg: 'bg-indigo-50' },
    { label: 'Pending Approvals', value: s?.pendingApprovals ?? '—', icon: FileClock, tint: 'text-violet-600', bg: 'bg-violet-50' },
  ];

  return (
    <div className="space-y-6">
      <PageHero title="Reports & Analytics" subtitle={`Live summary · ${s?.totalStaff ?? 0} total staff`} />

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {cards.map(({ label, value, icon: Icon, tint, bg }) => (
          <Card key={label}>
            <CardContent className="p-5">
              <div className={`mb-3 flex h-11 w-11 items-center justify-center rounded-xl ${bg}`}>
                <Icon className={`h-5 w-5 ${tint}`} />
              </div>
              <div className="text-2xl font-bold">{value}</div>
              <div className="text-xs font-medium text-muted-foreground">{label}</div>
            </CardContent>
          </Card>
        ))}
      </div>

      <Card>
        <CardHeader><CardTitle className="text-base">Detailed Reports</CardTitle></CardHeader>
        <CardContent className="text-sm text-muted-foreground">
          Live operational summary above refreshes every 15s. CSV/PDF export of attendance,
          payroll and leave-utilisation reports is the next step (needs an export endpoint).
        </CardContent>
      </Card>
    </div>
  );
}
