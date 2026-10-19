'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { ShieldCheck, ScanFace, MapPin, Wallet, Loader2, AlertCircle, ArrowRight } from 'lucide-react';
import { ApiError, api } from '@/lib/api';
import { PasswordInput } from '@/components/password-input';
import { BrandLogo } from '@/components/brand-logo';
import { EnrolForm, RecoveryCodes, RecoveryUsed, VerifyForm, type TwoStepCopy } from '@/components/two-step-forms';
import { forgetTenant, rememberTenant, tenantSlug } from '@/lib/tenant';
import { landingFor, type AdminRole } from '@/lib/permissions';

/** A correct password: the second step still to come. */
interface PasswordStep {
  step: 'verify' | 'enroll';
  challenge: string;
  /** Which workspace the sign-in resolved to. */
  tenant?: { slug: string; name: string };
}

/** The session, once the second step is passed. */
interface LoginResponse {
  token: string;
  role: string;
  email: string;
  name: string;
  tenant?: { slug: string; name: string };
  recoveryCodesLeft?: number;
  recoveryCodes?: string[];
}

type Stage =
  | { kind: 'password' }
  | { kind: 'verify'; challenge: string }
  | { kind: 'enroll'; challenge: string }
  | { kind: 'recovery-codes'; codes: string[]; next: string }
  | { kind: 'recovery-used'; left: number; next: string };

/** Master Control's two-step endpoints, under /api/auth/admin. */
const twoStepPost = <T,>(path: string, body: object) =>
  api<T>(`/auth/admin${path}`, { method: 'POST', body: JSON.stringify(body) });

const TWO_STEP_COPY: TwoStepCopy = {
  appName: 'Kayaazh Payroll',
  enrolReason: 'Every Master Control account signs in with a code from a phone as well as a password.',
  continueLabel: 'Continue to Master Control',
  lostPhoneHelp:
    'If your phone is lost, ask your Super Admin to reset your two-step verification from User Access, then sign in again to set it up on your new phone.',
  buttonClass:
    'mt-6 flex h-12 w-full items-center justify-center gap-2 rounded-xl bg-primary text-sm font-semibold text-primary-foreground shadow-brand transition hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-60',
};

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

