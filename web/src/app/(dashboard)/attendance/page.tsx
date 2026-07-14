'use client';

import { useState } from 'react';
import useSWR from 'swr';
import { PageHero } from '@/components/page-hero';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Download, Filter, Check, X, Camera, Loader2, MapPinOff } from 'lucide-react';
import { useLiveAttendance, type LiveAttendanceRow } from '@/hooks/useApi';
import { fetcher, api, apiBlobUrl } from '@/lib/api';

interface PendingApproval {
  id: string;
  name: string;
  employeeCode: string;
  branch: string;
  date: string;
  checkIn: string | null;
  reason: string | null;
  hasSelfie: boolean;
}

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

      <ApprovalsCard />

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

/** Out-of-geofence selfie check-ins waiting for HR/admin sign-off. Hidden when empty. */
function ApprovalsCard() {
  const { data, mutate } = useSWR<{ approvals: PendingApproval[] }>(
    '/admin/attendance/approvals',
    fetcher,
    { shouldRetryOnError: false, refreshInterval: 30_000 },
  );
  const approvals = data?.approvals ?? [];
  const [busyId, setBusyId] = useState<string | null>(null);

  async function decide(id: string, action: 'approve' | 'reject') {
    if (action === 'reject' && !confirm('Reject this check-in? The day will be marked absent.')) return;
    setBusyId(id);
    try {
      await api(`/admin/attendance/${id}/${action}`, { method: 'PATCH' });
      await mutate();
    } catch (e) {
      alert(e instanceof Error ? e.message : `Failed to ${action}`);
    } finally {
      setBusyId(null);
    }
  }

  async function viewSelfie(id: string) {
    try {
      window.open(await apiBlobUrl(`/admin/attendance/${id}/selfie`), '_blank');
    } catch {
      alert('Could not open selfie');
    }
  }

  if (approvals.length === 0) return null;

  return (
    <Card className="border-amber-300/60">
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <MapPinOff className="h-4 w-4 text-amber-600" />
          Outside-geofence check-ins awaiting approval ({approvals.length})
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        {approvals.map((a) => (
          <div key={a.id} className="flex flex-wrap items-center gap-3 rounded-xl border border-border/60 bg-muted/30 p-4">
            <div className="min-w-0 flex-1">
              <div className="font-semibold">{a.name} <span className="text-xs text-muted-foreground">({a.employeeCode}) · {a.branch}</span></div>
              <div className="text-xs text-muted-foreground">{a.date} · Check-in {a.checkIn ?? '—'}</div>
              {a.reason && <div className="mt-1 text-xs text-amber-700">{a.reason}</div>}
            </div>
            {a.hasSelfie && (
              <button onClick={() => viewSelfie(a.id)} title="View selfie" className="flex h-9 items-center gap-1.5 rounded-lg border border-border bg-card px-3 text-xs font-semibold text-muted-foreground hover:text-foreground">
                <Camera className="h-4 w-4" /> Selfie
              </button>
            )}
            <button onClick={() => decide(a.id, 'approve')} disabled={busyId === a.id} className="flex h-9 items-center gap-1.5 rounded-lg bg-emerald-600 px-3 text-xs font-semibold text-white hover:bg-emerald-700 disabled:opacity-50">
              {busyId === a.id ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />} Approve
            </button>
            <button onClick={() => decide(a.id, 'reject')} disabled={busyId === a.id} className="flex h-9 items-center gap-1.5 rounded-lg bg-rose-50 px-3 text-xs font-semibold text-rose-700 hover:bg-rose-100 disabled:opacity-50">
              <X className="h-4 w-4" /> Reject
            </button>
          </div>
        ))}
        <p className="text-xs text-muted-foreground">Approved check-ins count for attendance & payroll. Rejected ones are marked absent.</p>
      </CardContent>
    </Card>
  );
}
