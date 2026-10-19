'use client';

import { useEffect, useState } from 'react';
import QRCode from 'qrcode';
import { Check, Copy, KeyRound, Loader2, Smartphone } from 'lucide-react';

/**
 * The second step of signing in — shared by Master Control and the platform
 * console, which use the same design: the password earns a challenge, and the
 * challenge plus a code from an authenticator app earns the session. An account
 * that has never set one up is walked through it here.
 *
 * The caller supplies how to reach its own two-step endpoints (`post`, with
 * paths like '/two-step/verify'), and the wording and button style that suit
 * its page. Everything else is the same on both surfaces, on purpose.
 */

/** What the server returns once the second step is passed. */
export interface TwoStepSession {
  /** Present when a recovery code was used — how many remain. */
  recoveryCodesLeft?: number;
  /** Present only when enrolment just finished: shown once, never again. */
  recoveryCodes?: string[];
}

export interface EnrolmentSecret {
  secret: string;
  otpauthUri: string;
}

export interface TwoStepCopy {
  /** Shown in the verify hint: "…the 6-digit code for {appName}." */
  appName: string;
  /** Why enrolment is needed, one sentence. */
  enrolReason: string;
  /** The button that leaves the recovery-code screens. */
  continueLabel: string;
  /** What to do when the phone is lost, after a recovery code was used. */
  lostPhoneHelp: string;
  /** Classes for the primary button, so it matches the page around it. */
  buttonClass: string;
}

type Post = <T>(path: string, body: object) => Promise<T>;

const inputClass =
  'w-full rounded-xl border border-border bg-muted/40 px-4 py-3 text-sm outline-none focus:border-primary';

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

/** Six digits from the authenticator, or — with the phone gone — a recovery code. */
export function VerifyForm<S extends TwoStepSession>({
  challenge,
  post,
  copy,
  onSignedIn,
  onRestart,
}: {
  challenge: string;
  post: Post;
  copy: TwoStepCopy;
  onSignedIn: (s: S) => void;
  onRestart: () => void;
}) {
  const [useRecovery, setUseRecovery] = useState(false);
  const [code, setCode] = useState('');
  const { busy, error, run } = useSubmit();

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        void run(async () => onSignedIn(await post<S>('/two-step/verify', { challenge, code })));
      }}
    >
      <h2 className="text-[1.4rem] font-bold leading-tight tracking-tight">Two-step verification</h2>
      <div className="mb-4 mt-4 flex items-start gap-3 rounded-xl bg-muted/50 p-3 text-sm">
        {useRecovery ? <KeyRound className="mt-0.5 h-4 w-4 shrink-0" /> : <Smartphone className="mt-0.5 h-4 w-4 shrink-0" />}
        <span>
          {useRecovery
            ? 'Enter one of the recovery codes you saved when you set up two-step verification. Each works once.'
            : `Open your authenticator app and enter the 6-digit code for ${copy.appName}.`}
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

      {error && <p role="alert" className="mt-3 text-sm text-destructive">{error}</p>}

      <button type="submit" disabled={busy || (!useRecovery && code.length !== 6)} className={copy.buttonClass}>
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
 * First sign-in since two-step verification became mandatory, or since it was
 * reset: scan, then prove the scan worked with one code.
 */
