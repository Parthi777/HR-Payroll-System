'use client';

import { useCallback, useEffect, useState } from 'react';
import { Building2, Check, Copy, Loader2, Pause, Play, Plus } from 'lucide-react';
import { platformApi, suggestPassword, type CreatedDealer, type Dealer } from '@/lib/platform-api';
import Link from 'next/link';

/** "ABC Motors" → "abc-motors", the subdomain it will live at. */
function slugify(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 31);
}

export default function PlatformDealersPage() {
  const [dealers, setDealers] = useState<Dealer[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [created, setCreated] = useState<(CreatedDealer & { password: string }) | null>(null);

  const load = useCallback(async () => {
    try {
      const res = await platformApi.get<{ tenants: Dealer[] }>('/tenants');
      setDealers(res.tenants);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not load dealers');
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  async function setStatus(d: Dealer, status: 'ACTIVE' | 'SUSPENDED') {
    const verb = status === 'SUSPENDED' ? 'Suspend' : 'Resume';
    // Suspension logs every one of their people out on their next request.
    if (!confirm(`${verb} ${d.name}? ${status === 'SUSPENDED' ? 'Everyone signed in there will be signed out immediately.' : ''}`)) return;
    try {
      await platformApi.patch(`/tenants/${d.id}/status`, { status });
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not change status');
    }
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold">Dealers</h1>
          <p className="text-sm text-muted-foreground">
            {dealers ? `${dealers.length} workspace${dealers.length === 1 ? '' : 's'}` : 'Loading…'}
          </p>
        </div>
        <button
          onClick={() => { setShowForm((v) => !v); setCreated(null); }}
          className="flex items-center gap-2 rounded-xl bg-slate-900 px-4 py-2.5 text-sm font-semibold text-white"
        >
          <Plus className="h-4 w-4" /> Add dealer
        </button>
      </div>

      {error && <p className="rounded-xl bg-destructive/10 p-3 text-sm text-destructive">{error}</p>}

      {created && <CredentialsHandover created={created} onDone={() => { setCreated(null); void load(); }} />}

      {showForm && !created && (
        <NewDealerForm
          onCreated={(c) => { setCreated(c); setShowForm(false); }}
          onCancel={() => setShowForm(false)}
        />
      )}

      {dealers === null ? (
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" /> Loading dealers…
        </div>
      ) : dealers.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-border p-10 text-center">
          <Building2 className="mx-auto h-8 w-8 text-muted-foreground" />
          <p className="mt-3 font-medium">No dealers yet</p>
          <p className="text-sm text-muted-foreground">Add your first one to get started.</p>
        </div>
      ) : (
        <div className="overflow-hidden rounded-2xl border border-border bg-card">
          <table className="w-full text-sm">
            <thead className="bg-muted/50 text-left text-xs uppercase text-muted-foreground">
              <tr>
                <th className="px-4 py-3">Dealer</th>
                <th className="px-4 py-3">Address</th>
                <th className="px-4 py-3">Staff</th>
                <th className="px-4 py-3">Status</th>
                <th className="px-4 py-3" />
              </tr>
            </thead>
            <tbody>
              {dealers.map((d) => (
                <tr key={d.id} className="border-t border-border">
                  <td className="px-4 py-3">
                    <Link href={`/platform/dealers/${d.id}`} className="font-medium underline-offset-4 hover:underline">
                      {d.name}
                    </Link>
                  </td>
                  <td className="px-4 py-3">
                    <code className="rounded bg-muted px-1.5 py-0.5 text-xs">{d.slug}</code>
                  </td>
                  <td className="px-4 py-3">{d.employees}</td>
                  <td className="px-4 py-3">
                    <span
                      className={`rounded-full px-2 py-0.5 text-xs font-medium ${
                        d.status === 'ACTIVE'
                          ? 'bg-emerald-100 text-emerald-700'
                          : 'bg-amber-100 text-amber-700'
                      }`}
                    >
                      {d.status === 'ACTIVE' ? 'Active' : 'Suspended'}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-right">
                    <Link
                      href={`/platform/dealers/${d.id}`}
                      className="mr-2 inline-flex items-center rounded-lg border border-border px-3 py-1.5 text-xs font-medium hover:bg-muted"
                    >
                      Manage
                    </Link>
                    <button
                      onClick={() => setStatus(d, d.status === 'ACTIVE' ? 'SUSPENDED' : 'ACTIVE')}
                      className="inline-flex items-center gap-1.5 rounded-lg border border-border px-3 py-1.5 text-xs font-medium hover:bg-muted"
                    >
                      {d.status === 'ACTIVE' ? <Pause className="h-3.5 w-3.5" /> : <Play className="h-3.5 w-3.5" />}
                      {d.status === 'ACTIVE' ? 'Suspend' : 'Resume'}
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function NewDealerForm({
  onCreated,
  onCancel,
}: {
  onCreated: (c: CreatedDealer & { password: string }) => void;
  onCancel: () => void;
}) {
  const [name, setName] = useState('');
  const [slug, setSlug] = useState('');
  const [slugEdited, setSlugEdited] = useState(false);
  const [adminName, setAdminName] = useState('');
  const [adminEmail, setAdminEmail] = useState('');
  const [password, setPassword] = useState(suggestPassword);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const res = await platformApi.post<{ tenant: CreatedDealer }>('/tenants', {
        slug, name, admin: { name: adminName, email: adminEmail, password },
      });
      onCreated({ ...res.tenant, password });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not create the dealer');
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit} className="space-y-4 rounded-2xl border border-border bg-card p-6">
      <h2 className="font-semibold">New dealer</h2>

      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Dealer name" hint="Printed on their payslips and reports">
          <input
            value={name}
            onChange={(e) => {
              setName(e.target.value);
              if (!slugEdited) setSlug(slugify(e.target.value));
            }}
            placeholder="ABC Motors"
            className={inputClass}
            required
          />
        </Field>

        <Field label="Workspace address" hint="Their subdomain — cannot be changed later">
          <input
            value={slug}
            onChange={(e) => { setSlug(e.target.value); setSlugEdited(true); }}
            placeholder="abc-motors"
            pattern="[a-z0-9][a-z0-9-]{1,30}"
            title="Lowercase letters, digits and hyphens"
            className={inputClass}
            required
          />
        </Field>

        <Field label="Administrator name">
          <input value={adminName} onChange={(e) => setAdminName(e.target.value)} placeholder="Ravi Kumar" className={inputClass} required />
        </Field>

        <Field label="Administrator email" hint="What they sign in with">
          <input type="email" value={adminEmail} onChange={(e) => setAdminEmail(e.target.value)} placeholder="ravi@abcmotors.com" className={inputClass} required />
        </Field>
      </div>

      <Field label="Temporary password" hint="At least 12 characters. Shown once — copy it before closing.">
        <div className="flex gap-2">
          <input value={password} onChange={(e) => setPassword(e.target.value)} minLength={12} className={inputClass} required />
          <button type="button" onClick={() => setPassword(suggestPassword())} className="whitespace-nowrap rounded-xl border border-border px-3 text-sm">
            Regenerate
          </button>
        </div>
      </Field>

      {error && <p className="text-sm text-destructive">{error}</p>}

      <div className="flex gap-2">
        <button type="submit" disabled={busy} className="rounded-xl bg-slate-900 px-4 py-2.5 text-sm font-semibold text-white disabled:opacity-60">
          {busy ? 'Creating…' : 'Create dealer'}
        </button>
        <button type="button" onClick={onCancel} className="rounded-xl border border-border px-4 py-2.5 text-sm">
          Cancel
        </button>
      </div>
    </form>
  );
}

/**
 * The credentials, shown once.
 *
 * The password is hashed the moment it is stored, so this screen is the only
 * place it will ever exist. Saying so plainly matters more than the styling.
 */
function CredentialsHandover({
  created,
  onDone,
}: {
  created: CreatedDealer & { password: string };
  onDone: () => void;
}) {
  const [copied, setCopied] = useState(false);
  const summary = `Workspace: ${created.name}\nSign in: ${created.loginUrl}\nEmail: ${created.adminEmail}\nPassword: ${created.password}`;

  return (
    <div className="space-y-4 rounded-2xl border-2 border-emerald-500/40 bg-emerald-50/50 p-6">
      <div>
        <h2 className="font-semibold text-emerald-900">{created.name} is ready</h2>
        <p className="text-sm text-emerald-800">
          Give these to the dealer. <strong>The password is not stored anywhere</strong> — once you
          leave this screen it cannot be shown again, only reset.
        </p>
      </div>

      <dl className="grid gap-2 rounded-xl bg-white p-4 text-sm">
        <Row label="Sign in at" value={created.loginUrl} mono />
        <Row label="Email" value={created.adminEmail} mono />
        <Row label="Password" value={created.password} mono />
      </dl>

      <div className="flex gap-2">
        <button
          onClick={async () => {
            await navigator.clipboard.writeText(summary);
            setCopied(true);
            setTimeout(() => setCopied(false), 2000);
          }}
          className="flex items-center gap-2 rounded-xl bg-emerald-600 px-4 py-2.5 text-sm font-semibold text-white"
        >
          {copied ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}
          {copied ? 'Copied' : 'Copy details'}
        </button>
        <button onClick={onDone} className="rounded-xl border border-emerald-600/30 px-4 py-2.5 text-sm">
          I have saved these
        </button>
      </div>
    </div>
  );
}

const inputClass =
  'w-full rounded-xl border border-border bg-muted/40 px-3 py-2.5 text-sm outline-none focus:border-primary';

function Field({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="mb-1 block text-sm font-medium">{label}</span>
      {children}
      {hint && <span className="mt-1 block text-xs text-muted-foreground">{hint}</span>}
    </label>
  );
}

function Row({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div className="flex flex-wrap items-baseline gap-2">
      <dt className="w-24 shrink-0 text-muted-foreground">{label}</dt>
      <dd className={mono ? 'break-all font-mono text-[13px]' : ''}>{value}</dd>
    </div>
  );
}
