'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { AlertCircle, CheckCircle2, Loader2 } from 'lucide-react';
import { api } from '@/lib/api';
import { rememberTenant } from '@/lib/tenant';
import { PasswordInput } from '@/components/password-input';
import { AuthCard, authButton, authField } from '@/components/auth-card';

/**
 * Where the emailed link lands: choose a new password.
 *
 * The link names its workspace, and that — not whatever this browser last
 * signed in to — is the workspace the reset is sent to, so an owner of two
 * dealerships resets the login the email was about.
 */
export default function ResetPasswordPage() {
  const [link, setLink] = useState<{ token: string; workspace: string } | null>(null);
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<{ email: string } | null>(null);

  useEffect(() => {
    const q = new URLSearchParams(window.location.search);
    const token = q.get('token');
    const workspace = q.get('workspace');
    if (token && workspace) setLink({ token, workspace });
    else setError('This link is incomplete. Open it straight from the email, or ask for a new one.');
    // The token is in the address bar; keep it out of the history and any referrer.
    window.history.replaceState(null, '', '/reset-password');
  }, []);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!link) return;
    if (password.length < 12) return setError('Use at least 12 characters.');
    if (password !== confirm) return setError('The two passwords do not match.');
    setBusy(true);
    setError(null);
    try {
      const res = await api<{ email: string; tenant: { slug: string; name: string } }>('/auth/admin/reset-password', {
        method: 'POST',
        body: JSON.stringify({ token: link.token, password }),
        headers: { 'X-Tenant-Slug': link.workspace },
      });
      // So the sign-in page opens on the workspace that was just reset.
      rememberTenant(res.tenant.slug, res.tenant.name);
      setDone({ email: res.email });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not set the new password');
    } finally {
      setBusy(false);
    }
  }

  if (done) {
    return (
      <AuthCard title="Password changed">
        <div className="flex gap-3 rounded-xl bg-secondary p-4 text-sm text-secondary-foreground">
          <CheckCircle2 className="mt-0.5 h-5 w-5 shrink-0 text-primary" />
          <p>
            Sign in as <strong>{done.email}</strong> with your new password. You&rsquo;ll still need the code from your
            authenticator app — or set one up, if this is your first time.
          </p>
        </div>
        <Link href="/login" className={`${authButton} mt-6`}>Go to sign in</Link>
      </AuthCard>
    );
  }

  return (
    <AuthCard title="Set a new password" subtitle="At least 12 characters. The link works once.">
      <form onSubmit={submit} className="space-y-5">
        <div>
          <label className="mb-1.5 block text-xs font-semibold text-foreground/80">New password</label>
          <PasswordInput value={password} onChange={setPassword} className={authField} />
        </div>
        <div>
          <label className="mb-1.5 block text-xs font-semibold text-foreground/80">Type it again</label>
          <PasswordInput value={confirm} onChange={setConfirm} className={authField} />
        </div>

        {error && (
          <div role="alert" className="flex items-start gap-2.5 rounded-xl border border-destructive/25 bg-destructive/5 px-3.5 py-2.5 text-sm text-destructive">
            <AlertCircle className="mt-px h-4 w-4 shrink-0" />
            <span>
              {error}{' '}
              {/expired|incomplete|used/.test(error) && (
                <Link href="/forgot-password" className="font-semibold underline">Ask for a new link</Link>
              )}
            </span>
          </div>
        )}

        <button type="submit" disabled={busy || !link} className={authButton}>
          {busy && <Loader2 className="h-4 w-4 animate-spin" />} Save new password
        </button>
      </form>
    </AuthCard>
  );
}
