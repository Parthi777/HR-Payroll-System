'use client';

import useSWR from 'swr';
import { fetcher } from '@/lib/api';
import { PageHero } from '@/components/page-hero';
import { Card, CardContent } from '@/components/ui/card';
import { Plus, Clock, Loader2 } from 'lucide-react';

interface ShiftRow {
  id: string;
  name: string;
  startTime: string;
  endTime: string;
  gracePeriod: number;
  isNightShift: boolean;
}

export default function ShiftsPage() {
  const { data, error, isLoading } = useSWR<{ shifts: ShiftRow[] }>('/shifts', fetcher, {
    shouldRetryOnError: false,
  });
  const shifts = data?.shifts ?? [];

  return (
    <div className="space-y-6">
      <PageHero title="Shifts" subtitle="Shift types, grace periods & rotations · live">
        <button className="flex h-10 items-center gap-2 rounded-xl bg-white px-4 text-sm font-semibold text-brand-600 hover:bg-white/90">
          <Plus className="h-4 w-4" /> New Shift
        </button>
      </PageHero>

      {isLoading && <div className="flex items-center gap-2 text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin" /> Loading shifts…</div>}
      {error && <Card><CardContent className="p-5 text-sm text-destructive">Couldn&apos;t load shifts. Sign in and ensure the backend is running.</CardContent></Card>}

      {!isLoading && !error && (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {shifts.length === 0 && (
            <Card><CardContent className="p-5 text-sm text-muted-foreground">No shifts defined.</CardContent></Card>
          )}
          {shifts.map((s) => (
            <Card key={s.id}>
              <CardContent className="p-5">
                <div className="mb-3 flex h-10 w-10 items-center justify-center rounded-xl bg-brand-50 text-brand-600">
                  <Clock className="h-5 w-5" />
                </div>
                <div className="text-lg font-bold">{s.name}</div>
                <div className="text-sm text-muted-foreground">{s.startTime} – {s.endTime}</div>
                <div className="mt-4 flex items-center justify-between text-xs">
                  {s.isNightShift && <span className="chip chip-leave">Night</span>}
                  <span className="text-muted-foreground">Grace {s.gracePeriod}m</span>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