export function EnrolForm<S extends TwoStepSession>({
  challenge,
  post,
  copy,
  onSignedIn,
  onRestart,
}: {
  challenge: string;
  post: Post;
  copy: TwoStepCopy;
  onSignedIn: (s: S) => void;
  onRestart: () => void;
}) {
  const [enrolment, setEnrolment] = useState<EnrolmentSecret | null>(null);
  const [qr, setQr] = useState<string | null>(null);
  const [setupError, setSetupError] = useState<string | null>(null);
  const [code, setCode] = useState('');
  const { busy, error, run } = useSubmit();

  useEffect(() => {
    let cancelled = false;
    post<EnrolmentSecret>('/two-step/setup', { challenge })
      .then(async (res) => {
        if (cancelled) return;
        setEnrolment(res);
        // Drawn in the browser: the secret already came over TLS to this page,
        // and sending it to a QR-image service would be handing it to a stranger.
        setQr(await QRCode.toDataURL(res.otpauthUri, { margin: 1, width: 200 }));
      })
      .catch((err) => !cancelled && setSetupError(err instanceof Error ? err.message : 'Could not start setup'));
    return () => { cancelled = true; };
    // `post` is a stable module function at both call sites; the challenge is what matters.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [challenge]);

  if (setupError) {
    return (
      <div className="space-y-4 text-sm">
        <p className="text-destructive">{setupError}</p>
        <button type="button" onClick={onRestart} className={copy.buttonClass}>Start again</button>
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
        void run(async () => onSignedIn(await post<S>('/two-step/enable', { challenge, code })));
      }}
    >
      <h2 className="text-[1.4rem] font-bold leading-tight tracking-tight">Set up two-step verification</h2>
      <p className="mt-1 text-sm text-muted-foreground">{copy.enrolReason} This takes a minute, once.</p>

      <ol className="mt-4 space-y-4 text-sm">
        <li>
          <span className="font-medium">1. Scan this with an authenticator app</span>
          <span className="block text-xs text-muted-foreground">
            Google Authenticator, Microsoft Authenticator, 1Password — any of them.
          </span>
          <div className="mt-3 flex justify-center">
            {qr ? (
              // A data: URL drawn on this page, which next/image cannot optimise.
              // eslint-disable-next-line @next/next/no-img-element
              <img src={qr} alt="QR code for your authenticator app" width={200} height={200} className="rounded-lg border border-border bg-white" />
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

      {error && <p role="alert" className="mt-3 text-sm text-destructive">{error}</p>}

      <button type="submit" disabled={busy || code.length !== 6} className={copy.buttonClass}>
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

export function CodeInput({
  value,
  onChange,
  autoFocus = true,
}: {
  value: string;
  onChange: (v: string) => void;
  /** On by default: on a sign-in step the code is the only thing to type. */
  autoFocus?: boolean;
}) {
  return (
    <input
      value={value}
      onChange={(e) => onChange(e.target.value.replace(/\D/g, '').slice(0, 6))}
      inputMode="numeric"
      autoComplete="one-time-code"
      placeholder="123456"
      autoFocus={autoFocus}
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
export function RecoveryCodes({ codes, copy, onDone }: { codes: string[]; copy: TwoStepCopy; onDone: () => void }) {
  const [copied, setCopied] = useState(false);
  const [saved, setSaved] = useState(false);

  return (
    <div>
      <div className="flex items-center gap-2 text-emerald-700 dark:text-emerald-400">
        <Check className="h-5 w-5" />
        <h2 className="text-base font-semibold">Two-step verification is on</h2>
      </div>
      <RecoveryCodeList codes={codes} />

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

      <button type="button" disabled={!saved} onClick={onDone} className={copy.buttonClass}>
        {copy.continueLabel}
      </button>
    </div>
  );
}

/** The codes and the warning that goes with them — also used when replacing them later. */
export function RecoveryCodeList({ codes }: { codes: string[] }) {
  return (
    <>
      <p className="mt-2 text-sm text-muted-foreground">
        Save these recovery codes somewhere safe that is not your phone — a password manager, or
        printed. If you lose your phone, each one signs you in once. <strong>They will not be shown again.</strong>
      </p>
      <ul aria-label="Recovery codes" className="mt-4 grid grid-cols-2 gap-2 rounded-xl bg-muted/50 p-4 font-mono text-[13px]">
        {codes.map((c) => <li key={c}>{c}</li>)}
      </ul>
    </>
  );
}

export function RecoveryUsed({ left, copy, onDone }: { left: number; copy: TwoStepCopy; onDone: () => void }) {
  return (
    <div>
      <h2 className="text-base font-semibold">You signed in with a recovery code</h2>
      <p className="mt-2 text-sm text-muted-foreground">
        That code is now used up. You have <strong>{left}</strong> left.
      </p>
      <p className="mt-2 text-sm text-muted-foreground">{copy.lostPhoneHelp}</p>
      <button type="button" onClick={onDone} className={copy.buttonClass}>
        {copy.continueLabel}
      </button>
    </div>
  );
}
