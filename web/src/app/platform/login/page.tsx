'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import QRCode from 'qrcode';
import { Building2, Check, Copy, KeyRound, Loader2, ScrollText, ShieldCheck, Smartphone } from 'lucide-react';
import { PasswordInput } from '@/components/password-input';
import {
  platformApi,
  savePlatformSession,
  type EnrolmentSecret,
  type PasswordStep,
  type PlatformSession,
} from '@/lib/platform-api';

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
        The console's own panel — slate, not the brand gradient the dealer app
        uses. Someone who signs in here every week should be able to tell at a
        glance which of the two systems they are looking at.
      */}
      <section className="relative isolate overflow-hidden bg-slate-950 px-6 py-10 text-white lg:w-[44%] lg:px-14 lg:py-16">
        <div aria-hidden className="pointer-events-none absolute inset-0 -z-10">
          <div className="absolute -left-24 -top-32 h-[26rem] w-[26rem] animate-drift rounded-full bg-indigo-500/25 blur-3xl" />
          <div className="absolute -bottom-40 -right-24 h-[24rem] w-[24rem] animate-drift-slow rounded-full bg-violet-500/20 blur-3xl" />
          <div className="absolute inset-0 opacity-[0.15]
            [background-image:linear-gradient(to_right,rgba(255,255,255,.6)_1px,transparent_1px),linear-gradient(to_bottom,rgba(255,255,255,.6)_1px,transparent_1px)]
            [background-size:56px_56px]
            [mask-image:radial-gradient(ellipse_at_top_left,black,transparent_70%)]" />
        </div>

        <div className="relative flex h-full flex-col">
          <div className="flex items-center gap-3" style={rise(0)}>
            <div className="relative flex h-11 w-11 items-center justify-center rounded-2xl bg-white/10 ring-1 ring-white/20 backdrop-blur">
              <span aria-hidden className="absolute inset-0 animate-halo rounded-2xl bg-white/15 blur-md" />
              <ShieldCheck className="relative h-6 w-6" />
            </div>
            <div className="leading-tight">
              <h1 className="text-sm font-semibold tracking-wide">Platform Console</h1>
              <div className="text-xs text-white/60">Dealer onboarding</div>
            </div>
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
          <VerifyForm challenge={stage.challenge} onSignedIn={signedIn} onRestart={restart} />
        )}
        {stage.kind === 'enroll' && (
          <EnrolForm challenge={stage.challenge} onSignedIn={signedIn} onRestart={restart} />
        )}
        {stage.kind === 'recovery-codes' && (
          <RecoveryCodes codes={stage.codes} onDone={() => router.push('/platform')} />
        )}
        {stage.kind === 'recovery-used' && (
          <RecoveryUsed left={stage.left} onDone={() => router.push('/platform')} />
        )}
        </div>
      </section>
    </div>
  );
}

const inputClass =
  'w-full rounded-xl border border-border bg-muted/40 px-4 py-3 text-sm outline-none focus:border-primary';
const primaryButton =
  'mt-6 flex w-full items-center justify-center gap-2 rounded-xl bg-slate-900 py-3 text-sm font-semibold text-white disabled:opacity-60';

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

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        void run(async () => onNext(await platformApi.post<PasswordStep>('/auth/login', { email, password })));
      }}
    >
      <h2 className="text-[1.6rem] font-bold leading-tight tracking-tight">Welcome back</h2>
      <p className="mb-7 mt-1.5 text-sm text-muted-foreground">
        Sign in with your password, then a code from your authenticator app.
      </p>

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

