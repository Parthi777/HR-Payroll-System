'use client';

import { PageHero } from '@/components/page-hero';
import { Card, CardContent } from '@/components/ui/card';
import { Download, Filter } from 'lucide-react';
import { useLiveAttendance, type LiveAttendanceRow } from '@/hooks/useApi';

// Rendered immediately; replaced by live data once the backend responds.
const sampleRows: LiveAttendanceRow[] = [
  { id: '1', name: 'Ravi Kumar', branch: 'Bhavani', checkIn: '09:02 AM', checkOut: null, status: 'Present' },
  { id: '2', name: 'Priya S', branch: 'Erode', checkIn: '09:18 AM', checkOut: null, status: 'Late' },
  { id: '3', name: 'Arjun M', branch: 'Salem', checkIn: null, checkOut: null, status: 'Absent' },
  { id: '4', name: 'Divya R', branch: 'Bhavani', checkIn: '08:55 AM', checkOut: '06:10 PM', status: 'Present' },
  { id: '5', name: 'Karthik V', branch: 'Erode', checkIn: null, checkOut: null, status: 'On Leave' },
];

const chipClass: Record<string, string> = {
  Present: 'chip-present',
  Late: 'chip-half',
  Absent: 'chip-off',
  'On Leave': 'chip-leave',
};

export default function AttendancePage() {
  const { data: rows, isLive } = useLiveAttendance(sampleRows);

  return (
    <div className="space-y-6">
      <PageHero title="Live Attendance" subtitle="Real-time check-in feed across all branches">
        <span className={`chip ${isLive ? 'chip-present' : 'chip-half'}`}>
          {isLive ? '● Live' : 'Sample data'}
        </span>
        <button className="flex h-10 items-center gap-2 rounded-xl bg-white/15 px-4 text-sm font-medium ring-1 ring-white/25 hover:bg-white/25">
          <Filter className="h-4 w-4" /> Filter
        </button>
        <button className="flex h-10 items-center gap-2 rounded-xl bg-white px-4 text-sm font-semibold text-brand-600 hover:bg-white/90">
          <Download className="h-4 w-4" /> Export
        </button>
      </PageHero>

      <Card>
        <CardContent className="p-0">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border/60 text-left text-xs uppercase tracking-wide text-muted-foreground">
                  <th className="px-6 py-3 font-medium">Employee</th>
                  <th className="px-6 py-3 font-medium">Branch</th>
                  <th className="px-6 py-3 font-medium">Check-In</th>
                  <th className="px-6 py-3 font-medium">Check-Out</th>
                  <th className="px-6 py-3 font-medium">Status</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.id} className="border-b border-border/40 last:border-0 hover:bg-muted/40">
                    <td className="px-6 py-4 font-medium">{r.name}</td>
                    <td className="px-6 py-4 text-muted-foreground">{r.branch}</td>
                    <td className="px-6 py-4">{r.checkIn ?? '—'}</td>
                    <td className="px-6 py-4">{r.checkOut ?? '—'}</td>
                    <td className="px-6 py-4">
                      <span className={`chip ${chipClass[r.status]}`}>{r.status}</span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
