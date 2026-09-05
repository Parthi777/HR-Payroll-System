'use client';

import { useCallback, useEffect, useState } from 'react';
import { useParams } from 'next/navigation';
import Link from 'next/link';
import {
  ArrowLeft, Check, Copy, Loader2, Pause, Pencil, Play, Plus, UserPlus,
} from 'lucide-react';
import {
  DEALER_ROLES, platformApi, suggestPassword,
  type AuditEntry, type Dealer, type DealerAdmin, type NewDealerAdmin,
} from '@/lib/platform-api';

interface DealerDetail {
  tenant: Dealer & { updatedAt: string };
  admins: DealerAdmin[];
  employees: number;
}

const ROLE_LABEL = Object.fromEntries(DEALER_ROLES.map((r) => [r.value, r.label]));

/** "TENANT_ADMIN_CREATED" → "Admin created" — the log reads as English, not constants. */
function actionLabel(action: string): string {
  const words = action.replace(/^TENANT_/, '').replace(/_/g, ' ').toLowerCase();
  return words.charAt(0).toUpperCase() + words.slice(1);
}

export default function DealerDetailPage() {
  const { id } = useParams<{ id: string }>();
  const [data, setData] = useState<DealerDetail | null>(null);
  const [audit, setAudit] = useState<AuditEntry[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [addingAdmin, setAddingAdmin] = useState(false);
  const [issued, setIssued] = useState<(NewDealerAdmin & { password: string; loginUrl: string }) | null>(null);

  const load = useCallback(async () => {
    try {
      const [detail, log] = await Promise.all([
        platformApi.get<DealerDetail>(`/tenants/${id}`),
        platformApi.get<{ entries: AuditEntry[] }>(`/audit?tenantId=${id}`),
      ]);
      setData(detail);
      setAudit(log.entries);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not load this dealer');
    }
  }, [id]);

  useEffect(() => { void load(); }, [load]);

  async function setStatus(status: 'ACTIVE' | 'SUSPENDED') {
    if (!data) return;
    const suspending = status === 'SUSPENDED';
    if (!confirm(
      suspending
        ? `Suspend ${data.tenant.name}? Everyone signed in there is signed out on their next request, and nobody can sign back in until you resume it.`
        : `Resume ${data.tenant.name}? Their people can sign in again straight away.`,
    )) return;
    try {
      await platformApi.patch(`/tenants/${id}/status`, { status });
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not change status');
    }
  }

  if (error) {
    return (
      <div className="space-y-4">
        <BackLink />
        <p className="rounded-xl bg-destructive/10 p-4 text-sm text-destructive">{error}</p>
      </div>
    );
  }

  if (!data) {
    return (
      <div className="flex items-center gap-2 text-sm text-muted-foreground">
        <Loader2 className="h-4 w-4 animate-spin" /> Loading dealer…
      </div>
    );
  }

  const { tenant, admins, employees } = data;
  const active = tenant.status === 'ACTIVE';

  return (
    <div className="space-y-6">
      <BackLink />

      {/* ── identity ── */}
      <div className="rounded-2xl border border-border bg-card p-6">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-3">
              <h1 className="text-2xl font-bold">{tenant.name}</h1>
              <StatusPill active={active} />
            </div>
            <p className="mt-1 text-sm text-muted-foreground">
              <code className="rounded bg-muted px-1.5 py-0.5 text-xs">{tenant.slug}</code>
              <span className="mx-2">·</span>
              Added {new Date(tenant.createdAt).toLocaleDateString()}
            </p>
          </div>

          <div className="flex gap-2">
            <RenameButton
              current={tenant.name}
              onRename={async (name) => { await platformApi.patch(`/tenants/${id}`, { name }); await load(); }}
            />
            <button
              onClick={() => setStatus(active ? 'SUSPENDED' : 'ACTIVE')}
              className="inline-flex items-center gap-1.5 rounded-xl border border-border px-3 py-2 text-sm font-medium hover:bg-muted"
            >
              {active ? <Pause className="h-4 w-4" /> : <Play className="h-4 w-4" />}
              {active ? 'Suspend' : 'Resume'}
            </button>
          </div>
        </div>

        <dl className="mt-5 grid gap-4 border-t border-border pt-5 sm:grid-cols-3">
          <Stat label="Staff" value={String(employees)} />
          <Stat label="Admin logins" value={String(admins.length)} />
          <CopyStat label="Sign in at" value={tenant.loginUrl} />
        </dl>
      </div>

      {/* ── admin accounts ── */}
      <section className="space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="text-lg font-semibold">Admin logins</h2>
            <p className="text-sm text-muted-foreground">
              Who at {tenant.name} can sign in to their workspace.
            </p>
          </div>
          <button
            onClick={() => { setAddingAdmin((v) => !v); setIssued(null); }}
            className="flex items-center gap-2 rounded-xl bg-slate-900 px-4 py-2.5 text-sm font-semibold text-white"
          >
            <UserPlus className="h-4 w-4" /> Add login
          </button>
        </div>

        {issued && (
          <CredentialsHandover
            issued={issued}
            onDone={() => { setIssued(null); void load(); }}
          />
        )}

        {addingAdmin && !issued && (
          <AddAdminForm
            dealerName={tenant.name}
            onCancel={() => setAddingAdmin(false)}
            onCreated={(a) => { setIssued(a); setAddingAdmin(false); }}
            create={(body) => platformApi.post<{ admin: NewDealerAdmin; loginUrl: string }>(`/tenants/${id}/admins`, body)}
          />
        )}

        <div className="overflow-x-auto rounded-2xl border border-border bg-card">
          <table className="w-full min-w-[520px] text-sm">
            <thead className="bg-muted/50 text-left text-xs uppercase text-muted-foreground">
              <tr>
                <th className="px-4 py-3">Name</th>
                <th className="px-4 py-3">Email</th>
                <th className="px-4 py-3">Role</th>
                <th className="px-4 py-3">Status</th>
              </tr>
            </thead>
            <tbody>
              {admins.map((a) => (
                <tr key={a.id} className="border-t border-border">
                  <td className="px-4 py-3 font-medium">{a.name}</td>
                  <td className="px-4 py-3 text-muted-foreground">{a.email}</td>
                  <td className="px-4 py-3">{ROLE_LABEL[a.role] ?? a.role}</td>
                  <td className="px-4 py-3">
                    <span className={a.isActive ? 'text-emerald-600' : 'text-muted-foreground'}>
                      {a.isActive ? 'Active' : 'Disabled'}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      {/* ── activity ── */}
      <section className="space-y-3">
        <div>
          <h2 className="text-lg font-semibold">Activity</h2>
          <p className="text-sm text-muted-foreground">
            Platform actions taken on this dealer. Their own staff's activity lives in their
            workspace, not here.
          </p>
        </div>

        {audit === null ? (
          <p className="text-sm text-muted-foreground">Loading…</p>
        ) : audit.length === 0 ? (
          <div className="rounded-2xl border border-dashed border-border p-6 text-sm text-muted-foreground">
            Nothing recorded yet. Dealers created before the console existed have no history —
            entries appear from the next change you make here.
          </div>
        ) : (
          <ol className="overflow-hidden rounded-2xl border border-border bg-card">
            {audit.map((e) => (
              <li key={e.id} className="flex flex-wrap items-baseline gap-x-3 gap-y-1 border-b border-border px-4 py-3 text-sm last:border-b-0">
                <span className="font-medium">{actionLabel(e.action)}</span>
                {e.metadata && <span className="text-muted-foreground">{summarise(e.metadata)}</span>}
                <span className="ml-auto whitespace-nowrap text-xs text-muted-foreground">
                  {new Date(e.timestamp).toLocaleString()}
                </span>
              </li>
            ))}
          </ol>
        )}
      </section>
    </div>
  );
}

/** Metadata is stored as JSON; show its values, never its field names. */
function summarise(metadata: string): string {
  try {
    const parsed = JSON.parse(metadata) as Record<string, unknown>;
    return Object.values(parsed).filter((v) => typeof v === 'string' || typeof v === 'number').join(' · ');
  } catch {
    return '';
  }
}

function BackLink() {
  return (
    <Link href="/platform" className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground">
      <ArrowLeft className="h-4 w-4" /> All dealers
    </Link>
  );
}

function StatusPill({ active }: { active: boolean }) {
  return (
    <span className={`rounded-full px-2.5 py-0.5 text-xs font-medium ${
      active ? 'bg-emerald-100 text-emerald-700' : 'bg-amber-100 text-amber-700'
    }`}>
      {active ? 'Active' : 'Suspended'}
    </span>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="text-xs uppercase tracking-wide text-muted-foreground">{label}</dt>
      <dd className="mt-0.5 text-lg font-semibold tabular-nums">{value}</dd>
    </div>
  );
}

function CopyStat({ label, value }: { label: string; value: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <div className="min-w-0">
      <dt className="text-xs uppercase tracking-wide text-muted-foreground">{label}</dt>
      <dd className="mt-0.5 flex items-center gap-2">
        <span className="truncate font-mono text-[13px]">{value}</span>
        <button
          onClick={async () => {
            await navigator.clipboard.writeText(value);
            setCopied(true);
            setTimeout(() => setCopied(false), 2000);
          }}
          className="shrink-0 rounded-md border border-border p-1 hover:bg-muted"
          title="Copy sign-in link"
        >
          {copied ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
        </button>
      </dd>
    </div>
  );
}

function RenameButton({ current, onRename }: { current: string; onRename: (name: string) => Promise<void> }) {
  const [busy, setBusy] = useState(false);
  return (
    <button
      disabled={busy}
      onClick={async () => {
        // The address stays fixed — it is in their URL and their stored file paths.
        const name = prompt('New name for this dealer? Their workspace address does not change.', current);
        if (!name || name.trim() === current) return;
        setBusy(true);
        try { await onRename(name.trim()); } finally { setBusy(false); }
      }}
      className="inline-flex items-center gap-1.5 rounded-xl border border-border px-3 py-2 text-sm font-medium hover:bg-muted disabled:opacity-60"
    >
      <Pencil className="h-4 w-4" /> Rename
    </button>
  );
}

function AddAdminForm({
  dealerName,
  create,
  onCreated,
  onCancel,
}: {
  dealerName: string;
  create: (body: { name: string; email: string; password: string; role: string }) => Promise<{ admin: NewDealerAdmin; loginUrl: string }>;
  onCreated: (a: NewDealerAdmin & { password: string; loginUrl: string }) => void;
  onCancel: () => void;
}) {
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [role, setRole] = useState<string>('HR_MANAGER');
  const [password, setPassword] = useState(suggestPassword);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const hint = DEALER_ROLES.find((r) => r.value === role)?.hint;

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const res = await create({ name, email, password, role });
      onCreated({ ...res.admin, password, loginUrl: res.loginUrl });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not create this login');
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit} className="space-y-4 rounded-2xl border border-border bg-card p-6">
      <h3 className="font-semibold">New login for {dealerName}</h3>

      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Name">
          <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Priya Raman" className={inputClass} required />
        </Field>
        <Field label="Email" hint="What they sign in with">
          <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="priya@abcmotors.com" className={inputClass} required />
        </Field>
        <Field label="Role" hint={hint}>
          <select value={role} onChange={(e) => setRole(e.target.value)} className={inputClass}>
            {DEALER_ROLES.map((r) => <option key={r.value} value={r.value}>{r.label}</option>)}
          </select>
        </Field>
        <Field label="Temporary password" hint="At least 12 characters. Shown once.">
          <div className="flex gap-2">
            <input value={password} onChange={(e) => setPassword(e.target.value)} minLength={12} className={inputClass} required />
            <button type="button" onClick={() => setPassword(suggestPassword())} className="whitespace-nowrap rounded-xl border border-border px-3 text-sm">
              New
            </button>
          </div>
        </Field>
      </div>

      {error && <p className="text-sm text-destructive">{error}</p>}

      <div className="flex gap-2">
        <button type="submit" disabled={busy} className="flex items-center gap-2 rounded-xl bg-slate-900 px-4 py-2.5 text-sm font-semibold text-white disabled:opacity-60">
          <Plus className="h-4 w-4" /> {busy ? 'Creating…' : 'Create login'}
        </button>
        <button type="button" onClick={onCancel} className="rounded-xl border border-border px-4 py-2.5 text-sm">Cancel</button>
      </div>
    </form>
  );
}

/**
 * Shown once, and says so.
 *
 * The password is hashed the moment it is saved, so this screen is the only
 * place it will ever exist. Better to state that plainly than to let someone
 * discover it when they go looking for it later.
 */
function CredentialsHandover({
  issued,
  onDone,
}: {
  issued: NewDealerAdmin & { password: string; loginUrl: string };
  onDone: () => void;
}) {
  const [copied, setCopied] = useState(false);
  const summary = `Sign in: ${issued.loginUrl}\nEmail: ${issued.email}\nPassword: ${issued.password}`;

  return (
    <div className="space-y-4 rounded-2xl border-2 border-emerald-500/40 bg-emerald-50/50 p-6">
      <div>
        <h3 className="font-semibold text-emerald-900">Login created</h3>
        <p className="text-sm text-emerald-800">
          Hand these over now. <strong>The password is not stored anywhere</strong> — after you
          leave this screen it can only be reset, not shown again.
        </p>
      </div>

      <dl className="grid gap-2 rounded-xl bg-white p-4 text-sm">
        <Row label="Sign in at" value={issued.loginUrl} />
        <Row label="Email" value={issued.email} />
        <Row label="Password" value={issued.password} />
        <Row label="Role" value={ROLE_LABEL[issued.role] ?? issued.role} plain />
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

function Row({ label, value, plain }: { label: string; value: string; plain?: boolean }) {
  return (
    <div className="flex flex-wrap items-baseline gap-2">
      <dt className="w-24 shrink-0 text-muted-foreground">{label}</dt>
      <dd className={plain ? '' : 'break-all font-mono text-[13px]'}>{value}</dd>
    </div>
  );
}