/** Six digits from the authenticator, or — with the phone gone — a recovery code. */
function VerifyForm({
  challenge,
  onSignedIn,
  onRestart,
}: {
  challenge: string;
  onSignedIn: (s: PlatformSession) => void;
  onRestart: () => void;
}) {
  const [useRecovery, setUseRecovery] = useState(false);
  const [code, setCode] = useState('');
  const { busy, error, run } = useSubmit();

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        void run(async () =>
          onSignedIn(await platformApi.post<PlatformSession>('/auth/two-step/verify', { challenge, code })),
        );
      }}
    >
      <div className="mb-4 flex items-start gap-3 rounded-xl bg-muted/50 p-3 text-sm">
        {useRecovery ? <KeyRound className="mt-0.5 h-4 w-4 shrink-0" /> : <Smartphone className="mt-0.5 h-4 w-4 shrink-0" />}
        <span>
          {useRecovery
            ? 'Enter one of the recovery codes you saved when you set up two-step verification. Each works once.'
            : 'Open your authenticator app and enter the 6-digit code for the platform console.'}
        </span>
      </div>

      <label className="mb-1 block text-sm font-medium">{useRecovery ? 'Recovery code' : 'Code'}</label>
      {useRecovery ? (
        <input
          key="recovery"
          value={code}
          onChange={(e) => setCode(e.target.value)}
          placeholder="XXXXX-XXXXX"
          autoComplete="off"
          autoFocus
          className={`${inputClass} font-mono tracking-wider`}
          required
        />
      ) : (
        <CodeInput value={code} onChange={setCode} />
      )}

      {error && <p className="mt-3 text-sm text-destructive">{error}</p>}

      <button type="submit" disabled={busy || (!useRecovery && code.length !== 6)} className={primaryButton}>
        {busy && <Loader2 className="h-4 w-4 animate-spin" />}
        {busy ? 'Checking…' : 'Verify'}
      </button>

      <div className="mt-4 flex flex-wrap justify-between gap-x-4 gap-y-2 text-xs text-muted-foreground [&>button]:whitespace-nowrap">
        <button type="button" onClick={onRestart} className="underline-offset-2 hover:text-foreground hover:underline">
          Start again
        </button>
        <button
          type="button"
          onClick={() => { setUseRecovery((v) => !v); setCode(''); }}
          className="underline-offset-2 hover:text-foreground hover:underline"
        >
          {useRecovery ? 'Use the authenticator app' : 'Lost your phone? Use a recovery code'}
        </button>
      </div>
    </form>
  );
}

/**
 * First sign-in since two-step verification became mandatory, or since a
 * colleague reset it: scan, then prove the scan worked with one code.
 */
function EnrolForm({
  challenge,
  onSignedIn,
  onRestart,
}: {
  challenge: string;
  onSignedIn: (s: PlatformSession) => void;
  onRestart: () => void;
}) {
  const [enrolment, setEnrolment] = useState<EnrolmentSecret | null>(null);
  const [qr, setQr] = useState<string | null>(null);
  const [setupError, setSetupError] = useState<string | null>(null);
  const [code, setCode] = useState('');
  const { busy, error, run } = useSubmit();

  useEffect(() => {
    let cancelled = false;
    platformApi
      .post<EnrolmentSecret>('/auth/two-step/setup', { challenge })
      .then(async (res) => {
        if (cancelled) return;
        setEnrolment(res);
        // Drawn in the browser: the secret already came over TLS to this page,
        // and sending it to a QR-image service would be handing it to a stranger.
        setQr(await QRCode.toDataURL(res.otpauthUri, { margin: 1, width: 200 }));
      })
      .catch((err) => !cancelled && setSetupError(err instanceof Error ? err.message : 'Could not start setup'));
    return () => { cancelled = true; };
  }, [challenge]);

  if (setupError) {
    return (
      <div className="space-y-4 text-sm">
        <p className="text-destructive">{setupError}</p>
        <button type="button" onClick={onRestart} className={primaryButton}>Start again</button>
      </div>
    );
  }

  if (!enrolment) {
    return (
      <div className="flex items-center justify-center gap-2 py-8 text-sm text-muted-foreground">
        <Loader2 className="h-4 w-4 animate-spin" /> Preparing two-step verification…
      </div>
    );
  }

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        void run(async () =>
          onSignedIn(await platformApi.post<PlatformSession>('/auth/two-step/enable', { challenge, code })),
        );
      }}
    >
      <h2 className="text-base font-semibold">Set up two-step verification</h2>
      <p className="mt-1 text-sm text-muted-foreground">
        The console needs a code from your phone as well as your password. This takes a minute, once.
      </p>

      <ol className="mt-4 space-y-4 text-sm">
        <li>
          <span className="font-medium">1. Scan this with an authenticator app</span>
          <span className="block text-xs text-muted-foreground">
            Google Authenticator, Microsoft Authenticator, 1Password — any of them.
          </span>
          <div className="mt-3 flex justify-center">
            {qr ? (
              <img src={qr} alt="QR code for your authenticator app" width={200} height={200} className="rounded-lg border border-border" />
            ) : (
              <div className="h-[200px] w-[200px] animate-pulse rounded-lg bg-muted" />
            )}
          </div>
          <details className="mt-2 text-xs text-muted-foreground">
            <summary className="cursor-pointer select-none">Can’t scan? Enter the key instead</summary>
            <code className="mt-2 block break-all rounded-lg bg-muted px-3 py-2 font-mono text-[13px] text-foreground">
              {enrolment.secret.match(/.{1,4}/g)?.join(' ')}
            </code>
          </details>
        </li>
        <li>
          <label className="mb-1 block font-medium">2. Enter the 6-digit code it shows</label>
          <CodeInput value={code} onChange={setCode} />
        </li>
      </ol>

      {error && <p className="mt-3 text-sm text-destructive">{error}</p>}

      <button type="submit" disabled={busy || code.length !== 6} className={primaryButton}>
        {busy && <Loader2 className="h-4 w-4 animate-spin" />}
        {busy ? 'Checking…' : 'Turn on and sign in'}
      </button>

      <button
        type="button"
        onClick={onRestart}
        className="mt-4 w-full text-center text-xs text-muted-foreground underline-offset-2 hover:text-foreground hover:underline"
      >
        Start again
      </button>
    </form>
  );
}

