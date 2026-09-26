'use client';

import { useCallback, useEffect, useState } from 'react';
import { AlertTriangle, Check, Copy, Link2, Loader2, Plus, RotateCcw, Send } from 'lucide-react';
import { api } from '@/lib/api';
import { PageHero } from '@/components/page-hero';

interface Connection {
  id: string;
  name: string;
  webhookUrl: string | null;
  paysClaims: boolean;
  isActive: boolean;
  lastUsedAt: string | null;
  createdAt: string;
}

interface EventRow {
  id: string;
  type: string;
  entityId: string;
  status: string;
  attempts: number;
  lastError: string | null;
  createdAt: string;
  deliveredAt: string | null;
}

/** A key and signing secret, which exist on screen and nowhere else. */
interface Handover {
  name: string;
  token: string;
  webhookSecret: string;
}

const when = (iso: string | null) =>
  iso ? new Date(iso).toLocaleString('en-IN', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }) : 'never';

/**
 * The dealer's accounting ERP, connected.
 *
 * Claims are still raised and approved here. With "ERP pays claims" on, the
 * cashier pays approved claims from the ERP's cash book, which posts the
 * expense and marks the claim paid here — so this app's "Mark Paid" button goes
 * away and a claim can never be paid twice. The key shown on connecting is the
 * ERP's credential: it is shown once, and rotating or switching the connection
 * off stops the ERP on its next call.
 */
