'use client';

/**
 * "Add dealer", as a drawer in three steps — the dealer, its first admin, a
 * review — then a progress list while the workspace is made, and the
 * credentials, shown once.
 *
 * Creation is one request on the server (workspace, branch, shift and the
 * first login together, or nothing). The progress list paces itself while
 * that request runs and finishes when it returns, so what it shows is never
 * ahead of what actually happened: an error stops it on the step it reached.
 */
import { useEffect, useState } from 'react';
import { ArrowLeft, ArrowRight, Check, Copy, Loader2, RefreshCw, X } from 'lucide-react';
import { platformApi, suggestPassword, type CreatedDealer } from '@/lib/platform-api';
import { Drawer } from './overlays';
import { Confetti, SuccessTick } from '@/components/motion';

/** "ABC Motors" → "abc-motors", the address it will live at. */
export function slugify(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 31);
}

const SLUG = /^[a-z0-9][a-z0-9-]{1,30}$/;
const STEPS = ['Dealer', 'First admin', 'Review'] as const;
const WORK = [
  'Reserving the workspace address',
  'Setting up the first branch, department and shift',
  'Issuing the administrator login',
  'Opening the workspace',
];

type Phase = 'form' | 'working' | 'done';

export function NewDealerDrawer({
  open, onClose, onCreated,
}: {
  open: boolean;
  onClose: () => void;
  /** After the credentials have been handed over, with the new dealer's id. */
  onCreated: (id: string) => void;
}) {
  const [step, setStep] = useState(0);
  const [phase, setPhase] = useState<Phase>('form');
  const [name, setName] = useState('');
  const [slug, setSlug] = useState('');
  const [slugEdited, setSlugEdited] = useState(false);
  const [adminName, setAdminName] = useState('');
  const [adminEmail, setAdminEmail] = useState('');
  const [password, setPassword] = useState(suggestPassword);
  const [error, setError] = useState<string | null>(null);
  const [progress, setProgress] = useState(0);
  const [created, setCreated] = useState<CreatedDealer | null>(null);
  const [copied, setCopied] = useState(false);

  function reset() {
    setStep(0); setPhase('form'); setName(''); setSlug(''); setSlugEdited(false);
    setAdminName(''); setAdminEmail(''); setPassword(suggestPassword()); setError(null);
    setProgress(0); setCreated(null); setCopied(false);
  }

  // The list ticks along while the request runs, but never past the last step
  // on its own: only the server's answer completes it.
  useEffect(() => {
    if (phase !== 'working') return;
    const t = setInterval(() => setProgress((p) => Math.min(p + 1, WORK.length - 1)), 550);
    return () => clearInterval(t);
  }, [phase]);

  const stepValid = [
    name.trim().length > 0 && SLUG.test(slug),
    adminName.trim().length > 0 && /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(adminEmail) && password.length >= 12,
    true,
  ];

  async function create() {
    setPhase('working');
    setProgress(0);
    setError(null);
    try {
      const res = await platformApi.post<{ tenant: CreatedDealer }>('/tenants', {
        slug, name: name.trim(), admin: { name: adminName.trim(), email: adminEmail.trim(), password },
      });
      setProgress(WORK.length);
      setCreated(res.tenant);
      setTimeout(() => setPhase('done'), 450);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not create the dealer');
    }
  }

  function finish() {
    const id = created?.id;
    reset();
    onClose();
    if (id) onCreated(id);
  }

  const busy = phase === 'working' && !error;
  const field = 'w-full rounded-xl border border-border bg-card px-3.5 py-2.5 text-sm outline-none transition focus:border-primary/50 focus:ring-4 focus:ring-ring/15';

  return (
    <Drawer
      open={open}
      onClose={() => (phase === 'done' ? finish() : (reset(), onClose()))}
      dismissable={!busy}
      title={phase === 'done' ? 'Dealer created' : 'Add a dealer'}
      subtitle={phase === 'form' ? 'A workspace, its first branch and its first login, created together.' : undefined}
    >
      {phase === 'form' && (
        <>
          {/* Step indicator */}
          <ol className="mb-7 flex items-center gap-2">
            {STEPS.map((label, i) => (
              <li key={label} className="flex flex-1 items-center gap-2">
                <span
                  className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-xs font-bold transition-all duration-300 ${
                    i < step ? 'bg-emerald-500 text-white' : i === step ? 'bg-ink-900 text-white ring-4 ring-ink-900/10' : 'bg-muted text-muted-foreground'
                  }`}
                >
                  {i < step ? <Check className="h-3.5 w-3.5" /> : i + 1}
                </span>
                <span className={`text-xs font-medium ${i === step ? 'text-foreground' : 'text-muted-foreground'}`}>{label}</span>
                {i < STEPS.length - 1 && (
                  <span className="relative h-0.5 flex-1 overflow-hidden rounded bg-muted">
                    <span className="absolute inset-y-0 left-0 bg-emerald-500 transition-all duration-500" style={{ width: i < step ? '100%' : '0%' }} />
                  </span>
                )}
              </li>
            ))}
          </ol>

          <div key={step} className="space-y-4 animate-in fade-in-0 slide-in-from-right-4 duration-300">
            {step === 0 && (
              <>
                <Label text="Dealer name" hint="Printed on their payslips and reports">
                  <input
                    value={name}
                    onChange={(e) => { setName(e.target.value); if (!slugEdited) setSlug(slugify(e.target.value)); }}
                    placeholder="ABC Motors"
                    className={field}
                    autoFocus
                  />
                </Label>
                <Label text="Workspace address" hint="Their sign-in address. Lowercase letters, digits and hyphens — it cannot be changed later.">
                  <input
                    value={slug}
                    onChange={(e) => { setSlug(e.target.value.toLowerCase()); setSlugEdited(true); }}
                    placeholder="abc-motors"
                    className={`${field} font-mono`}
                  />
                </Label>
              </>
            )}
            {step === 1 && (
              <>
                <Label text="Administrator name">
                  <input value={adminName} onChange={(e) => setAdminName(e.target.value)} placeholder="Ravi Kumar" className={field} autoFocus />
                </Label>
                <Label text="Administrator email" hint="What they sign in with">
                  <input type="email" value={adminEmail} onChange={(e) => setAdminEmail(e.target.value)} placeholder="ravi@abcmotors.com" className={field} />
                </Label>
                <Label text="Temporary password" hint="At least 12 characters. Shown once, after creation.">
                  <div className="flex gap-2">
                    <input value={password} onChange={(e) => setPassword(e.target.value)} className={`${field} font-mono`} />
                    <button type="button" onClick={() => setPassword(suggestPassword())} title="New password" className="rounded-xl border border-border px-3 hover:bg-muted">
                      <RefreshCw className="h-4 w-4" />
                    </button>
                  </div>
                </Label>
              </>
            )}
            {step === 2 && (
              <dl className="divide-y divide-border overflow-hidden rounded-2xl border border-border bg-card text-sm">
                <Summary label="Dealer" value={name} />
                <Summary label="Address" value={slug} mono />
                <Summary label="Administrator" value={`${adminName} · ${adminEmail}`} />
                <Summary label="Role" value="Super Admin" />
                <Summary label="Two-step" value="Set up at their first sign-in" />
              </dl>
            )}
          </div>

          <div className="mt-8 flex items-center justify-between">
            <button
              onClick={() => setStep((s) => Math.max(0, s - 1))}
              className={`inline-flex items-center gap-1.5 rounded-xl px-3 py-2.5 text-sm font-medium hover:bg-muted ${step === 0 ? 'invisible' : ''}`}
            >
              <ArrowLeft className="h-4 w-4" /> Back
            </button>
            {step < 2 ? (
              <button
                onClick={() => setStep((s) => s + 1)}
                disabled={!stepValid[step]}
                className="inline-flex items-center gap-1.5 rounded-xl bg-ink-900 px-5 py-2.5 text-sm font-semibold text-white transition hover:bg-ink-950 disabled:opacity-40"
              >
                Next <ArrowRight className="h-4 w-4" />
              </button>
            ) : (
              <button onClick={create} className="inline-flex items-center gap-2 rounded-xl brand-gradient px-5 py-2.5 text-sm font-semibold text-white shadow-brand transition hover:brightness-110">
                Create dealer
              </button>
            )}
          </div>
        </>
      )}

      {phase === 'working' && (
        <div className="py-4">
          <p className="mb-6 text-sm text-muted-foreground">Creating <strong className="text-foreground">{name}</strong>…</p>
          <ol className="space-y-4">
            {WORK.map((label, i) => {
              const state = error && i === Math.min(progress, WORK.length - 1) ? 'failed' : i < progress ? 'done' : i === progress ? 'doing' : 'waiting';
              if (state === 'waiting') return null;
              return (
                <li key={label} className="flex items-center gap-3 animate-step-in">
                  <span
                    className={`flex h-7 w-7 items-center justify-center rounded-full transition-colors duration-300 ${
                      state === 'done' ? 'bg-emerald-500 text-white' : state === 'failed' ? 'bg-rose-500 text-white' : 'bg-muted'
                    }`}
                  >
                    {state === 'done' ? <Check className="h-4 w-4" /> : state === 'failed' ? <X className="h-4 w-4" /> : <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />}
                  </span>
                  <span className={`text-sm ${state === 'doing' ? 'font-medium' : state === 'failed' ? 'text-rose-600' : 'text-muted-foreground'}`}>{label}</span>
                </li>
              );
            })}
          </ol>
          {error && (
            <div className="mt-6 space-y-3 animate-in fade-in-0">
              <p className="rounded-xl bg-destructive/10 px-4 py-3 text-sm text-destructive">{error}</p>
              <button onClick={() => { setPhase('form'); setError(null); }} className="rounded-xl border border-border px-4 py-2.5 text-sm font-medium hover:bg-muted">
                Back to the form
              </button>
            </div>
          )}
        </div>
      )}

      {phase === 'done' && created && (
        <div>
          <div className="relative mx-auto flex w-fit flex-col items-center pt-2">
            <Confetti />
            <SuccessTick size={72} />
          </div>
          <h3 className="mt-5 text-center text-xl font-bold animate-in fade-in-0 slide-in-from-bottom-2 duration-500">{created.name} is ready</h3>
          <p className="mx-auto mt-2 max-w-sm text-center text-sm text-muted-foreground">
            Hand these to the dealer now. <strong className="text-foreground">The password is not stored anywhere</strong> — after
            you close this it can only be reset, not shown again.
          </p>

          <dl className="mt-6 divide-y divide-border overflow-hidden rounded-2xl border border-border bg-card text-sm animate-in fade-in-0 slide-in-from-bottom-3 duration-500">
            <Summary label="Sign in at" value={created.loginUrl} mono />
            <Summary label="Email" value={created.adminEmail} mono />
            <Summary label="Password" value={password} mono />
          </dl>

          <div className="mt-6 flex gap-2">
            <button
              onClick={async () => {
                await navigator.clipboard.writeText(
                  `Workspace: ${created.name}\nSign in: ${created.loginUrl}\nEmail: ${created.adminEmail}\nPassword: ${password}`,
                );
                setCopied(true);
                setTimeout(() => setCopied(false), 2000);
              }}
              className="flex flex-1 items-center justify-center gap-2 rounded-xl bg-emerald-600 px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-emerald-700"
            >
              {copied ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}
              {copied ? 'Copied' : 'Copy details'}
            </button>
            <button onClick={finish} className="flex-1 rounded-xl border border-border px-4 py-2.5 text-sm font-medium hover:bg-muted">
              I have saved these
            </button>
          </div>
        </div>
      )}
    </Drawer>
  );
}

function Label({ text, hint, children }: { text: string; hint?: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="mb-1.5 block text-xs font-semibold text-foreground/80">{text}</span>
      {children}
      {hint && <span className="mt-1.5 block text-xs text-muted-foreground">{hint}</span>}
    </label>
  );
}

function Summary({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1 px-4 py-3">
      <dt className="w-28 shrink-0 text-muted-foreground">{label}</dt>
      <dd className={`min-w-0 flex-1 break-all ${mono ? 'font-mono text-[13px]' : 'font-medium'}`}>{value}</dd>
    </div>
  );
}
