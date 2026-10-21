'use client';

import { useEffect, useState } from 'react';
import { AlertCircle, Loader2, MailCheck } from 'lucide-react';
import { api } from '@/lib/api';
import { tenantSlug } from '@/lib/tenant';
import { AuthCard, authButton, authField } from '@/components/auth-card';

/**
 * "Forgot password?" — asks for the address and emails a one-time link.
 *
 * The answer is the same whether or not the address has a login, so this page
 * never says "no such account". The workspace comes from the address or the
 * one remembered from the last sign-in; when neither names one and there is
 * more than one dealer, it is asked for here, as on the sign-in page.
 */
export default function ForgotPasswordPage() {
  const [email, setEmail] = useState('');
  const [askWorkspace, setAskWorkspace] = useState(false);
  const [workspace, setWorkspace] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);

  useEffect(() => {
    if (tenantSlug()) return;
    api<{ required: boolean }>('/auth/workspace')
      .then(({ required }) => setAskWorkspace(required))
      .catch(() => {});
  }, []);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const slug = workspace.trim().toLowerCase();
      const res = await api<{ message: string }>('/auth/admin/forgot-password', {
        method: 'POST',
        body: JSON.stringify({ email: email.trim() }),
        ...(askWorkspace && slug ? { headers: { 'X-Tenant-Slug': slug } } : {}),
      });
      setDone(res.message);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not send the link');
    } finally {
      setBusy(false);
    }
  }

  if (done) {
    return (
      <AuthCard title="Check your email">
        <div className="flex gap-3 rounded-xl bg-secondary p-4 text-sm text-secondary-foreground">
          <MailCheck className="mt-0.5 h-5 w-5 shrink-0 text-primary" />
          <p>{done}</p>
        </div>
        <p className="mt-4 text-xs text-muted-foreground">
          Nothing after a few minutes? Look in spam, or ask your Super Admin to reset your password from User Access.
        </p>
      </AuthCard>
    );
  }

  return (
    <AuthCard
      title="Forgot your password?"
      subtitle="Enter the email you sign in with. We'll send you a link to set a new password."
    >
      <form onSubmit={submit} className="space-y-5">
        {askWorkspace && (
          <div>
            <label htmlFor="workspace" className="mb-1.5 block text-xs font-semibold text-foreground/80">
              Workspace address
            </label>
            <input
              id="workspace"
              value={workspace}
              onChange={(e) => setWorkspace(e.target.value)}
              placeholder="bhavani-motors"
              className={authField}
              required
            />
          </div>
        )}
        <div>
          <label htmlFor="email" className="mb-1.5 block text-xs font-semibold text-foreground/80">
            Email address
          </label>
          <input
            id="email"
            type="email"
            autoComplete="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="you@company.com"
            className={authField}
            autoFocus
            required
          />
        </div>

        {error && (
          <div role="alert" className="flex items-start gap-2.5 rounded-xl border border-destructive/25 bg-destructive/5 px-3.5 py-2.5 text-sm text-destructive">
            <AlertCircle className="mt-px h-4 w-4 shrink-0" />
            <span>{error}</span>
          </div>
        )}

        <button type="submit" disabled={busy} className={authButton}>
          {busy && <Loader2 className="h-4 w-4 animate-spin" />} Email me a link
        </button>
      </form>
    </AuthCard>
  );
}