export default function IntegrationsPage() {
  const [connections, setConnections] = useState<Connection[] | null>(null);
  const [events, setEvents] = useState<EventRow[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [handover, setHandover] = useState<Handover | null>(null);
  const [showForm, setShowForm] = useState(false);

  const load = useCallback(async () => {
    try {
      const res = await api<{ clients: Connection[]; events: EventRow[] }>('/admin/integrations');
      setConnections(res.clients);
      setEvents(res.events);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not load the connections');
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  async function run(id: string, work: () => Promise<void>) {
    setBusyId(id);
    setError(null);
    setNotice(null);
    try {
      await work();
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'That did not work');
    } finally {
      setBusyId(null);
    }
  }

  const update = (c: Connection, body: Partial<Pick<Connection, 'webhookUrl' | 'paysClaims' | 'isActive'>>) =>
    run(c.id, async () => {
      await api(`/admin/integrations/${c.id}`, { method: 'PATCH', body: JSON.stringify(body) });
    });

  const rotate = (c: Connection) => {
    if (!confirm(`Replace the key for ${c.name}?\n\nThe old key and webhook secret stop working at once. Paste the new ones into the ERP.`)) return;
    void run(c.id, async () => {
      const res = await api<{ token: string; webhookSecret: string }>(`/admin/integrations/${c.id}/rotate`, { method: 'POST' });
      setHandover({ name: c.name, token: res.token, webhookSecret: res.webhookSecret });
    });
  };

  const ping = (c: Connection) =>
    run(c.id, async () => {
      const res = await api<{ ok: boolean; error?: string }>(`/admin/integrations/${c.id}/ping`, { method: 'POST' });
      if (res.ok) setNotice(`${c.name} answered the test.`);
      else throw new Error(`${c.name} did not answer: ${res.error ?? 'no reply'}`);
    });

  const retry = () =>
    run('deliver', async () => {
      const res = await api<{ delivered: number }>('/admin/integrations/deliver', { method: 'POST' });
      setNotice(`${res.delivered} waiting update(s) delivered.`);
    });

  return (
    <div className="space-y-6">
      <PageHero title="Accounting ERP" subtitle="Approved claims go to the ERP to be paid and booked; the ERP marks them paid here.">
        <button
          onClick={() => { setShowForm((v) => !v); setHandover(null); }}
          className="flex h-11 items-center gap-2 rounded-xl bg-white px-4 text-sm font-semibold text-brand-600"
        >
          <Plus className="h-4 w-4" /> Connect
        </button>
      </PageHero>

      {error && <p className="rounded-xl bg-destructive/10 p-3 text-sm text-destructive">{error}</p>}
      {notice && <p className="rounded-xl bg-emerald-50 p-3 text-sm text-emerald-800">{notice}</p>}

      {handover && <KeyHandover handover={handover} onDone={() => setHandover(null)} />}

      {showForm && !handover && (
        <NewConnectionForm
          onCancel={() => setShowForm(false)}
          onCreated={(h) => { setHandover(h); setShowForm(false); void load(); }}
        />
      )}

      {connections === null ? (
        <div className="flex items-center gap-2 text-sm text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin" /> Loading…</div>
      ) : connections.length === 0 ? (
        <div className="rounded-2xl border border-border bg-card p-10 text-center">
          <Link2 className="mx-auto h-8 w-8 text-muted-foreground" />
          <h2 className="mt-3 font-semibold">Not connected</h2>
          <p className="mx-auto mt-1 max-w-md text-sm text-muted-foreground">
            Connect the accounting ERP to have approved claims paid from its cash book and booked to their expense
            heads. Until then, claims are paid here as today.
          </p>
        </div>
      ) : (
        <ul className="grid gap-4">
          {connections.map((c) => (
            <li key={c.id} className={`rounded-2xl border border-border bg-card p-5 ${c.isActive ? '' : 'opacity-60'}`}>
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="font-bold">{c.name}</div>
                  <div className="text-xs text-muted-foreground">Last call {when(c.lastUsedAt)} · connected {when(c.createdAt)}</div>
                </div>
                <span className={`rounded-full px-2 py-0.5 text-xs font-semibold ${c.isActive ? 'bg-emerald-100 text-emerald-700' : 'bg-slate-200 text-slate-600'}`}>
                  {c.isActive ? 'On' : 'Off'}
                </span>
              </div>

              <WebhookField connection={c} onSave={(url) => update(c, { webhookUrl: url || null })} />

              <label className="mt-3 flex items-center gap-2 text-sm">
                <input type="checkbox" checked={c.paysClaims} disabled={busyId === c.id}
                  onChange={(e) => update(c, { paysClaims: e.target.checked })} />
                The ERP pays approved claims (the “Mark Paid” button here is removed)
              </label>

              <div className="mt-4 flex flex-wrap gap-2">
                {busyId === c.id ? (
                  <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
                ) : (
                  <>
                    <button onClick={() => ping(c)} disabled={!c.webhookUrl} className="inline-flex items-center gap-1.5 rounded-lg border border-border px-3 py-1.5 text-xs font-medium hover:bg-muted disabled:opacity-50">
                      <Send className="h-3.5 w-3.5" /> Send a test
                    </button>
                    <button onClick={() => rotate(c)} className="inline-flex items-center gap-1.5 rounded-lg border border-border px-3 py-1.5 text-xs font-medium hover:bg-muted">
                      <RotateCcw className="h-3.5 w-3.5" /> New key
                    </button>
                    <button onClick={() => update(c, { isActive: !c.isActive })} className="rounded-lg border border-border px-3 py-1.5 text-xs font-medium hover:bg-muted">
                      {c.isActive ? 'Switch off' : 'Switch on'}
                    </button>
                  </>
                )}
              </div>
            </li>
          ))}
        </ul>
      )}

      {events.length > 0 && (
        <div className="rounded-2xl border border-border bg-card p-5">
          <div className="mb-3 flex items-center justify-between">
            <h2 className="font-semibold">Updates sent to the ERP</h2>
            <button onClick={retry} disabled={busyId === 'deliver'} className="inline-flex items-center gap-1.5 rounded-lg border border-border px-3 py-1.5 text-xs font-medium hover:bg-muted disabled:opacity-50">
              {busyId === 'deliver' ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RotateCcw className="h-3.5 w-3.5" />} Retry waiting
            </button>
          </div>
          <table className="w-full text-sm">
            <thead className="text-left text-xs text-muted-foreground">
              <tr><th className="py-1">When</th><th>Update</th><th>Status</th><th>Tries</th><th>Problem</th></tr>
            </thead>
            <tbody>
              {events.map((e) => (
                <tr key={e.id} className="border-t border-border">
                  <td className="py-1.5">{when(e.createdAt)}</td>
                  <td>{e.type === 'claim.approved' ? 'Claim approved' : e.type === 'claim.changed' ? 'Approval taken back' : e.type}</td>
                  <td>
                    <span className={`rounded-full px-2 py-0.5 text-xs font-semibold ${
                      e.status === 'DELIVERED' ? 'bg-emerald-100 text-emerald-700' : e.status === 'FAILED' ? 'bg-rose-100 text-rose-700' : 'bg-amber-100 text-amber-800'
                    }`}>{e.status === 'DELIVERED' ? 'Delivered' : e.status === 'FAILED' ? 'Gave up' : 'Waiting'}</span>
                  </td>
                  <td>{e.attempts}</td>
                  <td className="max-w-xs truncate text-xs text-muted-foreground" title={e.lastError ?? ''}>{e.lastError ?? '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <p className="mt-3 text-xs text-muted-foreground">
            An update that does not get through is retried for several hours; the ERP also checks for approved claims
            itself, so nothing is lost if one never arrives.
          </p>
        </div>
      )}
    </div>
  );
}

function WebhookField({ connection, onSave }: { connection: Connection; onSave: (url: string) => void }) {
  const [url, setUrl] = useState(connection.webhookUrl ?? '');
  useEffect(() => setUrl(connection.webhookUrl ?? ''), [connection.webhookUrl]);
  return (
    <div className="mt-4">
      <label className="text-xs font-medium text-muted-foreground" htmlFor={`hook-${connection.id}`}>ERP webhook address</label>
      <div className="mt-1 flex gap-2">
        <input id={`hook-${connection.id}`} value={url} onChange={(e) => setUrl(e.target.value)}
          placeholder="https://your-erp.up.railway.app/api/integrations/hr/webhook"
          className="h-10 flex-1 rounded-xl border border-border bg-background px-3 font-mono text-xs" />
        <button onClick={() => onSave(url.trim())} disabled={url.trim() === (connection.webhookUrl ?? '')}
          className="rounded-xl border border-border px-3 text-xs font-medium hover:bg-muted disabled:opacity-50">Save</button>
      </div>
    </div>
  );
}

function NewConnectionForm({ onCreated, onCancel }: { onCreated: (h: Handover) => void; onCancel: () => void }) {
  const [name, setName] = useState('Accounting ERP');
  const [webhookUrl, setWebhookUrl] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const res = await api<{ token: string; webhookSecret: string }>('/admin/integrations', {
        method: 'POST',
        body: JSON.stringify({ name: name.trim(), ...(webhookUrl.trim() ? { webhookUrl: webhookUrl.trim() } : {}) }),
      });
      onCreated({ name: name.trim(), token: res.token, webhookSecret: res.webhookSecret });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not connect');
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit} className="space-y-3 rounded-2xl border border-border bg-card p-5">
      <h2 className="font-semibold">Connect the accounting ERP</h2>
      <div className="grid gap-3 sm:grid-cols-2">
        <div>
          <label className="text-xs font-medium text-muted-foreground" htmlFor="conn-name">Name</label>
          <input id="conn-name" value={name} onChange={(e) => setName(e.target.value)} className="mt-1 h-10 w-full rounded-xl border border-border bg-background px-3 text-sm" />
        </div>
        <div>
          <label className="text-xs font-medium text-muted-foreground" htmlFor="conn-hook">ERP webhook address</label>
          <input id="conn-hook" value={webhookUrl} onChange={(e) => setWebhookUrl(e.target.value)}
            placeholder="https://…/api/integrations/hr/webhook" className="mt-1 h-10 w-full rounded-xl border border-border bg-background px-3 font-mono text-xs" />
        </div>
      </div>
      {error && <p className="text-sm text-destructive">{error}</p>}
      <div className="flex gap-2">
        <button disabled={busy || name.trim().length < 2} className="flex h-10 items-center gap-2 rounded-xl bg-brand-600 px-4 text-sm font-semibold text-white disabled:opacity-50">
          {busy && <Loader2 className="h-4 w-4 animate-spin" />} Connect
        </button>
        <button type="button" onClick={onCancel} className="h-10 rounded-xl border border-border px-4 text-sm">Cancel</button>
      </div>
    </form>
  );
}

function KeyHandover({ handover, onDone }: { handover: Handover; onDone: () => void }) {
  const [copied, setCopied] = useState<string | null>(null);
  const copy = async (label: string, value: string) => {
    await navigator.clipboard.writeText(value);
    setCopied(label);
  };
  return (
    <div className="space-y-3 rounded-2xl border border-amber-500/40 bg-amber-50 p-5 text-amber-950">
      <p className="flex items-start gap-2 text-sm">
        <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
        <span>
          <strong>Copy these into the ERP now</strong> ({handover.name}: <span className="font-mono">HR_API_KEY</span> and{' '}
          <span className="font-mono">HR_WEBHOOK_SECRET</span>). They are shown once and cannot be read back — a lost key is
          replaced with “New key”.
        </span>
      </p>
      {([['Key', handover.token], ['Webhook secret', handover.webhookSecret]] as const).map(([label, value]) => (
        <div key={label}>
          <div className="text-xs font-semibold">{label}</div>
          <div className="mt-1 flex gap-2">
            <code className="flex-1 break-all rounded-lg bg-white/70 p-2 text-xs">{value}</code>
            <button onClick={() => copy(label, value)} className="flex h-9 items-center gap-1 rounded-lg border border-amber-600/30 px-3 text-xs font-medium">
              {copied === label ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />} Copy
            </button>
          </div>
        </div>
      ))}
      <button onClick={onDone} className="h-9 rounded-lg bg-amber-900 px-4 text-xs font-semibold text-white">I have copied both</button>
    </div>
  );
}
