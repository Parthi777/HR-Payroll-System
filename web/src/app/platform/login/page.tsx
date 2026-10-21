'use client';

import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import Script from 'next/script';
import { Building2, KeyRound, ScrollText } from 'lucide-react';
import { PasswordInput } from '@/components/password-input';
import { BrandLogo } from '@/components/brand-logo';
import { EnrolForm, RecoveryCodes, RecoveryUsed, VerifyForm, type TwoStepCopy } from '@/components/two-step-forms';
import {
  platformApi,
  savePlatformSession,
  type PasswordStep,
  type PlatformSession,
} from '@/lib/platform-api';

/**
 * "Sign in with Google" — the console only; Master Control has none. Build-time,
 * like every NEXT_PUBLIC_ value: unset, the button is simply not drawn.
 */
const GOOGLE_CLIENT_ID = process.env.NEXT_PUBLIC_GOOGLE_CLIENT_ID;

type Stage =
  | { kind: 'password' }
  | { kind: 'verify'; challenge: string }
  | { kind: 'enroll'; challenge: string }
  | { kind: 'recovery-codes'; codes: string[] }
  | { kind: 'recovery-used'; left: number };

/**
 * Platform sign-in — deliberately its own page and its own token.
 *
 * Platform staff are not members of any dealer, so this is not the dealer login
 * with an extra role. The server refuses a platform token on every dealer route
 * and a dealer token here, and keeping the two sessions in separate storage
 * keys means signing in to one never disturbs the other.
 *
 * Two steps, always. The password alone returns a challenge, not a session:
 * the second step is a code from an authenticator app, and an account that has
 * never set one up is walked through doing so right here. This account can
 * reach every dealer, so a leaked password must not be enough.
 */
export default function PlatformLoginPage() {
  const router = useRouter();
  const [stage, setStage] = useState<Stage>({ kind: 'password' });

  function signedIn(session: PlatformSession) {
    savePlatformSession(session.token, session.name);
    if (session.recoveryCodes) setStage({ kind: 'recovery-codes', codes: session.recoveryCodes });
    else if (session.recoveryCodesLeft !== undefined) setStage({ kind: 'recovery-used', left: session.recoveryCodesLeft });
    else router.push('/platform');
  }

  const restart = () => setStage({ kind: 'password' });

  /** Same staggered arrival as the rest of the product, in CSS only. */
  const rise = (delayMs: number) => ({
    animation: `rise-in 0.7s cubic-bezier(0.22,1,0.36,1) ${delayMs}ms both`,
  });

  return (
    <div className="flex min-h-screen flex-col lg:flex-row">
      {/*
        The console's own panel — charcoal, not the green the dealer app
        uses. Someone who signs in here every week should be able to tell at a
        glance which of the two systems they are looking at.
      */}
      <section className="relative isolate overflow-hidden bg-ink-950 px-6 py-10 text-white lg:w-[44%] lg:px-14 lg:py-16">
        <div aria-hidden className="pointer-events-none absolute inset-0 -z-10">
          <div className="absolute -left-24 -top-32 h-[26rem] w-[26rem] animate-drift rounded-full bg-brand-500/20 blur-3xl" />
          <div className="absolute -bottom-40 -right-24 h-[24rem] w-[24rem] animate-drift-slow rounded-full bg-gold-500/15 blur-3xl" />
          <div className="absolute inset-0 opacity-[0.15]
            [background-image:linear-gradient(to_right,rgba(255,255,255,.6)_1px,transparent_1px),linear-gradient(to_bottom,rgba(255,255,255,.6)_1px,transparent_1px)]
            [background-size:56px_56px]
            [mask-image:radial-gradient(ellipse_at_top_left,black,transparent_70%)]" />
        </div>

        <div className="relative flex h-full flex-col">
          <div style={rise(0)}>
            {/* The parent brand, reversed for the charcoal panel: the console belongs
                to Kayaazh, not to any one product or dealer. */}
            <BrandLogo product="parent" tone="dark" height={40} className="-ml-1.5 h-10 w-auto" />
            <h1 className="mt-3 text-sm font-semibold tracking-wide">
              Platform Console <span className="font-normal text-white/60">· Dealer onboarding</span>
            </h1>
          </div>

          <div className="mt-10 lg:mt-auto lg:pt-16" style={rise(120)}>
            <h2 className="max-w-md text-2xl font-bold leading-tight tracking-tight sm:text-3xl lg:text-[2.4rem] lg:leading-[1.1]">
              Every dealership, from one place.
            </h2>
            <p className="mt-3 max-w-sm text-sm leading-relaxed text-white/60">
              The account behind this door creates workspaces, suspends them, and can see across
              all of them. It is protected accordingly.
            </p>

            <ul className="mt-8 hidden space-y-5 lg:block">
              {[
                { icon: Building2, title: 'Onboard in one step', copy: 'A workspace, its first branch and its first login, created together.' },
                { icon: ScrollText, title: 'Recorded as it happens', copy: 'Every action lands in the platform log with who did it, when and from where.' },
                { icon: KeyRound, title: 'Two-step, always', copy: 'A password alone never opens the console — a code from your authenticator is required.' },
              ].map((item, i) => (
                <li key={item.title} className="flex gap-3.5" style={rise(280 + i * 90)}>
                  <div className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-white/10 ring-1 ring-white/15">
                    <item.icon className="h-4 w-4" />
                  </div>
                  <div>
                    <div className="text-sm font-semibold">{item.title}</div>
                    <div className="mt-0.5 max-w-xs text-xs leading-relaxed text-white/55">{item.copy}</div>
                  </div>
                </li>
              ))}
            </ul>
          </div>
        </div>
      </section>

      {/* Form side */}
      <section className="flex flex-1 items-center justify-center bg-background px-6 py-12 sm:px-10">
        <div className="w-full max-w-[24rem]" style={rise(200)}>
        {stage.kind === 'password' && (
          <PasswordForm onNext={(res) => setStage({ kind: res.step, challenge: res.challenge })} />
        )}
        {stage.kind === 'verify' && (
          <VerifyForm<PlatformSession> challenge={stage.challenge} post={twoStepPost} copy={COPY} onSignedIn={signedIn} onRestart={restart} />
        )}
        {stage.kind === 'enroll' && (
          <EnrolForm<PlatformSession> challenge={stage.challenge} post={twoStepPost} copy={COPY} onSignedIn={signedIn} onRestart={restart} />
        )}
        {stage.kind === 'recovery-codes' && (
          <RecoveryCodes codes={stage.codes} copy={COPY} onDone={() => router.push('/platform')} />
        )}
        {stage.kind === 'recovery-used' && (
          <RecoveryUsed left={stage.left} copy={COPY} onDone={() => router.push('/platform')} />
        )}
        </div>
      </section>
    </div>
  );
}

