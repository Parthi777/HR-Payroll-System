'use client';

import { useCallback, useEffect, useState } from 'react';
import { useParams } from 'next/navigation';
import Link from 'next/link';
import {
  ArrowLeft, Check, Copy, KeyRound, Loader2, Pause, Pencil, Play, Plus, ShieldOff, UserPlus,
} from 'lucide-react';
import {
  DEALER_ROLES, platformApi, suggestPassword,
  type AuditEntry, type AuditPage, type Dealer, type DealerAdmin, type DealerInsights, type DealerStorage,
  type NewDealerAdmin,
} from '@/lib/platform-api';
import { describeActivity, exactTime } from '@/lib/platform-activity';
import { DealerMonitor } from '@/components/platform/dealer-monitor';
import { StatusDialog } from '@/components/platform/status-dialog';
import { timeAgo } from '@/components/motion';

interface DealerDetail {
  tenant: Dealer & { updatedAt: string };
  admins: DealerAdmin[];
  employees: number;
  storage: DealerStorage;
}

const ROLE_LABEL = Object.fromEntries(DEALER_ROLES.map((r) => [r.value, r.label]));

/** Credentials to hand over: a new login, or a new password for an existing one. */
type Issued = NewDealerAdmin & { password: string; loginUrl: string; reset?: boolean };

