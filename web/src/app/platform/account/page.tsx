'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { ArrowLeft, Check, KeyRound, Loader2 } from 'lucide-react';
import { PasswordInput } from '@/components/password-input';
import { platformApi, suggestPassword } from '@/lib/platform-api';

interface Me {
  id: string;
  name: string;
  email: string;
}

/**
 * The platform administrator's own account.
 *
 * Until this existed, rotating this password meant shell access to production —
 * re-running the setup script against the live database. That is a reasonable
 * way to create the first account and a poor way to maintain it, which is why
 * the credential went unrotated.
 */
export default function PlatformAccountPage() {
  const [me, setMe] = useState<Me | null>(null);
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [confirm, setConfirm] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  useEffect(() => {
    platformApi.get<Me>('/me').then(setMe).catch(() => setMe(null));
  }, []);

  const tooShort = next.length > 0 && next.length < 12;
  const mismatch = confirm.length > 0 && next !== confirm;
  const ready = current.length > 0 && next.length >= 12 && next === confirm && !busy;

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await platformApi.patch('/me/password', { currentPassword: current, newPassword: next });
      setDone(true);
      setCurrent(''); setNext(''); setConfirm('');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not change the password');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="mx-auto max-w-xl space-y-6">
      <Link href="/platform" className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground">
        <ArrowLeft className="h-4 w-4" /> All dealers
      </Link>

      <div>
        <h1 className="text-2xl font-bold">My account</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          {me ? <>Signed in as <strong>{me.name}</strong> · {me.email}</> : 'Loading…'}
        </p>
      </div>

      {done ? (
        <div className="space-y-4 rounded-2xl border-2 border-emerald-500/40 bg-emerald-50 p-6">
          <div className="flex items-center gap-2 text-emerald-900">
            <Check className="h-5 w-5" />
            <h2 className="font-semibold">Password changed</h2>
          </div>
          <p className="text-sm text-emerald-800">
            Use the new password next time you sign in. This browser stays signed in, and any
            other session you left open stays valid until its token expires — within 8 hours.
            If you are rotating because the old password was exposed, sign out everywhere you
            can reach.
          </p>
          <button onClick={() => setDone(false)} className="rounded-xl border border-emerald-600/30 px-4 py-2 text-sm">
            Change it again
          </button>
        </div>
      ) : (
        <form onSubmit={submit} className="space-y-4 rounded-2xl border border-border bg-card p-6">
          <div className="flex items-center gap-2">
            <KeyRound className="h-4 w-4 text-muted-foreground" />
            <h2 className="font-semibold">Change password</h2>
          </div>

          <label className="block">
            <span className="mb-1 block text-sm font-medium">Current password</span>
            <PasswordInput value={current} onChange={setCurrent} placeholder="The one you signed in with" />
          </label>

          <label className="block">
            <span className="mb-1 block text-sm font-medium">New password</span>
            <PasswordInput value={next} onChange={setNext} placeholder="At least 12 characters" />
            <span className="mt-1 flex flex-wrap items-center gap-2 text-xs">
              <span className={tooShort ? 'text-destructive' : 'text-muted-foreground'}>
                {tooShort ? `${next.length} of 12 characters` : 'At least 12 characters'}
              </span>
              <button
                type="button"
                onClick={() => { const p = suggestPassword(); setNext(p); setConfirm(p); }}
                className="text-muted-foreground underline underline-offset-2 hover:text-foreground"
              >
                Suggest one
              </button>
            </span>
          </label>

          <label className="block">
            <span className="mb-1 block text-sm font-medium">Confirm new password</span>
            <PasswordInput value={confirm} onChange={setConfirm} placeholder="Type it again" />
            {mismatch && <span className="mt-1 block text-xs text-destructive">These do not match</span>}
          </label>

          {error && <p className="text-sm text-destructive">{error}</p>}

          <button
            type="submit"
            disabled={!ready}
            className="flex items-center gap-2 rounded-xl bg-slate-900 px-4 py-2.5 text-sm font-semibold text-white disabled:opacity-50"
          >
            {busy && <Loader2 className="h-4 w-4 animate-spin" />}
            {busy ? 'Changing…' : 'Change password'}
          </button>
        </form>
      )}

      <p className="text-xs text-muted-foreground">
        This account manages every dealer, so it is worth a password you do not use anywhere
        else. It is stored hashed — nobody, including support, can read it back.
      </p>
    </div>
  );
}