const inputClass =
  'w-full rounded-xl border border-border bg-muted/40 px-4 py-3 text-sm outline-none focus:border-primary';
const primaryButton =
  'mt-6 flex w-full items-center justify-center gap-2 rounded-xl bg-ink-900 py-3 text-sm font-semibold text-white disabled:opacity-60';

/** The console's two-step endpoints, under /api/platform/auth. */
const twoStepPost = <T,>(path: string, body: object) => platformApi.post<T>(`/auth${path}`, body);

const COPY: TwoStepCopy = {
  appName: 'the platform console',
  enrolReason: 'The console needs a code from your phone as well as your password.',
  continueLabel: 'Continue to the console',
  lostPhoneHelp:
    'If your phone is lost, ask another administrator to reset your two-step verification from Team, then sign in again to set it up on your new phone. To replace your codes, go to My account.',
  buttonClass: primaryButton,
};

function useSubmit() {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  async function run(action: () => Promise<void>) {
    setBusy(true);
    setError(null);
    try {
      await action();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Something went wrong');
    } finally {
      setBusy(false);
    }
  }
  return { busy, error, run };
}

function PasswordForm({ onNext }: { onNext: (res: PasswordStep) => void }) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const { busy, error, run } = useSubmit();
  const googleDiv = useRef<HTMLDivElement>(null);
  const [gsiReady, setGsiReady] = useState(false);

  // Google stands in for the password only: the server answers with the same
  // challenge, and the authenticator code is still asked for next.
  useEffect(() => {
    if (!gsiReady || !GOOGLE_CLIENT_ID || !window.google || !googleDiv.current) return;
    window.google.accounts.id.initialize({
      client_id: GOOGLE_CLIENT_ID,
      callback: ({ credential }) =>
        void run(async () => onNext(await platformApi.post<PasswordStep>('/auth/google', { credential }))),
    });
    window.google.accounts.id.renderButton(googleDiv.current, {
      theme: 'outline',
      size: 'large',
      width: 336,
      text: 'signin_with',
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [gsiReady]);

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        void run(async () => onNext(await platformApi.post<PasswordStep>('/auth/login', { email, password })));
      }}
    >
      <h2 className="text-[1.6rem] font-bold leading-tight tracking-tight">Welcome back</h2>
      <p className="mb-7 mt-1.5 text-sm text-muted-foreground">
        Sign in with {GOOGLE_CLIENT_ID ? 'Google or your password' : 'your password'}, then a code from your authenticator app.
      </p>

      {GOOGLE_CLIENT_ID && (
        <>
          <Script src="https://accounts.google.com/gsi/client" onReady={() => setGsiReady(true)} />
          <div ref={googleDiv} className="flex min-h-[44px] justify-center [color-scheme:light]" />
          <div className="my-6 flex items-center gap-4 text-xs font-medium text-muted-foreground">
            <div className="h-px flex-1 bg-border" />
            or with email and password
            <div className="h-px flex-1 bg-border" />
          </div>
        </>
      )}

      <label className="mb-1 block text-sm font-medium">Email</label>
      <input
        type="email"
        value={email}
        onChange={(e) => setEmail(e.target.value)}
        placeholder="you@yourcompany.com"
        autoComplete="username"
        className={`mb-4 ${inputClass}`}
        required
      />

      <label className="mb-1 block text-sm font-medium">Password</label>
      <PasswordInput value={password} onChange={setPassword} className={inputClass} />

      {error && <p className="mt-3 text-sm text-destructive">{error}</p>}

      <button type="submit" disabled={busy} className={primaryButton}>
        {busy ? 'Signing in…' : 'Sign In'}
      </button>

      <p className="mt-4 text-center text-xs text-muted-foreground">
        This is not a dealer sign-in. Dealer staff sign in at their own workspace address.
      </p>
    </form>
  );
}