export default function DealerDetailPage() {
  const { id } = useParams<{ id: string }>();
  const [data, setData] = useState<DealerDetail | null>(null);
  const [audit, setAudit] = useState<AuditEntry[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [addingAdmin, setAddingAdmin] = useState(false);
  const [issued, setIssued] = useState<Issued | null>(null);
  const [busyAdmin, setBusyAdmin] = useState<string | null>(null);
  const [insights, setInsights] = useState<DealerInsights | null>(null);
  const [changingStatus, setChangingStatus] = useState(false);

  const load = useCallback(async () => {
    try {
      const [detail, log] = await Promise.all([
        platformApi.get<DealerDetail>(`/tenants/${id}`),
        platformApi.get<AuditPage>(`/audit?tenantId=${id}`),
      ]);
      setData(detail);
      setAudit(log.entries);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not load this dealer');
    }
  }, [id]);

  useEffect(() => { void load(); }, [load]);

  // Monitoring loads on its own: a slow or failed chart query must not hide the
  // admin logins, which are what someone usually comes here to change.
  useEffect(() => {
    platformApi.get<DealerInsights>(`/tenants/${id}/insights`).then(setInsights).catch(() => setInsights(null));
  }, [id]);

  /**
   * A new password for a dealer login that cannot sign in, shown once. For the
   * admin with nobody at the dealer to reset it for them — including one who
   * only ever signed in with Google, which no longer exists.
   */
  async function resetPassword(admin: DealerAdmin) {
    if (!data) return;
    if (!confirm(
      `Give ${admin.name} (${admin.email}) a new password? Their current one stops working at once. You'll see the new one once, to hand over.`,
    )) return;
    const password = suggestPassword();
    setBusyAdmin(admin.id);
    try {
      await platformApi.patch(`/tenants/${id}/admins/${admin.id}/password`, { password });
      setAddingAdmin(false);
      setIssued({ ...admin, password, loginUrl: data.tenant.loginUrl, reset: true });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not reset this password');
    } finally {
      setBusyAdmin(null);
    }
  }

  async function resetTwoStep(admin: DealerAdmin) {
    if (!confirm(
      `Reset two-step for ${admin.name}? Their authenticator and recovery codes stop working; they set it up again with a new phone at their next sign-in.`,
    )) return;
    setBusyAdmin(admin.id);
    try {
      await platformApi.del(`/tenants/${id}/admins/${admin.id}/two-step`);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not reset two-step');
    } finally {
      setBusyAdmin(null);
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

  const { tenant, admins, employees, storage } = data;
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
              onClick={() => setChangingStatus(true)}
              className={`inline-flex items-center gap-1.5 rounded-xl border px-3 py-2 text-sm font-medium transition ${
                active ? 'border-border hover:border-amber-300 hover:bg-amber-50 hover:text-amber-800' : 'border-emerald-300 bg-emerald-50 text-emerald-800 hover:bg-emerald-100'
              }`}
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

      {/* ── monitor ── */}
      <section className="space-y-3">
        <div>
          <h2 className="text-lg font-semibold">Monitor</h2>
          <p className="text-sm text-muted-foreground">
            Activity, billing and health at {tenant.name}. Counts only — never their people&rsquo;s names or pay.
          </p>
        </div>
        <DealerMonitor insights={insights} />
      </section>

      <StatusDialog
        target={changingStatus ? {
          id: tenant.id, name: tenant.name, slug: tenant.slug, status: tenant.status,
          staff: employees, admins: admins.filter((a) => a.isActive).length,
        } : null}
        onClose={() => setChangingStatus(false)}
        onChanged={() => void load()}
      />

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
          <table className="w-full min-w-[860px] text-sm">
            <thead className="bg-muted/50 text-left text-xs uppercase text-muted-foreground">
              <tr>
                <th className="px-4 py-3">Name</th>
                <th className="px-4 py-3">Email</th>
                <th className="px-4 py-3">Role</th>
                <th className="px-4 py-3">Status</th>
                <th className="px-4 py-3">Two-step</th>
                <th className="px-4 py-3">Last sign-in</th>
                <th className="px-4 py-3 text-right">Can&rsquo;t sign in?</th>
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
                  <td className="px-4 py-3">
                    <span className={a.totpEnabledAt ? 'text-emerald-600' : 'text-muted-foreground'}>
                      {a.totpEnabledAt ? 'Set up' : 'At next sign-in'}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-muted-foreground">
                    {timeAgo(insights?.admins.find((x) => x.id === a.id)?.lastSignInAt)}
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex justify-end gap-2">
                      <button
                        onClick={() => resetPassword(a)}
                        disabled={busyAdmin === a.id}
                        className="inline-flex items-center gap-1.5 whitespace-nowrap rounded-lg border border-border px-2.5 py-1.5 text-xs font-medium hover:bg-muted disabled:opacity-60"
                      >
                        <KeyRound className="h-3.5 w-3.5" /> New password
                      </button>
                      {a.totpEnabledAt && (
                        <button
                          onClick={() => resetTwoStep(a)}
                          disabled={busyAdmin === a.id}
                          className="inline-flex items-center gap-1.5 whitespace-nowrap rounded-lg border border-border px-2.5 py-1.5 text-xs font-medium hover:bg-muted disabled:opacity-60"
                        >
                          <ShieldOff className="h-3.5 w-3.5" /> Reset two-step
                        </button>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      {/* ── file storage ── */}
      <StorageSection
        dealerName={tenant.name}
        storage={storage}
        onSave={async (body) => {
          await platformApi.patch(`/tenants/${id}/storage`, body);
          await load();
        }}
      />

      {/* ── activity ── */}
      <section className="space-y-3">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h2 className="text-lg font-semibold">Activity</h2>
            <p className="text-sm text-muted-foreground">
              Platform actions taken on this dealer. Their own staff&rsquo;s activity lives in their
              workspace, not here.
            </p>
          </div>
          <Link
            href={`/platform/activity?tenantId=${id}`}
            className="whitespace-nowrap text-sm text-muted-foreground underline-offset-4 hover:text-foreground hover:underline"
          >
            Open in the activity log
          </Link>
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
            {audit.map((e) => {
              const { title, detail } = describeActivity(e);
              return (
                <li key={e.id} className="flex flex-wrap items-baseline gap-x-3 gap-y-1 border-b border-border px-4 py-3 text-sm last:border-b-0">
                  <span className="font-medium">{title}</span>
                  {detail && <span className="text-muted-foreground">{detail}</span>}
                  <span className="ml-auto whitespace-nowrap text-xs text-muted-foreground">
                    {e.actorName} · {exactTime(e.timestamp)}
                  </span>
                </li>
              );
            })}
          </ol>
        )}
      </section>
    </div>
  );
}

/**
 * Where this dealer's claim files go.
 *
 * Set here and nowhere else. A Drive folder id is a capability — anyone holding
 * it can read everything inside — so a dealer that could edit its own would
 * simply enter a rival's and collect their receipts. Platform staff set it, the
 * server refuses a folder another dealer already uses, and the change is
 * recorded in the activity log.
 */
function StorageSection({
  dealerName,
  storage,
  onSave,
}: {
  dealerName: string;
  storage: DealerStorage;
  onSave: (body: { driveParentFolderId: string | null; driveShareWith: string | null }) => Promise<void>;
}) {
  const [editing, setEditing] = useState(false);
  const [folder, setFolder] = useState(storage.driveParentFolderId ?? '');
  const [shareWith, setShareWith] = useState(storage.driveShareWith ?? '');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function open() {
    setFolder(storage.driveParentFolderId ?? '');
    setShareWith(storage.driveShareWith ?? '');
    setError(null);
    setEditing(true);
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await onSave({ driveParentFolderId: folder.trim() || null, driveShareWith: shareWith.trim() || null });
      setEditing(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not save these settings');
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold">Claim file storage</h2>
          <p className="text-sm text-muted-foreground">
            Where {dealerName}&rsquo;s receipts and bills are kept. Every dealer needs a folder of its
            own — two dealers sharing one would file their receipts together.
          </p>
        </div>
        {!editing && (
          <button
            onClick={open}
            className="inline-flex items-center gap-1.5 rounded-xl border border-border px-3 py-2 text-sm font-medium hover:bg-muted"
          >
            <Pencil className="h-4 w-4" /> Change
          </button>
        )}
      </div>

      {editing ? (
        <form onSubmit={submit} className="space-y-4 rounded-2xl border border-border bg-card p-5">
          <div className="space-y-1.5">
            <label htmlFor="drive-folder" className="text-sm font-medium">Google Drive folder</label>
            <input
              id="drive-folder"
              value={folder}
              onChange={(e) => setFolder(e.target.value)}
              placeholder="Paste the folder link, or its id"
              className="w-full rounded-xl border border-border bg-background px-3 py-2 font-mono text-sm"
            />
            <p className="text-xs text-muted-foreground">
              Open the folder in Drive and paste the address — the id is taken from it. Leave this
              empty and {dealerName}&rsquo;s claim files go to S3 instead, which works but is not
              browsable.
            </p>
          </div>

          <div className="space-y-1.5">
            <label htmlFor="drive-share" className="text-sm font-medium">Share new folders with</label>
            <input
              id="drive-share"
              type="email"
              value={shareWith}
              onChange={(e) => setShareWith(e.target.value)}
              placeholder="hr@dealer.example"
              className="w-full rounded-xl border border-border bg-background px-3 py-2 text-sm"
            />
            <p className="text-xs text-muted-foreground">
              Each employee folder is shared with this address as it is created, so it appears in
              that person&rsquo;s &ldquo;Shared with me&rdquo;. Use {dealerName}&rsquo;s own HR admin, never
              another dealer&rsquo;s. Folders that already exist are not changed.
            </p>
          </div>

          {error && <p className="rounded-xl bg-destructive/10 p-3 text-sm text-destructive">{error}</p>}

          <div className="flex gap-2">
            <button
              type="submit"
              disabled={busy}
              className="inline-flex items-center gap-2 rounded-xl bg-slate-900 px-4 py-2.5 text-sm font-semibold text-white disabled:opacity-60"
            >
              {busy && <Loader2 className="h-4 w-4 animate-spin" />} Save
            </button>
            <button
              type="button"
              onClick={() => setEditing(false)}
              className="rounded-xl border border-border px-4 py-2.5 text-sm font-medium hover:bg-muted"
            >
              Cancel
            </button>
          </div>
        </form>
      ) : (
        <dl className="grid gap-4 rounded-2xl border border-border bg-card p-5 sm:grid-cols-2">
          <StorageRow
            label="Drive folder"
            value={storage.driveParentFolderId}
            empty="Not set — claim files go to S3"
            mono
          />
          <StorageRow
            label="New folders shared with"
            value={storage.driveShareWith}
            empty="Nobody"
          />
          {/* Fixed at onboarding: changing either would strand this dealer's
              existing selfies or require re-enrolling every face. */}
          <StorageRow label="Selfie storage" value={storage.s3Prefix || 'bucket root'} mono readOnly />
          <StorageRow label="Face collection" value={storage.rekognitionCollectionId} empty="Platform default" mono readOnly />
        </dl>
      )}
    </section>
  );
}

function StorageRow({
  label, value, empty, mono, readOnly,
}: {
  label: string;
  value: string | null;
  empty?: string;
  mono?: boolean;
  readOnly?: boolean;
}) {
  return (
    <div className="min-w-0">
      <dt className="flex items-center gap-1.5 text-xs uppercase tracking-wide text-muted-foreground">
        {label}
        {readOnly && <span className="normal-case tracking-normal">(set at onboarding)</span>}
      </dt>
      <dd className={`mt-0.5 truncate text-sm ${mono ? 'font-mono text-[13px]' : ''} ${value ? '' : 'text-muted-foreground'}`}>
        {value || empty || '—'}
      </dd>
    </div>
  );
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
  issued: Issued;
  onDone: () => void;
}) {
  const [copied, setCopied] = useState(false);
  const summary = `Sign in: ${issued.loginUrl}\nEmail: ${issued.email}\nPassword: ${issued.password}`;

  return (
    <div className="space-y-4 rounded-2xl border-2 border-emerald-500/40 bg-emerald-50/50 p-6">
      <div>
        <h3 className="font-semibold text-emerald-900">{issued.reset ? 'New password issued' : 'Login created'}</h3>
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
