'use client';

import useSWR from 'swr';
import { fetcher } from '@/lib/api';
import { PageHero } from '@/components/page-hero';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { MapPin, Loader2 } from 'lucide-react';

interface Branch {
  id: string;
  name: string;
  geofenceLat: number;
  geofenceLng: number;
  geofenceRadius: number;
  strictMode: boolean;
}
interface Violation {
  id: string;
  lat: number;
  lng: number;
  distance: number;
  timestamp: string;
}

export default function GeofencePage() {
  const { data: bd, error, isLoading } = useSWR<{ branches: Branch[] }>('/admin/geofence', fetcher, { shouldRetryOnError: false });
  const { data: vd } = useSWR<{ violations: Violation[] }>('/admin/geofence/violations', fetcher, { shouldRetryOnError: false });
  const branches = bd?.branches ?? [];
  const violations = vd?.violations ?? [];

  return (
    <div className="space-y-6">
      <PageHero title="Geofence" subtitle="Work zones & violations · live" />

      {isLoading && <div className="flex items-center gap-2 text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin" /> Loading…</div>}
      {error && <Card><CardContent className="p-5 text-sm text-destructive">Couldn&apos;t load geofences. Sign in and ensure the backend is running.</CardContent></Card>}

      {!isLoading && !error && (
        <div className="grid gap-4 lg:grid-cols-3">
          <Card className="lg:col-span-2">
            <CardHeader><CardTitle className="text-base">Branches ({branches.length})</CardTitle></CardHeader>
            <CardContent className="space-y-3">
              {branches.length === 0 && <div className="text-sm text-muted-foreground">No branches yet.</div>}
              {branches.map((b) => (
                <div key={b.id} className="flex items-center gap-3 rounded-xl border border-border/60 bg-muted/30 p-4">
                  <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-brand-50 text-brand-600"><MapPin className="h-5 w-5" /></div>
                  <div className="min-w-0 flex-1">
                    <div className="truncate font-semibold">{b.name}</div>
                    <div className="text-xs text-muted-foreground">
                      {b.geofenceLat.toFixed(4)}, {b.geofenceLng.toFixed(4)} · radius {b.geofenceRadius}m
                    </div>
                  </div>
                  <span className={`chip ${b.strictMode ? 'chip-off' : 'chip-present'}`}>{b.strictMode ? 'Strict' : 'Soft'}</span>
                </div>
              ))}
            </CardContent>
          </Card>

          <Card>
            <CardHeader><CardTitle className="text-base">Violations ({violations.length})</CardTitle></CardHeader>
            <CardContent className="space-y-3">
              {violations.length === 0 && <div className="text-sm text-muted-foreground">No violations logged. 🎉</div>}
              {violations.map((v) => (
                <div key={v.id} className="rounded-xl border border-border/60 bg-rose-50/50 p-3 text-sm">
                  <div className="font-medium text-rose-600">{Math.round(v.distance)}m outside zone</div>
                  <div className="text-xs text-muted-foreground">{new Date(v.timestamp).toLocaleString()}</div>
                </div>
              ))}
            </CardContent>
          </Card>
        </div>
      )}
    </div>
  );
}
