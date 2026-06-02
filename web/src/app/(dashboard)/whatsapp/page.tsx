import { PageHero } from '@/components/page-hero';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Send, MessageSquare } from 'lucide-react';

const logs = [
  { name: 'Ravi Kumar', template: 'CHECK_IN_CONFIRMATION', status: 'Read', time: '09:02 AM' },
  { name: 'Priya S', template: 'LEAVE_APPROVED', status: 'Delivered', time: '08:40 AM' },
  { name: 'Arjun M', template: 'ABSENT_ALERT', status: 'Sent', time: '10:15 AM' },
  { name: 'Divya R', template: 'SALARY_SLIP', status: 'Read', time: 'Yesterday' },
];

const chipClass: Record<string, string> = {
  Read: 'chip-present',
  Delivered: 'chip-leave',
  Sent: 'chip-half',
  Failed: 'chip-off',
};

export default function WhatsappPage() {
  return (
    <div className="space-y-6">
      <PageHero title="WhatsApp Center" subtitle="Templates, triggers & message logs">
        <button className="flex h-10 items-center gap-2 rounded-xl bg-white px-4 text-sm font-semibold text-brand-600 hover:bg-white/90">
          <Send className="h-4 w-4" /> Compose
        </button>
      </PageHero>

      <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
        <Card><CardContent className="p-5"><div className="text-2xl font-bold">1,284</div><div className="text-xs text-muted-foreground">Sent Today</div></CardContent></Card>
        <Card><CardContent className="p-5"><div className="text-2xl font-bold text-emerald-600">96%</div><div className="text-xs text-muted-foreground">Delivery Rate</div></CardContent></Card>
        <Card><CardContent className="p-5"><div className="text-2xl font-bold text-indigo-600">8</div><div className="text-xs text-muted-foreground">Active Templates</div></CardContent></Card>
        <Card><CardContent className="p-5"><div className="text-2xl font-bold text-rose-600">12</div><div className="text-xs text-muted-foreground">Failed</div></CardContent></Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Recent Messages</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          {logs.map((l, i) => (
            <div key={i} className="flex items-center gap-3 rounded-xl border border-border/60 bg-muted/30 p-4">
              <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-emerald-50 text-emerald-600">
                <MessageSquare className="h-5 w-5" />
              </div>
              <div className="min-w-0 flex-1">
                <div className="truncate font-semibold">{l.name}</div>
                <div className="truncate font-mono text-xs text-muted-foreground">{l.template}</div>
              </div>
              <div className="text-xs text-muted-foreground">{l.time}</div>
              <span className={`chip ${chipClass[l.status]}`}>{l.status}</span>
            </div>
          ))}
        </CardContent>
      </Card>
    </div>
  );
}
