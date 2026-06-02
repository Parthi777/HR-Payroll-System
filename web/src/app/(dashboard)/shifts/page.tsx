import { PageHero } from '@/components/page-hero';
import { Card, CardContent } from '@/components/ui/card';
import { Plus, Clock } from 'lucide-react';

const shifts = [
  { name: 'Morning', time: '06:00 – 14:00', staff: 18, grace: '15 min' },
  { name: 'General', time: '09:00 – 18:00', staff: 42, grace: '15 min' },
  { name: 'Evening', time: '14:00 – 22:00', staff: 16, grace: '10 min' },
  { name: 'Night', time: '22:00 – 06:00', staff: 10, grace: '20 min' },
];

export default function ShiftsPage() {
  return (
    <div className="space-y-6">
      <PageHero title="Shifts" subtitle="Define shift types, grace periods & rotations">
        <button className="flex h-10 items-center gap-2 rounded-xl bg-white px-4 text-sm font-semibold text-brand-600 hover:bg-white/90">
          <Plus className="h-4 w-4" /> New Shift
        </button>
      </PageHero>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {shifts.map((s) => (
          <Card key={s.name}>
            <CardContent className="p-5">
              <div className="mb-3 flex h-10 w-10 items-center justify-center rounded-xl bg-brand-50 text-brand-600">
                <Clock className="h-5 w-5" />
              </div>
              <div className="text-lg font-bold">{s.name}</div>
              <div className="text-sm text-muted-foreground">{s.time}</div>
              <div className="mt-4 flex items-center justify-between text-xs">
                <span className="chip chip-leave">{s.staff} staff</span>
                <span className="text-muted-foreground">Grace {s.grace}</span>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>
    </div>
  );
}
