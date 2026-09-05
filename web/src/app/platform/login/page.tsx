'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { ShieldCheck } from 'lucide-react';
import { PasswordInput } from '@/components/password-input';
import { platformApi, savePlatformSession } from '@/lib/platform-api';

interface PlatformLogin {
  token: string;
  name: string;
  email: string;
}

/**
 * Platform sign-in — deliberately its own page and its own token.
 *
 * Platform staff are not members of any dealer, so this is not the dealer login
 * with an extra role. The server refuses a platform token on every dealer route
 * and a dealer token here, and keeping the two sessions in separate storage
 * keys means signing in to one never disturbs the other.
 */
export default function PlatformLoginPage() {
  const router = useRouter();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError(null);
    try {
      const res = await platformApi.post<PlatformLogin>('/auth/login', { email, password });
      savePlatformSession(res.token, res.name);
      router.push('/platform');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Sign in failed');
    } finally {
      setLoading(false);
    }
  }

  return (
    <main className="flex min-h-screen items-center justify-center bg-slate-900 p-6">
      <form onSubmit={onSubmit} className="w-full max-w-sm rounded-2xl bg-card p-8 shadow-brand">
        <div className="mb-6 flex flex-col items-center text-center">
          <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-slate-900 text-white">
            <ShieldCheck className="h-7 w-7" />
          </div>
          <h1 className="mt-4 text-xl font-bold">Platform Console</h1>
          <p className="text-sm text-muted-foreground">Onboard and manage dealers</p>
        </div>

        <label className="mb-1 block text-sm font-medium">Email</label>
        <input
          type="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          placeholder="you@yourcompany.com"
          autoComplete="username"
          className="mb-4 w-full rounded-xl border border-border bg-muted/40 px-4 py-3 text-sm outline-none focus:border-primary"
          required
        />

        <label className="mb-1 block text-sm font-medium">Password</label>
        <PasswordInput value={password} onChange={setPassword} />

        {error && <p className="mt-3 text-sm text-destructive">{error}</p>}

        <button
          type="submit"
          disabled={loading}
          className="mt-6 w-full rounded-xl bg-slate-900 py-3 text-sm font-semibold text-white disabled:opacity-60"
        >
          {loading ? 'Signing in…' : 'Sign In'}
        </button>

        <p className="mt-4 text-center text-xs text-muted-foreground">
          This is not a dealer sign-in. Dealer staff sign in at their own workspace address.
        </p>
      </form>
    </main>
  );
}
