'use client';

import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import Script from 'next/script';
import { ShieldCheck, ScanFace, MapPin, Wallet, Loader2, AlertCircle, ArrowRight } from 'lucide-react';
import { api } from '@/lib/api';
import { PasswordInput } from '@/components/password-input';
import { rememberTenant, tenantSlug } from '@/lib/tenant';
import { landingFor, type AdminRole } from '@/lib/permissions';

interface LoginResponse {
  token: string;
  role: string;
  email: string;
  name: string;
  /** Which workspace the sign-in resolved to. */
  tenant?: { slug: string; name: string };
}

const GOOGLE_CLIENT_ID = process.env.NEXT_PUBLIC_GOOGLE_CLIENT_ID;

/**
 * What this product actually does, in the order someone uses it.
 *
 * Real capabilities rather than marketing lines — the person signing in is
 * staff, not a prospect, and a login screen that oversells is just noise
 * between them and their work.
 */
const FEATURES = [
  { icon: ScanFace, title: 'Selfie attendance', copy: 'Face-verified check-in, matched against the enrolled employee.' },
  { icon: MapPin, title: 'GPS geofencing', copy: 'Punches tied to a branch boundary, with every exception flagged.' },
  { icon: Wallet, title: 'Payroll & payslips', copy: 'Attendance straight through to net salary and the bank file.' },
];

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
  const [workspace, setWorkspace] = useState<string | null>(null);
  /**
   * The same staggered arrival as the landing page, so the two screens read as
   * one product. Pure CSS, and not gated on hydration — a sign-in form that
   * waits for a bundle before becoming visible is a sign-in form that is blank
   * on a bad connection. See the note on the landing page.
   */
  const rise = (delayMs: number) => ({
    animation: `rise-in 0.7s cubic-bezier(0.22,1,0.36,1) ${delayMs}ms both`,
  });

  // Show which dealer this login belongs to, so someone arriving on a branded
  // link can see they are in the right place before typing a password. Silent
  // on failure: an unknown slug should not stop a valid sign-in from the
  // single-tenant fallback.
  useEffect(() => {
    const slug = tenantSlug();
    if (!slug) return;
    api<{ slug: string; name: string }>(`/auth/workspace/${slug}`)
      .then((w) => setWorkspace(w.name))
      .catch(() => setWorkspace(null));
  }, []);

  function finishLogin(res: LoginResponse) {
    localStorage.setItem('token', res.token);
    localStorage.setItem('adminName', res.name);
    localStorage.setItem('adminRole', res.role);
    // Remember the workspace the server resolved us to, so every later request
    // names it explicitly instead of relying on the single-tenant fallback.
    if (res.tenant) rememberTenant(res.tenant.slug, res.tenant.name);
    // Not everyone can open the dashboard — a cashier lands on Claims.
    router.push(landingFor(res.role as AdminRole));
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

  const field =
    'h-12 w-full rounded-xl border border-border bg-background px-4 text-sm outline-none transition ' +
    'placeholder:text-muted-foreground/60 focus:border-primary/40 focus:ring-4 focus:ring-ring/15';

  return (
    <div className="flex min-h-screen flex-col lg:flex-row">
      {GOOGLE_CLIENT_ID && (
        <Script src="https://accounts.google.com/gsi/client" onReady={() => setGsiReady(true)} />
      )}

      {/*
        Brand panel. Full height beside the form on a desktop, a compact banner
        above it on a phone — the feature list is the first thing to go, since
        someone on a phone is signing in, not being introduced to the product.
      */}
      <section className="brand-gradient relative isolate overflow-hidden px-6 py-10 text-white lg:w-[46%] lg:px-14 lg:py-16 xl:px-20">
        {/* Depth, in two cheap layers: a soft light source top-left, and a fine
            grid that catches it. Both masked so they fade rather than stop. */}
        <div
          aria-hidden
          className="pointer-events-none absolute -left-24 -top-32 h-[28rem] w-[28rem] animate-drift rounded-full bg-white/20 blur-3xl"
        />
        <div
          aria-hidden
          className="pointer-events-none absolute -bottom-40 -right-24 h-[26rem] w-[26rem] animate-drift-slow rounded-full bg-indigo-300/20 blur-3xl"
        />
        <div
          aria-hidden
          className="pointer-events-none absolute inset-0 opacity-[0.18]
            [background-image:linear-gradient(to_right,rgba(255,255,255,.7)_1px,transparent_1px),linear-gradient(to_bottom,rgba(255,255,255,.7)_1px,transparent_1px)]
            [background-size:56px_56px]
            [mask-image:radial-gradient(ellipse_at_top_left,black,transparent_70%)]"
        />

        <div className="relative flex h-full flex-col">
          <div className="flex items-center gap-3">
            <div className="relative flex h-11 w-11 items-center justify-center rounded-2xl bg-white/15 ring-1 ring-white/25 backdrop-blur">
              <span aria-hidden className="absolute inset-0 animate-halo rounded-2xl bg-white/20 blur-md" />
              <ShieldCheck className="relative h-6 w-6" />
            </div>
            <div className="leading-tight">
              <div className="text-sm font-semibold tracking-wide">HR &amp; Payroll</div>
              <div className="text-xs text-white/75">Master Control</div>
            </div>
          </div>

          <div className="mt-10 lg:mt-auto lg:pt-16" style={rise(120)}>
            <h2 className="max-w-md text-2xl font-bold leading-tight tracking-tight sm:text-3xl lg:text-[2.6rem] lg:leading-[1.1]">
              Attendance, people and payroll in one place.
            </h2>
            <p className="mt-3 max-w-sm text-sm leading-relaxed text-white/75">
              Every check-in verified by face and location, every salary traced back to the days behind it.
            </p>

            <ul className="mt-8 hidden space-y-5 lg:block">
              {FEATURES.map((f, i) => (
                <li key={f.title} className="flex gap-3.5" style={rise(300 + i * 90)}>
                  <div className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-white/12 ring-1 ring-white/20">
                    <f.icon className="h-4 w-4" />
                  </div>
                  <div>
                    <div className="text-sm font-semibold">{f.title}</div>
                    <div className="mt-0.5 max-w-xs text-xs leading-relaxed text-white/70">{f.copy}</div>
                  </div>
                </li>
              ))}
            </ul>
          </div>
        </div>
      </section>

      {/* Form side */}
      <section className="flex flex-1 items-center justify-center bg-background px-6 py-12 sm:px-10">
        <div className="w-full max-w-[26rem]" style={rise(200)}>
          {/* The dealer this link belongs to, when the URL names one. Shown
              before the password field so someone on a branded link can tell
              they are in the right workspace first. */}
          {workspace && (
            <div className="mb-6 inline-flex items-center gap-2 rounded-full border border-border bg-secondary px-3.5 py-1.5 text-xs font-semibold text-secondary-foreground">
              <span className="h-1.5 w-1.5 rounded-full bg-primary" />
              {workspace}
            </div>
          )}

          <h1 className="text-[1.75rem] font-bold leading-tight tracking-tight">Welcome back</h1>
          <p className="mt-1.5 text-sm text-muted-foreground">
            Sign in to your {workspace ? 'workspace' : 'admin account'} to continue.
          </p>

          {GOOGLE_CLIENT_ID && (
            <>
              <div ref={googleDiv} className="mt-7 flex justify-center [color-scheme:light]" />
              <div className="my-6 flex items-center gap-4 text-xs font-medium text-muted-foreground">
                <div className="h-px flex-1 bg-border" />
                or continue with email
                <div className="h-px flex-1 bg-border" />
              </div>
            </>
          )}

          <form onSubmit={onSubmit} className={GOOGLE_CLIENT_ID ? '' : 'mt-7'}>
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
              className={`${field} mb-5`}
              required
            />

            <label htmlFor="password" className="mb-1.5 block text-xs font-semibold text-foreground/80">
              Password
            </label>
            <PasswordInput
              value={password}
              onChange={setPassword}
              placeholder="••••••••"
              className={field}
            />

            {/*
              Reserved space, so an error appears without the button jumping
              down under the cursor that is about to press it again.
            */}
            <div className="min-h-[3.25rem] pt-3">
              {error && (
                <div
                  role="alert"
                  className="flex items-start gap-2.5 rounded-xl border border-destructive/25 bg-destructive/5 px-3.5 py-2.5 text-sm text-destructive"
                >
                  <AlertCircle className="mt-px h-4 w-4 shrink-0" />
                  <span>{error}</span>
                </div>
              )}
            </div>

            <button
              type="submit"
              disabled={loading}
              className="group flex h-12 w-full items-center justify-center gap-2 rounded-xl brand-gradient text-sm font-semibold text-white shadow-brand
                transition hover:brightness-110 focus:outline-none focus:ring-4 focus:ring-ring/25
                disabled:cursor-not-allowed disabled:opacity-60 disabled:hover:brightness-100"
            >
              {loading ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin" /> Signing in…
                </>
              ) : (
                <>
                  Sign in
                  <ArrowRight className="h-4 w-4 transition-transform group-hover:translate-x-0.5" />
                </>
              )}
            </button>
          </form>

          <p className="mt-8 flex items-center justify-center gap-1.5 text-center text-xs text-muted-foreground">
            <ShieldCheck className="h-3.5 w-3.5" />
            Access is limited to registered admin accounts.
          </p>
        </div>
      </section>
    </div>
  );
}
