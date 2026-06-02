import { PageHero } from '@/components/page-hero';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Check, X } from 'lucide-react';

const pending = [
  { name: 'Ravi Kumar', type: 'CL', range: 'Feb 12 – Feb 13', days: 2, reason: 'Family function' },
  { name: 'Priya S', type: 'SL', range: 'Feb 11', days: 1, reason: 'Fever' },
  { name: 'Karthik V', type: 'EL', range: 'Feb 14 – Feb 18', days: 5, reason: 'Vacation' },
];

const summary = [
  { label: 'Pending', value: '3', tint: 'text-amber-600', bg: 'bg-amber-50' },
  { label: 'Approved (Feb)', value: '24', tint: 'text-emerald-600', bg: 'bg-emerald-50' },
  { label: 'Rejected (Feb)', value: '2', tint: 'text-rose-600', bg: 'bg-rose-50' },
  { label: 'On Leave Today', value: '5', tint: 'text-indigo-600', bg: 'bg-indigo-50' },
];

export default function LeavesPage() {
  return (
    <div className="space-y-6">
      <PageHero title="Leaves" subtitle="Approve requests & manage balances" />

      <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
        {summary.map((s) => (
          <Card key={s.label}>
            <CardContent className="p-5">
              <div className={`mb-2 inline-flex rounded-lg px-2 py-1 text-2xl font-bold ${s.bg} ${s.tint}`}>
                {s.value}
              </div>
              <div className="text-xs font-medium text-muted-foreground">{s.label}</div>
            </CardContent>
          </Card>
        ))}
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Pending Approvals</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          {pending.map((p) => (
            <div
              key={p.name}
              className="flex flex-wrap items-center gap-4 rounded-xl border border-border/60 bg-muted/30 p-4"
            >
              <div className="flex h-10 w-10 items-center justify-center rounded-full brand-gradient text-xs font-bold text-white">
                {p.name.split(' ').map((n) => n[0]).join('')}
              </div>
              <div className="min-w-0 flex-1">
                <div className="font-semibold">{p.name}</div>
                <div className="text-xs text-muted-foreground">
                  {p.range} · {p.reason}
                </div>
              </div>
              <span className="chip chip-leave">{p.type} · {p.days}d</span>
              <div className="flex gap-2">
                <button className="flex h-9 w-9 items-center justify-center rounded-lg bg-emerald-50 text-emerald-600 hover:bg-emerald-100">
                  <Check className="h-4 w-4" />
                </button>
                <button className="flex h-9 w-9 items-center justify-center rounded-lg bg-rose-50 text-rose-600 hover:bg-rose-100">
                  <X className="h-4 w-4" />
                </button>
              </div>
            </div>
          ))}
        </CardContent>
      </Card>
    </div>
  );
}
