'use client';

import { useCallback, useEffect, useState } from 'react';
import { Check, Copy, Loader2, Plus, RotateCcw, UserMinus, UserPlus } from 'lucide-react';
import { platformApi, suggestPassword, type PlatformStaff } from '@/lib/platform-api';

/** A password handed over once, and the person it belongs to. */
interface Handover {
  name: string;
  email: string;
  password: string;
  reset: boolean;
}

/**
 * The platform team.
 *
 * One account holding the keys to every dealer is a single point of failure in
 * both directions — nobody can onboard a dealer while that person is away, and
 * one leaked password reaches every tenant. This page is how that stops being
 * true.
 *
 * Accounts are deactivated, never deleted: the audit log names its actor by id,
 * and a log pointing at a row that no longer exists is worse than no log.
 */
export default function PlatformTeamPage() {
  const [staff, setStaff] = useState<PlatformStaff[] | null>(null);
  const [meId, setMeId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [handover, setHandover] = useState<Handover | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const res = await platformApi.get<{ staff: PlatformStaff[] }>('/users');
      setStaff(res.staff);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not load the team');
    }
  }, []);

  useEffect(() => {
    void load();
    platformApi.get<{ id: string }>('/me').then((m) => setMeId(m.id)).catch(() => {});
  }, [load]);

  async function setActive(person: PlatformStaff, isActive: boolean) {
    const verb = isActive ? 'Reactivate' : 'Deactivate';
    if (!confirm(`${verb} ${person.name}? ${isActive ? '' : 'They will not be able to sign in to the console.'}`)) return;
    setBusyId(person.id);
    setError(null);
    try {
      await platformApi.patch(`/users/${person.id}`, { isActive });
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : `Could not ${verb.toLowerCase()} the account`);
    } finally {
      setBusyId(null);
    }
  }

  async function resetPassword(person: PlatformStaff) {
    if (!confirm(`Reset the password for ${person.name}? Their current one stops working immediately.`)) return;
    const password = suggestPassword();
    setBusyId(person.id);
    setError(null);
    try {
      await platformApi.patch(`/users/${person.id}`, { password });
      setHandover({ name: person.name, email: person.email, password, reset: true });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not reset the password');
    } finally {
      setBusyId(null);
    }
  }

  const activeCount = staff?.filter((s) => s.isActive).length ?? 0;

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold">Platform team</h1>
          <p className="text-sm text-muted-foreground">
            {staff
              ? `${activeCount} active administrator${activeCount === 1 ? '' : 's'}${
                  staff.length > activeCount ? ` · ${staff.length - activeCount} deactivated` : ''
                }`
              : 'Loading…'}
          </p>
        </div>
        <button
          onClick={() => { setShowForm((v) => !v); setHandover(null); }}
          className="flex items-center gap-2 rounded-xl bg-slate-900 px-4 py-2.5 text-sm font-semibold text-white"
        >
          <Plus className="h-4 w-4" /> Add administrator
        </button>
      </div>

      {error && <p className="rounded-xl bg-destructive/10 p-3 text-sm text-destructive">{error}</p>}

      {handover && (
        <CredentialsHandover handover={handover} onDone={() => { setHandover(null); void load(); }} />
      )}

      {showForm && !handover && (
        <NewAdminForm
          onCreated={(h) => { setHandover(h); setShowForm(false); }}
          onCancel={() => setShowForm(false)}
        />
      )}

      {staff === null ? (
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" /> Loading team…
        </div>
      ) : (
        <div className="overflow-hidden rounded-2xl border border-border bg-card">
          <table className="w-full text-sm">
            <thead className="bg-muted/50 text-left text-xs uppercase text-muted-foreground">
              <tr>
                <th className="px-4 py-3">Name</th>
                <th className="px-4 py-3">Email</th>
                <th className="px-4 py-3">Added</th>
                <th className="px-4 py-3">Status</th>
                <th className="px-4 py-3" />
              </tr>
            </thead>
            <tbody>
              {staff.map((person) => {
                const isMe = person.id === meId;
                const lastActive = person.isActive && activeCount <= 1;
                return (
                  <tr key={person.id} className={`border-t border-border ${person.isActive ? '' : 'opacity-60'}`}>
                    <td className="px-4 py-3 font-medium">
                      {person.name}
                      {isMe && (
                        <span className="ml-2 rounded-full bg-muted px-2 py-0.5 text-[11px] font-normal text-muted-foreground">
                          You
                        </span>
                      )}
                    </td>
                    <td className="px-4 py-3 text-muted-foreground">{person.email}</td>
                    <td className="px-4 py-3 text-muted-foreground">
                      {new Date(person.createdAt).toLocaleDateString('en-IN', {
                        day: 'numeric', month: 'short', year: 'numeric',
                      })}
                    </td>
                    <td className="px-4 py-3">
                      <span
                        className={`rounded-full px-2 py-0.5 text-xs font-medium ${
                          person.isActive ? 'bg-emerald-100 text-emerald-700' : 'bg-slate-200 text-slate-600'
                        }`}
                      >
                        {person.isActive ? 'Active' : 'Deactivated'}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-right whitespace-nowrap">
                      {busyId === person.id ? (
                        <Loader2 className="ml-auto h-4 w-4 animate-spin text-muted-foreground" />
                      ) : (
                        <>
                          {person.isActive && !isMe && (
                            <button
                              onClick={() => resetPassword(person)}
                              className="mr-2 inline-flex items-center gap-1.5 rounded-lg border border-border px-3 py-1.5 text-xs font-medium hover:bg-muted"
                              title="Generate a new password for this administrator"
                            >
                              <RotateCcw className="h-3.5 w-3.5" /> Reset password
                            </button>
                          )}
                          {person.isActive ? (
                            <button
                              onClick={() => setActive(person, false)}
                              disabled={isMe || lastActive}
                              title={
                                isMe
                                  ? 'Change your own password on My account instead — you cannot deactivate yourself'
                                  : lastActive
                                    ? 'The last active administrator cannot be deactivated'
                                    : 'Deactivate this administrator'
                              }
                              className="inline-flex items-center gap-1.5 rounded-lg border border-border px-3 py-1.5 text-xs font-medium hover:bg-muted disabled:cursor-not-allowed disabled:opacity-40"
                            >
                              <UserMinus className="h-3.5 w-3.5" /> Deactivate
                            </button>
                          ) : (
                            <button
                              onClick={() => setActive(person, true)}
                              className="inline-flex items-center gap-1.5 rounded-lg border border-border px-3 py-1.5 text-xs font-medium hover:bg-muted"
                            >
                              <UserPlus className="h-3.5 w-3.5" /> Reactivate
                            </button>
                          )}
                        </>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      <p className="text-xs text-muted-foreground">
        Everyone here can create dealers, suspend them, and reset any dealer administrator&rsquo;s
        password. Add people you would trust with all of that. Every action they take is recorded
        in the activity log.
      </p>
    </div>
  );
}

function NewAdminForm({
  onCreated,
  onCancel,
}: {
  onCreated: (h: Handover) => void;
  onCancel: () => void;
}) {
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState(suggestPassword);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await platformApi.post<{ staff: PlatformStaff }>('/users', { name, email, password });
      onCreated({ name, email, password, reset: false });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not create the account');
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit} className="space-y-4 rounded-2xl border border-border bg-card p-6">
      <h2 className="font-semibold">New administrator</h2>

      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Name">
          <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Ravi Kumar" className={inputClass} required />
        </Field>

        <Field label="Email" hint="What they sign in with">
          <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="ravi@yourcompany.com" className={inputClass} required />
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
          {busy ? 'Creating…' : 'Create account'}
        </button>
        <button type="button" onClick={onCancel} className="rounded-xl border border-border px-4 py-2.5 text-sm">
          Cancel
        </button>
      </div>
    </form>
  );
}

/**
 * The password, shown once.
 *
 * It is hashed the moment it is stored, so this screen is the only place it will
 * ever exist. Saying so plainly matters more than the styling.
 */
function CredentialsHandover({ handover, onDone }: { handover: Handover; onDone: () => void }) {
  const [copied, setCopied] = useState(false);
  const summary = `Platform console: ${window.location.origin}/platform/login\nEmail: ${handover.email}\nPassword: ${handover.password}`;

  return (
    <div className="space-y-4 rounded-2xl border-2 border-emerald-500/40 bg-emerald-50/50 p-6">
      <div>
        <h2 className="font-semibold text-emerald-900">
          {handover.reset ? `New password for ${handover.name}` : `${handover.name} can now sign in`}
        </h2>
        <p className="text-sm text-emerald-800">
          {handover.reset
            ? 'Their old password no longer works. '
            : ''}
          Give these to them directly. <strong>The password is not stored anywhere</strong> — once you
          leave this screen it cannot be shown again, only reset. Ask them to change it on My account
          once they are in.
        </p>
      </div>

      <dl className="grid gap-2 rounded-xl bg-white p-4 text-sm">
        <Row label="Sign in at" value={`${window.location.origin}/platform/login`} />
        <Row label="Email" value={handover.email} />
        <Row label="Password" value={handover.password} />
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

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex flex-wrap items-baseline gap-2">
      <dt className="w-24 shrink-0 text-muted-foreground">{label}</dt>
      <dd className="break-all font-mono text-[13px]">{value}</dd>
    </div>
  );
}