export default function LoginPage() {
  const router = useRouter();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  /** Password first, then a code from the authenticator — enrolling one if there is none yet. */
  const [stage, setStage] = useState<Stage>({ kind: 'password' });
  const [workspace, setWorkspace] = useState<string | null>(null);
  /** Ask which dealer this is, before asking for a password. */
  const [askWorkspace, setAskWorkspace] = useState(false);
  const [slugInput, setSlugInput] = useState('');
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
    if (slug) {
      api<{ slug: string; name: string }>(`/auth/workspace/${slug}`)
        .then((w) => setWorkspace(w.name))
        .catch(() => setWorkspace(null));
      return;
    }
    // Nothing in the address and nothing remembered. One shared address serves
    // every dealer, so ask the server whether this deployment has more than one
    // — asking on a single-dealer deployment would be friction for nothing.
    // Silent on failure: the sign-in below still explains what is missing.
    api<{ required: boolean }>('/auth/workspace')
      .then(({ required }) => setAskWorkspace(required))
      .catch(() => {});
  }, []);

  /** Name the workspace, so every request from here carries its slug. */
  async function chooseWorkspace(e: React.FormEvent) {
    e.preventDefault();
    const slug = slugInput.trim().toLowerCase();
    if (!/^[a-z0-9][a-z0-9-]{1,30}$/.test(slug)) {
      setError('A workspace address is lowercase letters, digits and hyphens.');
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const found = await api<{ slug: string; name: string }>(`/auth/workspace/${slug}`);
      rememberTenant(found.slug, found.name);
      setWorkspace(found.name);
      setAskWorkspace(false);
    } catch (err) {
      setError(
        err instanceof ApiError && err.status === 404
          ? `No workspace at “${slug}”. Check the address in your company’s sign-in link.`
          : err instanceof Error ? err.message : 'Could not find that workspace',
      );
    } finally {
      setLoading(false);
    }
  }

  function finishLogin(res: LoginResponse) {
    localStorage.setItem('token', res.token);
    localStorage.setItem('adminName', res.name);
    localStorage.setItem('adminRole', res.role);
    // Remember the workspace the server resolved us to, so every later request
    // names it explicitly instead of relying on the single-tenant fallback.
    if (res.tenant) rememberTenant(res.tenant.slug, res.tenant.name);
    // Not everyone can open the dashboard — a cashier lands on Claims.
    const next = landingFor(res.role as AdminRole);
    // Recovery codes are shown once, before anything else; a used one is worth saying.
    if (res.recoveryCodes) setStage({ kind: 'recovery-codes', codes: res.recoveryCodes, next });
    else if (res.recoveryCodesLeft !== undefined) setStage({ kind: 'recovery-used', left: res.recoveryCodesLeft, next });
    else router.push(next);
  }

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError(null);
    try {
      // A correct password earns a challenge, never a session.
      const res = await api<PasswordStep>('/auth/admin/login', {
        method: 'POST',
        body: JSON.stringify({ email, password }),
      });
      if (res.tenant) rememberTenant(res.tenant.slug, res.tenant.name);
      setPassword('');
      setStage({ kind: res.step, challenge: res.challenge });
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Login failed';
      // The server could not tell which dealer this is — ask, rather than
      // leaving someone to guess what went wrong.
      if (message.includes('which workspace')) setAskWorkspace(true);
      setError(message);
    } finally {
      setLoading(false);
    }
  }

  const field =
    'h-12 w-full rounded-xl border border-border bg-background px-4 text-sm outline-none transition ' +
    'placeholder:text-muted-foreground/60 focus:border-primary/40 focus:ring-4 focus:ring-ring/15';

  return (
    <div className="flex min-h-screen flex-col lg:flex-row">
      {/*
        Brand panel. Full height beside the form on a desktop, a compact banner
        above it on a phone — the feature list is the first thing to go, since
        someone on a phone is signing in, not being introduced to the product.
        Charcoal, because the brand's coloured logo belongs on charcoal or
        white, never on a green field.
      */}
      <section className="brand-panel relative isolate overflow-hidden px-6 py-10 text-white lg:w-[46%] lg:px-14 lg:py-16 xl:px-20">
        {/* Depth, in two cheap layers: a soft light source top-left, and a fine
            grid that catches it. Both masked so they fade rather than stop. */}
        <div
          aria-hidden
          className="pointer-events-none absolute -left-24 -top-32 h-[28rem] w-[28rem] animate-drift rounded-full bg-brand-500/25 blur-3xl"
        />
        <div
          aria-hidden
          className="pointer-events-none absolute -bottom-40 -right-24 h-[26rem] w-[26rem] animate-drift-slow rounded-full bg-gold-500/15 blur-3xl"
        />
        <div
          aria-hidden
          className="pointer-events-none absolute inset-0 opacity-[0.18]
            [background-image:linear-gradient(to_right,rgba(255,255,255,.7)_1px,transparent_1px),linear-gradient(to_bottom,rgba(255,255,255,.7)_1px,transparent_1px)]
            [background-size:56px_56px]
            [mask-image:radial-gradient(ellipse_at_top_left,black,transparent_70%)]"
        />

        <div className="relative flex h-full flex-col">
          <div>
            <BrandLogo tone="dark" height={52} className="-ml-2 h-[52px] w-auto" />
            <div className="mt-1 text-xs font-medium uppercase tracking-[0.18em] text-white/60">Master Control</div>
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
          {stage.kind === 'verify' && (
            <VerifyForm<LoginResponse> challenge={stage.challenge} post={twoStepPost} copy={TWO_STEP_COPY} onSignedIn={finishLogin} onRestart={() => setStage({ kind: 'password' })} />
          )}
          {stage.kind === 'enroll' && (
            <EnrolForm<LoginResponse> challenge={stage.challenge} post={twoStepPost} copy={TWO_STEP_COPY} onSignedIn={finishLogin} onRestart={() => setStage({ kind: 'password' })} />
          )}
          {stage.kind === 'recovery-codes' && (
            <RecoveryCodes codes={stage.codes} copy={TWO_STEP_COPY} onDone={() => router.push(stage.next)} />
          )}
          {stage.kind === 'recovery-used' && (
            <RecoveryUsed left={stage.left} copy={TWO_STEP_COPY} onDone={() => router.push(stage.next)} />
          )}
          {stage.kind === 'password' && (<>
          {/* The dealer this link belongs to, when the URL names one. Shown
              before the password field so someone on a branded link can tell
              they are in the right workspace first. */}
          {workspace && (
            <div className="mb-6 inline-flex items-center gap-2 rounded-full border border-border bg-secondary px-3.5 py-1.5 text-xs font-semibold text-secondary-foreground">
              <span className="h-1.5 w-1.5 rounded-full bg-primary" />
              {workspace}
            </div>
          )}

          <h1 className="text-[1.75rem] font-bold leading-tight tracking-tight">
            {askWorkspace ? 'Which workspace?' : 'Welcome back'}
          </h1>
          <p className="mt-1.5 text-sm text-muted-foreground">
            {askWorkspace
              ? 'One address serves every dealership, so name yours to continue.'
              : `Sign in to your ${workspace ? 'workspace' : 'admin account'} to continue.`}
          </p>

          <form onSubmit={askWorkspace ? chooseWorkspace : onSubmit} className="mt-7">
            {askWorkspace ? (
              <>
                <label htmlFor="workspace" className="mb-1.5 block text-xs font-semibold text-foreground/80">
                  Workspace address
                </label>
                <input
                  id="workspace"
                  value={slugInput}
                  onChange={(e) => setSlugInput(e.target.value)}
                  placeholder="bhavani-motors"
                  autoComplete="organization"
                  autoFocus
                  className={field}
                  required
                />
                <p className="mt-2 text-xs text-muted-foreground">
                  The name in your company&rsquo;s sign-in link. Ask your HR administrator if you are not sure.
                </p>
              </>
            ) : (
              <>
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
              </>
            )}

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
              className="group flex h-12 w-full items-center justify-center gap-2 rounded-xl bg-primary text-sm font-semibold text-primary-foreground shadow-brand
                transition hover:brightness-110 focus:outline-none focus:ring-4 focus:ring-ring/25
                disabled:cursor-not-allowed disabled:opacity-60 disabled:hover:brightness-100"
            >
              {loading ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin" /> {askWorkspace ? 'Checking…' : 'Signing in…'}
                </>
              ) : (
                <>
                  {askWorkspace ? 'Continue' : 'Sign in'}
                  <ArrowRight className="h-4 w-4 transition-transform group-hover:translate-x-0.5" />
                </>
              )}
            </button>
          </form>

          {/* A shared address can be the wrong workspace as easily as the right
              one, so leave a way back out of it. */}
          {!askWorkspace && workspace && (
            <button
              type="button"
              onClick={() => {
                forgetTenant();
                setWorkspace(null);
                setSlugInput('');
                setError(null);
                setAskWorkspace(true);
              }}
              className="mt-4 w-full text-center text-xs text-muted-foreground underline-offset-2 hover:text-foreground hover:underline"
            >
              Not {workspace}? Choose another workspace
            </button>
          )}

          <p className="mt-8 flex items-center justify-center gap-1.5 text-center text-xs text-muted-foreground">
            <ShieldCheck className="h-3.5 w-3.5" />
            Accounts are issued by your administrator. Sign-in needs your password and a code from your phone.
          </p>
          </>)}
        </div>
      </section>
    </div>
  );
}