function CodeInput({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  return (
    <input
      value={value}
      onChange={(e) => onChange(e.target.value.replace(/\D/g, '').slice(0, 6))}
      inputMode="numeric"
      autoComplete="one-time-code"
      placeholder="123456"
      autoFocus
      className={`${inputClass} text-center font-mono text-lg tracking-[0.4em]`}
      required
    />
  );
}

/**
 * The recovery codes, shown once.
 *
 * Only their hashes are stored, so this is the one moment they exist in
 * readable form. Continuing is gated on saying they are saved, because the
 * cost of skipping past this is finding out on the day the phone is lost.
 */
function RecoveryCodes({ codes, onDone }: { codes: string[]; onDone: () => void }) {
  const [copied, setCopied] = useState(false);
  const [saved, setSaved] = useState(false);

  return (
    <div>
      <div className="flex items-center gap-2 text-emerald-700">
        <Check className="h-5 w-5" />
        <h2 className="text-base font-semibold">Two-step verification is on</h2>
      </div>
      <p className="mt-2 text-sm text-muted-foreground">
        Save these recovery codes somewhere safe that is not your phone — a password manager, or
        printed. If you lose your phone, each one signs you in once. <strong>They will not be shown again.</strong>
      </p>

      <ul aria-label="Recovery codes" className="mt-4 grid grid-cols-2 gap-2 rounded-xl bg-muted/50 p-4 font-mono text-[13px]">
        {codes.map((c) => <li key={c}>{c}</li>)}
      </ul>

      <button
        type="button"
        onClick={async () => {
          await navigator.clipboard.writeText(codes.join('\n'));
          setCopied(true);
          setTimeout(() => setCopied(false), 2000);
        }}
        className="mt-3 flex items-center gap-2 rounded-xl border border-border px-3 py-2 text-sm"
      >
        {copied ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}
        {copied ? 'Copied' : 'Copy codes'}
      </button>

      <label className="mt-4 flex items-start gap-2 text-sm">
        <input type="checkbox" checked={saved} onChange={(e) => setSaved(e.target.checked)} className="mt-0.5" />
        I have saved these codes somewhere safe
      </label>

      <button type="button" disabled={!saved} onClick={onDone} className={primaryButton}>
        Continue to the console
      </button>
    </div>
  );
}

function RecoveryUsed({ left, onDone }: { left: number; onDone: () => void }) {
  return (
    <div>
      <h2 className="text-base font-semibold">You signed in with a recovery code</h2>
      <p className="mt-2 text-sm text-muted-foreground">
        That code is now used up. You have <strong>{left}</strong> left.
      </p>
      <p className="mt-2 text-sm text-muted-foreground">
        If your phone is lost, ask another administrator to reset your two-step verification from
        Team, then sign in again to set it up on your new phone. To replace your codes, go to My account.
      </p>
      <button type="button" onClick={onDone} className={primaryButton}>
        Continue to the console
      </button>
    </div>
  );
}
