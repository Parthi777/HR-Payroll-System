import { PageHero } from '@/components/page-hero';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { MapPin, Plus } from 'lucide-react';

const branches = [
  { name: 'Bhavani Branch', radius: '100m', mode: 'Strict', violations: 2 },
  { name: 'Erode Branch', radius: '150m', mode: 'Soft', violations: 0 },
  { name: 'Salem Branch', radius: '100m', mode: 'Strict', violations: 1 },
];

export default function GeofencePage() {
  return (
    <div className="space-y-6">
      <PageHero title="Geofence" subtitle="Define work zones & monitor violations">
        <button className="flex h-10 items-center gap-2 rounded-xl bg-white px-4 text-sm font-semibold text-brand-600 hover:bg-white/90">
          <Plus className="h-4 w-4" /> New Geofence
        </button>
      </PageHero>

      <div className="grid gap-4 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardHeader>
            <CardTitle className="text-base">Branch Map</CardTitle>
          </CardHeader>
          <CardContent className="flex h-80 items-center justify-center rounded-xl bg-muted/40 text-muted-foreground">
            {/* TODO: React Leaflet map with draggable geofence circles/polygons */}
            Map placeholder
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">Branches</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            {branches.map((b) => (
              <div key={b.name} className="flex items-center gap-3 rounded-xl border border-border/60 bg-muted/30 p-4">
                <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-brand-50 text-brand-600">
                  <MapPin className="h-5 w-5" />
                </div>
                <div className="min-w-0 flex-1">
                  <div className="truncate font-semibold">{b.name}</div>
                  <div className="text-xs text-muted-foreground">{b.radius} · {b.mode} mode</div>
                </div>
                <span className={`chip ${b.violations > 0 ? 'chip-off' : 'chip-present'}`}>
                  {b.violations} alerts
                </span>
              </div>
            ))}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
