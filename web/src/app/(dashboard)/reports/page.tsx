import { PageHero } from '@/components/page-hero';
import { Card, CardContent } from '@/components/ui/card';
import {
  CalendarDays,
  Clock4,
  TimerReset,
  MapPinOff,
  Wallet,
  Users,
  Download,
} from 'lucide-react';

const reports = [
  { name: 'Attendance Report', desc: 'Daily / monthly / custom range', icon: CalendarDays, tint: 'text-indigo-600', bg: 'bg-indigo-50' },
  { name: 'Late Arrivals', desc: 'Employees past grace period', icon: Clock4, tint: 'text-amber-600', bg: 'bg-amber-50' },
  { name: 'Overtime', desc: 'Hours beyond shift end', icon: TimerReset, tint: 'text-violet-600', bg: 'bg-violet-50' },
  { name: 'Geofence Violations', desc: 'Out-of-zone check-ins', icon: MapPinOff, tint: 'text-rose-600', bg: 'bg-rose-50' },
  { name: 'Payroll Summary', desc: 'Gross, deductions & net', icon: Wallet, tint: 'text-emerald-600', bg: 'bg-emerald-50' },
  { name: 'Employee Turnover', desc: 'Joins & exits by month', icon: Users, tint: 'text-sky-600', bg: 'bg-sky-50' },
];

export default function ReportsPage() {
  return (
    <div className="space-y-6">
      <PageHero title="Reports & Analytics" subtitle="Generate and export operational reports" />

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {reports.map(({ name, desc, icon: Icon, tint, bg }) => (
          <Card key={name} className="group cursor-pointer transition-shadow hover:shadow-brand">
            <CardContent className="p-5">
              <div className={`mb-3 flex h-11 w-11 items-center justify-center rounded-xl ${bg}`}>
                <Icon className={`h-5 w-5 ${tint}`} />
              </div>
              <div className="font-semibold">{name}</div>
              <div className="text-xs text-muted-foreground">{desc}</div>
              <div className="mt-4 flex items-center gap-1 text-xs font-medium text-brand-600">
                <Download className="h-3.5 w-3.5" /> Export PDF / Excel / CSV
              </div>
            </CardContent>
          </Card>
        ))}
      </div>
    </div>
  );
}
