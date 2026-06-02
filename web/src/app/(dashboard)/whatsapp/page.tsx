'use client';

import useSWR from 'swr';
import { fetcher } from '@/lib/api';
import { PageHero } from '@/components/page-hero';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { MessageSquare, Loader2 } from 'lucide-react';

interface WaLog {
  id: string;
  phone: string;
  templateName: string;
  status: string;
  trigger: string;
  createdAt: string;
}

const chipClass: Record<string, string> = {
  READ: 'chip-present',
  DELIVERED: 'chip-leave',
  SENT: 'chip-half',
  QUEUED: 'chip-half',
  FAILED: 'chip-off',
};

export default function WhatsappPage() {
  const { data, error, isLoading } = useSWR<{ logs: WaLog[] }>('/admin/whatsapp/logs', fetcher, { shouldRetryOnError: false });
  const { data: t } = useSWR<{ templates: string[] }>('/admin/whatsapp/templates', fetcher, { shouldRetryOnError: false });
  const logs = data?.logs ?? [];
  const templates = t?.templates ?? [];

  const delivered = logs.filter((l) => l.status === 'DELIVERED' || l.status === 'READ').length;
  const failed = logs.filter((l) => l.status === 'FAILED').length;

  return (
    <div className="space-y-6">
      <PageHero title="WhatsApp Center" subtitle="Templates & message logs · live" />

      <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
        <Card><CardContent className="p-5"><div className="text-2xl font-bold">{logs.length}</div><div className="text-xs text-muted-foreground">Total Messages</div></CardContent></Card>
        <Card><CardContent className="p-5"><div className="text-2xl font-bold text-emerald-600">{delivered}</div><div className="text-xs text-muted-foreground">Delivered/Read</div></CardContent></Card>
        <Card><CardContent className="p-5"><div className="text-2xl font-bold text-indigo-600">{templates.length}</div><div className="text-xs text-muted-foreground">Templates</div></CardContent></Card>
        <Card><CardContent className="p-5"><div className="text-2xl font-bold text-rose-600">{failed}</div><div className="text-xs text-muted-foreground">Failed</div></CardContent></Card>
      </div>

      <Card>
        <CardHeader><CardTitle className="text-base">Recent Messages</CardTitle></CardHeader>
        <CardContent className="space-y-3">
          {isLoading && <div className="flex items-center gap-2 text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin" /> Loading…</div>}
          {error && <div className="text-sm text-destructive">Couldn&apos;t load logs. Sign in and ensure the backend is running.</div>}
          {!isLoading && !error && logs.length === 0 && (
            <div className="text-sm text-muted-foreground">
              No messages sent yet. WhatsApp delivery activates once a provider (WATI/Twilio/Meta) is configured — message logs will appear here.
            </div>
          )}
          {logs.map((l) => (
            <div key={l.id} className="flex items-center gap-3 rounded-xl border border-border/60 bg-muted/30 p-4">
              <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-emerald-50 text-emerald-600"><MessageSquare className="h-5 w-5" /></div>
              <div className="min-w-0 flex-1">
                <div className="truncate font-semibold">{l.phone}</div>
                <div className="truncate font-mono text-xs text-muted-foreground">{l.templateName} · {l.trigger}</div>
              </div>
              <div className="text-xs text-muted-foreground">{new Date(l.createdAt).toLocaleTimeString()}</div>
              <span className={`chip ${chipClass[l.status] ?? 'chip-half'}`}>{l.status}</span>
            </div>
          ))}
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle className="text-base">Approved Templates</CardTitle></CardHeader>
        <CardContent className="flex flex-wrap gap-2">
          {templates.map((t) => <span key={t} className="chip chip-leave font-mono">{t}</span>)}
        </CardContent>
      </Card>
    </div>
  );
}
