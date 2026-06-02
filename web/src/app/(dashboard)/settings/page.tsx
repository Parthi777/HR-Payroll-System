import { PageHero } from '@/components/page-hero';
import { Card, CardContent } from '@/components/ui/card';
import {
  Building2,
  GitBranch,
  ShieldCheck,
  MessageSquare,
  ScanFace,
  ScrollText,
  ChevronRight,
} from 'lucide-react';

const sections = [
  { name: 'Company Profile', desc: 'Name, logo, address, GST', icon: Building2, tint: 'text-indigo-600', bg: 'bg-indigo-50' },
  { name: 'Branches', desc: 'Add / edit branches & geofences', icon: GitBranch, tint: 'text-violet-600', bg: 'bg-violet-50' },
  { name: 'Roles & Access', desc: 'Super Admin · HR · Branch · Payroll', icon: ShieldCheck, tint: 'text-emerald-600', bg: 'bg-emerald-50' },
  { name: 'WhatsApp API', desc: 'Provider credentials & templates', icon: MessageSquare, tint: 'text-green-600', bg: 'bg-green-50' },
  { name: 'Face Matching', desc: 'Confidence threshold (default 85)', icon: ScanFace, tint: 'text-amber-600', bg: 'bg-amber-50' },
  { name: 'Audit Log', desc: 'Who did what, and when', icon: ScrollText, tint: 'text-rose-600', bg: 'bg-rose-50' },
];

export default function SettingsPage() {
  return (
    <div className="space-y-6">
      <PageHero title="Settings" subtitle="Company configuration & access control" />

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {sections.map(({ name, desc, icon: Icon, tint, bg }) => (
          <Card key={name} className="group cursor-pointer transition-shadow hover:shadow-brand">
            <CardContent className="flex items-center gap-4 p-5">
              <div className={`flex h-11 w-11 items-center justify-center rounded-xl ${bg}`}>
                <Icon className={`h-5 w-5 ${tint}`} />
              </div>
              <div className="min-w-0 flex-1">
                <div className="font-semibold">{name}</div>
                <div className="truncate text-xs text-muted-foreground">{desc}</div>
              </div>
              <ChevronRight className="h-4 w-4 text-muted-foreground transition-transform group-hover:translate-x-0.5" />
            </CardContent>
          </Card>
        ))}
      </div>
    </div>
  );
}
