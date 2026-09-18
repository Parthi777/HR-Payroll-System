'use client';

import { useCallback, useEffect, useState } from 'react';
import { Check, Copy, Loader2, Mail, Phone } from 'lucide-react';
import {
  platformApi,
  suggestPassword,
  type ApprovedSignup,
  type SignupRow,
} from '@/lib/platform-api';

const STATUSES = ['PENDING', 'APPROVED', 'REJECTED'] as const;
type Status = (typeof STATUSES)[number];

const rupees = (paise: number) => `₹${(paise / 100).toLocaleString('en-IN')}`;

/**
 * Dealerships that asked to join.
 *
 * Approving one provisions its workspace **suspended** and issues a payment
 * link; paying is what opens it. So the useful thing on this page is not just
 * "approve" — it is knowing which approved dealerships have not paid yet, and
 * being able to record a payment that arrived by bank transfer.
 */
export default function SignupsPage() {
  const [status, setStatus] = useState<Status>('PENDING');
  const [rows, setRows] = useState<SignupRow[] | null>(null);
  const [pending, setPending] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [approving, setApproving] = useState<SignupRow | null>(null);
  /** What was just created, including the password, which exists nowhere else. */
  const [handover, setHandover] = useState<(ApprovedSignup & { company: string; password: string }) | null>(null);

  const load = useCallback(async (which: Status) => {
    setRows(null);
    try {
      const res = await platformApi.get<{ signups: SignupRow[]; pending: number }>(`/signups?status=${which}`);
      setRows(res.signups);
      setPending(res.pending);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not load the signups');
    }
  }, []);

  useEffect(() => { void load(status); }, [load, status]);

  async function reject(row: SignupRow) {
    const reason = prompt(`Why is ${row.companyName} being rejected? They are not told automatically — this is for your own record.`);
    if (!reason?.trim()) return;
    setBusyId(row.id);
    setError(null);
    try {
      await platformApi.patch(`/signups/${row.id}/reject`, { reason: reason.trim() });
      await load(status);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not reject it');
    } finally {
      setBusyId(null);
    }
  }

  async function markPaid(row: SignupRow) {
    if (!row.workspaceId) return;
    if (!confirm(`Record ${row.companyName} as paid?\n\nThis opens their workspace immediately, and the platform log will name you as the person who said the money arrived.`)) return;
    setBusyId(row.id);
    setError(null);
    try {
      await platformApi.patch(`/subscriptions/${row.workspaceId}/mark-paid`, {});
      await load(status);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not record the payment');
    } finally {
      setBusyId(null);
    }
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold">Signups</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            {pending === 0 ? 'Nothing waiting for review.' : `${pending} waiting for review.`}
          </p>
        </div>
        <div className="flex rounded-xl border border-border bg-card p-1">
          {STATUSES.map((s) => (
            <button
              key={s}
              onClick={() => setStatus(s)}
              className={`rounded-lg px-3 py-1.5 text-sm font-medium capitalize ${
                status === s ? 'bg-slate-900 text-white' : 'text-muted-foreground hover:bg-muted'
              }`}
            >
              {s.toLowerCase()}
            </button>
          ))}
        </div>
      </div>

      {error && <p className="rounded-xl bg-destructive/10 p-3 text-sm text-destructive">{error}</p>}

      {handover && <Handover handover={handover} onDone={() => { setHandover(null); void load(status); }} />}

      {approving && (
        <ApproveForm
          row={approving}
          onCancel={() => setApproving(null)}
          onApproved={(result, password) => {
            setApproving(null);
            setHandover({ ...result, company: approving.companyName, password });
          }}
        />
      )}

      {rows === null ? (
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" /> Loading…
        </div>
      ) : rows.length === 0 ? (
        <p className="rounded-2xl border border-border bg-card p-8 text-center text-sm text-muted-foreground">
          Nothing {status.toLowerCase()}.
        </p>
      ) : (
        <ul className="space-y-3">
          {rows.map((row) => (
            <li key={row.id} className="rounded-2xl border border-border bg-card p-5">
              <div className="flex flex-wrap items-start justify-between gap-4">
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="text-base font-bold">{row.companyName}</span>
                    <span className="rounded-full bg-muted px-2 py-0.5 font-mono text-[11px] text-muted-foreground">{row.reference}</span>
                    <span className="rounded-full bg-accent px-2 py-0.5 text-xs font-semibold text-accent-foreground">{row.planCode}</span>
                    {row.subscription && (
                      <span
                        className={`rounded-full px-2 py-0.5 text-xs font-semibold ${
                          row.subscription.status === 'ACTIVE' ? 'bg-emerald-100 text-emerald-700' : 'bg-amber-100 text-amber-800'
                        }`}
                      >
                        {row.subscription.status === 'ACTIVE' ? 'Paid' : `Awaiting ${rupees(row.subscription.amountPaise)}`}
                      </span>
                    )}
                  </div>

                  <div className="mt-2 flex flex-wrap gap-x-5 gap-y-1 text-sm text-muted-foreground">
                    <span className="font-mono">{row.slug}</span>
                    <span>{row.contactName}</span>
                    <span className="inline-flex items-center gap-1.5"><Mail className="h-3.5 w-3.5" />{row.email}</span>
                    <span className="inline-flex items-center gap-1.5"><Phone className="h-3.5 w-3.5" />{row.phone}</span>
                  </div>

                  <div className="mt-1 text-xs text-muted-foreground">
                    {[
                      row.staffCount ? `${row.staffCount} employees` : null,
                      row.branchCount ? `${row.branchCount} branches` : null,
                      `asked ${new Date(row.createdAt).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' })}`,
                    ].filter(Boolean).join(' · ')}
                  </div>

                  {row.note && <p className="mt-3 max-w-2xl rounded-xl bg-muted/60 p-3 text-sm">{row.note}</p>}
                  {row.reviewNote && <p className="mt-3 text-sm text-muted-foreground">Rejected: {row.reviewNote}</p>}
                </div>

                <div className="flex shrink-0 flex-wrap gap-2">
                  {busyId === row.id ? (
                    <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
                  ) : row.status === 'PENDING' ? (
                    <>
                      <button
                        onClick={() => { setHandover(null); setApproving(row); }}
                        className="rounded-lg bg-slate-900 px-3 py-1.5 text-xs font-semibold text-white"
                      >
                        Approve
                      </button>
                      <button onClick={() => reject(row)} className="rounded-lg border border-border px-3 py-1.5 text-xs font-medium hover:bg-muted">
                        Reject
                      </button>
                    </>
                  ) : row.subscription?.status === 'PENDING_PAYMENT' ? (
                    <>
                      <CopyButton value={row.subscription.paymentUrl} label="Copy payment link" />
                      <button onClick={() => markPaid(row)} className="rounded-lg border border-border px-3 py-1.5 text-xs font-medium hover:bg-muted">
                        Mark as paid
                      </button>
                    </>
                  ) : null}
                </div>
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function ApproveForm({
  row,
  onApproved,
  onCancel,
}: {
  row: SignupRow;
  onApproved: (result: ApprovedSignup, password: string) => void;
  onCancel: () => void;
}) {
  const [slug, setSlug] = useState(row.slug);
  const [adminEmail, setAdminEmail] = useState(row.email);
  const [adminName, setAdminName] = useState(row.contactName);
  const [password, setPassword] = useState(suggestPassword);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const result = await platformApi.patch<ApprovedSignup>(`/signups/${row.id}/approve`, {
        slug, adminEmail, adminName, password, planCode: row.planCode,
      });
      onApproved(result, password);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not approve it');
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit} className="space-y-4 rounded-2xl border-2 border-slate-900/20 bg-card p-6">
      <div>
        <h2 className="font-semibold">Approve {row.companyName}</h2>
        <p className="mt-1 text-sm text-muted-foreground">
          This creates the workspace <strong>suspended</strong> with its first administrator, and issues a
          payment link for {row.planCode}. It opens when that is paid.
        </p>
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Workspace address" hint="Their staff sign in here. Cannot be changed later.">
          <input value={slug} onChange={(e) => setSlug(e.target.value.toLowerCase())} className={`${inputClass} font-mono`} required />
        </Field>
        <Field label="Administrator name">
          <input value={adminName} onChange={(e) => setAdminName(e.target.value)} className={inputClass} required />
        </Field>
        <Field label="Administrator email" hint="What they sign in with">
          <input type="email" value={adminEmail} onChange={(e) => setAdminEmail(e.target.value)} className={inputClass} required />
        </Field>
        <Field label="Temporary password" hint="Shown once — copy it before closing.">
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
          {busy && <Loader2 className="h-4 w-4 animate-spin" />}
          {busy ? 'Approving…' : 'Approve and create workspace'}
        </button>
        <button type="button" onClick={onCancel} className="rounded-xl border border-border px-4 py-2.5 text-sm">
          Cancel
        </button>
      </div>
    </form>
  );
}

/** The credentials and the payment link, shown once. */
function Handover({
  handover,
  onDone,
}: {
  handover: ApprovedSignup & { company: string; password: string };
  onDone: () => void;
}) {
  const summary = [
    `Workspace: ${handover.company}`,
    `Payment link: ${handover.subscription.paymentUrl}`,
    `Sign in: ${handover.tenant.loginUrl}`,
    `Email: ${handover.tenant.adminEmail}`,
    `Password: ${handover.password}`,
  ].join('\n');

  return (
    <div className="space-y-4 rounded-2xl border-2 border-emerald-500/40 bg-emerald-50/60 p-6">
      <div>
        <h2 className="font-semibold text-emerald-900">{handover.company} is approved</h2>
        <p className="text-sm text-emerald-800">
          The workspace exists but is <strong>suspended</strong> until the first payment. Send them the
          payment link; the sign-in details are theirs for afterwards. <strong>The password is not
          stored anywhere</strong> — once you leave this screen it can only be reset.
        </p>
      </div>

      <dl className="grid gap-2 rounded-xl bg-white p-4 text-sm">
        <Row label="Payment" value={handover.subscription.paymentUrl} />
        <Row label="Amount" value={`${rupees(handover.subscription.amountPaise)} · ${handover.subscription.planCode}`} />
        <Row label="Sign in" value={handover.tenant.loginUrl} />
        <Row label="Email" value={handover.tenant.adminEmail} />
        <Row label="Password" value={handover.password} />
      </dl>

      <div className="flex flex-wrap gap-2">
        <CopyButton value={handover.subscription.paymentUrl} label="Copy payment link" solid />
        <CopyButton value={summary} label="Copy everything" />
        <button onClick={onDone} className="rounded-xl border border-emerald-600/30 px-4 py-2.5 text-sm">
          Done
        </button>
      </div>
    </div>
  );
}

function CopyButton({ value, label, solid }: { value: string; label: string; solid?: boolean }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      type="button"
      onClick={async () => {
        await navigator.clipboard.writeText(value);
        setCopied(true);
        setTimeout(() => setCopied(false), 2000);
      }}
      className={
        solid
          ? 'flex items-center gap-2 rounded-xl bg-emerald-600 px-4 py-2.5 text-sm font-semibold text-white'
          : 'flex items-center gap-1.5 rounded-lg border border-border px-3 py-1.5 text-xs font-medium hover:bg-muted'
      }
    >
      {copied ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
      {copied ? 'Copied' : label}
    </button>
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

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex flex-wrap items-baseline gap-2">
      <dt className="w-24 shrink-0 text-muted-foreground">{label}</dt>
      <dd className="break-all font-mono text-[13px]">{value}</dd>
    </div>
  );
}
