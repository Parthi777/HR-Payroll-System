'use client';

import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import Script from 'next/script';
import { UserCheck } from 'lucide-react';
import { api } from '@/lib/api';

interface LoginResponse {
  token: string;
  role: string;
  email: string;
  name: string;
}

const GOOGLE_CLIENT_ID = process.env.NEXT_PUBLIC_GOOGLE_CLIENT_ID;

// Minimal typing for the Google Identity Services global.
declare global {
  interface Window {
    google?: {
      accounts: {
        id: {
          initialize: (config: { client_id: string; callback: (r: { credential: string }) => void }) => void;
          renderButton: (el: HTMLElement, options: Record<string, unknown>) => void;
        };
      };
    };
  }
}

export default function LoginPage() {
  const router = useRouter();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const googleDiv = useRef<HTMLDivElement>(null);
  const [gsiReady, setGsiReady] = useState(false);

  function finishLogin(res: LoginResponse) {
    localStorage.setItem('token', res.token);
    localStorage.setItem('adminName', res.name);
    router.push('/dashboard');
  }

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError(null);
    try {
      finishLogin(
        await api<LoginResponse>('/auth/admin/login', {
          method: 'POST',
          body: JSON.stringify({ email, password }),
        }),
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Login failed');
    } finally {
      setLoading(false);
    }
  }

  // Render the official Google button once the GIS script is ready.
  useEffect(() => {
    if (!gsiReady || !GOOGLE_CLIENT_ID || !window.google || !googleDiv.current) return;
    window.google.accounts.id.initialize({
      client_id: GOOGLE_CLIENT_ID,
      callback: async ({ credential }) => {
        setError(null);
        try {
          finishLogin(
            await api<LoginResponse>('/auth/admin/google', {
              method: 'POST',
              body: JSON.stringify({ credential }),
            }),
          );
        } catch (err) {
          setError(err instanceof Error ? err.message : 'Google sign-in failed');
        }
      },
    });
    window.google.accounts.id.renderButton(googleDiv.current, {
      theme: 'outline',
      size: 'large',
      width: 320,
      text: 'signin_with',
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [gsiReady]);

  return (
    <div className="brand-gradient flex min-h-screen items-center justify-center p-4">
      {GOOGLE_CLIENT_ID && (
        <Script src="https://accounts.google.com/gsi/client" onReady={() => setGsiReady(true)} />
      )}
      <form
        onSubmit={onSubmit}
        className="w-full max-w-sm rounded-2xl bg-card p-8 shadow-brand"
      >
        <div className="mb-6 flex flex-col items-center text-center">
          <div className="flex h-14 w-14 items-center justify-center rounded-2xl brand-gradient text-white">
            <UserCheck className="h-7 w-7" />
          </div>
          <h1 className="mt-4 text-xl font-bold">HR &amp; Payroll</h1>
          <p className="text-sm text-muted-foreground">Master Control · Admin sign in</p>
        </div>

        {GOOGLE_CLIENT_ID && (
          <>
            <div ref={googleDiv} className="mb-4 flex justify-center" />
            <div className="mb-4 flex items-center gap-3 text-xs text-muted-foreground">
              <div className="h-px flex-1 bg-border" /> or with password <div className="h-px flex-1 bg-border" />
            </div>
          </>
        )}

        <label className="mb-1 block text-xs font-medium text-muted-foreground">Email</label>
        <input
          type="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          placeholder="you@company.com"
          className="mb-4 h-11 w-full rounded-xl border border-border bg-background px-3 text-sm outline-none focus:ring-2 focus:ring-ring/40"
          required
        />

        <label className="mb-1 block text-xs font-medium text-muted-foreground">Password</label>
        <input
          type="password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          className="mb-4 h-11 w-full rounded-xl border border-border bg-background px-3 text-sm outline-none focus:ring-2 focus:ring-ring/40"
          required
        />

        {error && <p className="mb-4 text-sm text-destructive">{error}</p>}

        <button
          type="submit"
          disabled={loading}
          className="h-11 w-full rounded-xl brand-gradient font-semibold text-white shadow-brand disabled:opacity-60"
        >
          {loading ? 'Signing in…' : 'Sign In'}
        </button>

        <p className="mt-4 text-center text-xs text-muted-foreground">
          Access is limited to registered admin accounts.
        </p>
      </form>
    </div>
  );
}
