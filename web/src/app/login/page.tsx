'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { UserCheck } from 'lucide-react';
import { api } from '@/lib/api';

interface LoginResponse {
  token: string;
  role: string;
  email: string;
  name: string;
}

export default function LoginPage() {
  const router = useRouter();
  const [email, setEmail] = useState('admin@hrpayroll.local');
  const [password, setPassword] = useState('admin123');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError(null);
    try {
      const res = await api<LoginResponse>('/auth/admin/login', {
        method: 'POST',
        body: JSON.stringify({ email, password }),
      });
      localStorage.setItem('token', res.token);
      localStorage.setItem('adminName', res.name);
      router.push('/dashboard');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Login failed');
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="brand-gradient flex min-h-screen items-center justify-center p-4">
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

        <label className="mb-1 block text-xs font-medium text-muted-foreground">Email</label>
        <input
          type="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
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
          Dev credentials are pre-filled. Backend must be running on :3001.
        </p>
      </form>
    </div>
  );
}
