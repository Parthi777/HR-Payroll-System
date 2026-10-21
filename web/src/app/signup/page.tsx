'use client';

import { Suspense, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import Script from 'next/script';
import { useSearchParams } from 'next/navigation';
import { ArrowRight, Check, Loader2, MailCheck } from 'lucide-react';
import { PLANS, rupees, type Plan } from '@/lib/plans';
import { ApiError } from '@/lib/api';
import { publicApi, type SignupAccepted } from '@/lib/public-api';
import { SiteHeader } from '@/components/site-header';
import { SiteFooter } from '@/components/site-footer';

/**
 * Where a dealership asks for a workspace.
 *
 * It creates a request, not an account: nothing here provisions anything, and
 * the page says so rather than implying an instant login that is not coming —
 * the team calls to confirm, then sends the payment link.
 *
 * "Sign up with Google" supplies the email, so it is known to be theirs; the
 * server takes the address from Google's signed token, never from this page.
 * Without Google (or by choice) the address is typed instead.
 * Every field is checked again on the server — this validation is for the
 * person filling it in, not for the system's safety.
 */
export default function SignupPage() {
  return (
    <main className="min-h-screen bg-background">
      <section className="brand-panel px-6 pb-16 pt-8 text-white sm:px-10">
        <div className="mx-auto max-w-3xl">
          <SiteHeader />
          <div className="py-12">
            <h1 className="text-3xl font-bold leading-tight tracking-tight sm:text-4xl">
              Set up your dealership.
            </h1>
            <p className="mt-3 max-w-xl text-base leading-relaxed text-white/80">
              Sign up with Google and tell us about your organisation. Our team will contact you to
              confirm — usually the same working day — and your workspace opens once that is done.
            </p>
          </div>
        </div>
      </section>

      <div className="mx-auto max-w-3xl px-6 py-12 sm:px-10">
        <Suspense fallback={<div className="text-sm text-muted-foreground">Loading…</div>}>
          <SignupForm />
        </Suspense>
      </div>

      <SiteFooter />
    </main>
  );
}

const field =
  'h-12 w-full rounded-xl border border-border bg-card px-4 text-sm outline-none transition ' +
  'placeholder:text-muted-foreground/60 focus:border-primary/40 focus:ring-4 focus:ring-ring/15';

/** The same Web OAuth client the platform console signs in with. Build-time. */
const GOOGLE_CLIENT_ID = process.env.NEXT_PUBLIC_GOOGLE_CLIENT_ID;

/** An Indian GSTIN — checked again on the server. */
const GSTIN = /^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z][1-9A-Z]Z[0-9A-Z]$/;

/**
 * The name and address inside a Google ID token, for showing on this page only.
 * Not verified here and not trusted: the server checks the token itself.
 */
function readGoogleToken(credential: string): { email?: string; name?: string } {
  try {
    const part = credential.split('.')[1].replace(/-/g, '+').replace(/_/g, '/');
    const json = decodeURIComponent(
      atob(part).split('').map((c) => `%${c.charCodeAt(0).toString(16).padStart(2, '0')}`).join(''),
    );
    return JSON.parse(json) as { email?: string; name?: string };
  } catch {
    return {};
  }
}

/** What the confirmation names back to them. */
type Accepted = SignupAccepted & { email: string; phone: string };

function SignupForm() {
  const params = useSearchParams();
  const [plan, setPlan] = useState<Plan['code']>('GROWTH');
  const [companyName, setCompanyName] = useState('');
  const [gstNumber, setGstNumber] = useState('');
  const [contactName, setContactName] = useState('');
  const [phone, setPhone] = useState('');
  const [staffCount, setStaffCount] = useState('');
  /** From "Sign up with Google": the token, and the address it names. */
  const [google, setGoogle] = useState<{ credential: string; email: string } | null>(null);
  /** Typed instead — when Google is not set up, or they would rather not use it. */
  const [typing, setTyping] = useState(!GOOGLE_CLIENT_ID);
  const [email, setEmail] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<Accepted | null>(null);
  const googleDiv = useRef<HTMLDivElement>(null);
  const [gsiReady, setGsiReady] = useState(false);

  // Arriving from a pricing card preselects that plan.
  useEffect(() => {
    const wanted = params.get('plan');
    if (wanted && PLANS.some((p) => p.code === wanted)) setPlan(wanted as Plan['code']);
  }, [params]);

  // Draw Google's own button whenever there is no Google address yet.
  useEffect(() => {
    if (!gsiReady || !GOOGLE_CLIENT_ID || !window.google || !googleDiv.current || google || typing) return;
    window.google.accounts.id.initialize({
      client_id: GOOGLE_CLIENT_ID,
      callback: ({ credential }) => {
        const claims = readGoogleToken(credential);
        if (!claims.email) return setError('Google did not share an email address — enter it instead.');
        setError(null);
        setGoogle({ credential, email: claims.email });
        if (claims.name) setContactName((current) => current || claims.name!);
      },
    });
    window.google.accounts.id.renderButton(googleDiv.current, {
      theme: 'outline', size: 'large', width: 320, text: 'signup_with',
    });
  }, [gsiReady, google, typing]);

  const gstLooksWrong = gstNumber.length > 0 && !GSTIN.test(gstNumber);
  const haveEmail = Boolean(google) || (typing && email.trim().length > 0);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (gstLooksWrong) return;
    if (!haveEmail) return setError('Sign up with Google first, or enter your email.');
    setBusy(true);
    setError(null);
    try {
      const accepted = await publicApi.post<SignupAccepted>('/signup', {
        companyName: companyName.trim(),
        contactName: contactName.trim(),
        phone: phone.trim(),
        gstNumber,
        planCode: plan,
        ...(google ? { googleCredential: google.credential } : { email: email.trim() }),
        ...(staffCount ? { staffCount: Number(staffCount) } : {}),
      });
      setDone({ ...accepted, email: google?.email ?? email.trim(), phone: phone.trim() });
    } catch (err) {
      // Google's token lasts an hour; past that, ask them to choose the account again.
      if (google && err instanceof ApiError && err.status === 401) setGoogle(null);
      setError(err instanceof Error ? err.message : 'Could not send your request');
    } finally {
      setBusy(false);
    }
  }

  if (done) return <Accepted accepted={done} />;

  return (
    <form onSubmit={submit} className="space-y-8">
      {GOOGLE_CLIENT_ID && <Script src="https://accounts.google.com/gsi/client" onReady={() => setGsiReady(true)} />}

      <section>
        <h2 className="text-lg font-bold">1. Your email</h2>
        <p className="mt-1 text-sm text-muted-foreground">
          This becomes the first administrator login for your workspace.
        </p>
        <div className="mt-4">
          {google ? (
            <div className="flex flex-wrap items-center gap-3 rounded-2xl border border-primary/30 bg-accent/60 px-4 py-3">
              <MailCheck className="h-5 w-5 text-primary" />
              <span className="text-sm">
                Signed up with Google as <strong>{google.email}</strong>
              </span>
              <button
                type="button"
                onClick={() => setGoogle(null)}
                className="ml-auto text-xs font-semibold text-primary underline-offset-2 hover:underline"
              >
                Use a different account
              </button>
            </div>
          ) : typing ? (
            <>
              <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="you@dealership.com" className={field} required />
              {GOOGLE_CLIENT_ID && (
                <button type="button" onClick={() => setTyping(false)} className="mt-2 text-xs font-semibold text-primary underline-offset-2 hover:underline">
                  Sign up with Google instead
                </button>
              )}
            </>
          ) : (
            <>
              <div ref={googleDiv} className="flex min-h-[44px] [color-scheme:light]" />
              <button type="button" onClick={() => setTyping(true)} className="mt-3 text-xs text-muted-foreground underline-offset-2 hover:text-foreground hover:underline">
                No Google account? Enter your email instead
              </button>
            </>
          )}
        </div>
      </section>

      <section className="space-y-4">
        <h2 className="text-lg font-bold">2. About you</h2>
        <div className="grid gap-4 sm:grid-cols-2">
          <label className="block">
            <span className="mb-1.5 block text-xs font-semibold text-foreground/80">Your name</span>
            <input value={contactName} onChange={(e) => setContactName(e.target.value)} placeholder="Ravi Kumar" className={field} required />
          </label>
          <label className="block">
            <span className="mb-1.5 block text-xs font-semibold text-foreground/80">Contact number</span>
            <input type="tel" value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="+91 90000 00000" className={field} required />
          </label>
        </div>
      </section>

      <section className="space-y-4">
        <h2 className="text-lg font-bold">3. Your organisation</h2>
        <label className="block">
          <span className="mb-1.5 block text-xs font-semibold text-foreground/80">Organisation name</span>
          <input value={companyName} onChange={(e) => setCompanyName(e.target.value)} placeholder="Bhavani Motors" className={field} required />
        </label>
        <div className="grid gap-4 sm:grid-cols-2">
          <label className="block">
            <span className="mb-1.5 block text-xs font-semibold text-foreground/80">GST number</span>
            <input
              value={gstNumber}
              onChange={(e) => setGstNumber(e.target.value.toUpperCase().replace(/\s+/g, ''))}
              placeholder="33ABCDE1234F1Z5"
              maxLength={15}
              className={`${field} font-mono uppercase`}
              required
            />
            {gstLooksWrong && (
              <span className="mt-1.5 block text-xs text-destructive">A GST number is 15 characters, e.g. 33ABCDE1234F1Z5.</span>
            )}
          </label>
          <label className="block">
            <span className="mb-1.5 block text-xs font-semibold text-foreground/80">Employees to track (optional)</span>
            <input type="number" min={1} value={staffCount} onChange={(e) => setStaffCount(e.target.value)} placeholder="40" className={field} />
          </label>
        </div>
      </section>

      <section>
        <h2 className="text-lg font-bold">4. Your plan</h2>
        <p className="mt-1 text-sm text-muted-foreground">
          Based on how many people you will track. You can move up later.
        </p>
        <div className="mt-4 grid gap-3 sm:grid-cols-3">
          {PLANS.map((p) => (
            <label
              key={p.code}
              className={`cursor-pointer rounded-2xl border p-4 transition ${
                plan === p.code ? 'border-primary bg-accent/60 ring-1 ring-primary/30' : 'border-border bg-card hover:bg-muted/50'
              }`}
            >
              <input
                type="radio"
                name="plan"
                value={p.code}
                checked={plan === p.code}
                onChange={() => setPlan(p.code)}
                className="sr-only"
              />
              <div className="flex items-center justify-between">
                <span className="font-semibold">{p.name}</span>
                {plan === p.code && <Check className="h-4 w-4 text-primary" />}
              </div>
              <div className="mt-1 text-sm font-semibold">{rupees(p.priceMonthly)}<span className="text-xs font-normal text-muted-foreground"> / month</span></div>
              <div className="mt-1 text-xs text-muted-foreground">
                {p.staffLimit ? `up to ${p.staffLimit} employees` : 'unlimited employees'}
              </div>
            </label>
          ))}
        </div>
      </section>

      {error && (
        <p role="alert" className="rounded-xl border border-destructive/25 bg-destructive/5 px-4 py-3 text-sm text-destructive">
          {error}
        </p>
      )}

      <div className="flex flex-wrap items-center gap-4">
        <button
          type="submit"
          disabled={busy || gstLooksWrong || !haveEmail}
          className="flex h-12 items-center gap-2 rounded-xl brand-gradient px-6 text-sm font-semibold text-white shadow-brand transition hover:brightness-110 disabled:opacity-60"
        >
          {busy && <Loader2 className="h-4 w-4 animate-spin" />}
          {busy ? 'Sending…' : 'Sign up'}
          {!busy && <ArrowRight className="h-4 w-4" />}
        </button>
        <span className="text-xs text-muted-foreground">
          No payment now. Our team contacts you first.
        </span>
      </div>
    </form>
  );
}

/** What happens next, in the order it happens. */
function Accepted({ accepted }: { accepted: Accepted }) {
  return (
    <div className="rounded-2xl border-2 border-emerald-500/40 bg-emerald-50 p-8">
      <div className="flex items-center gap-2 text-emerald-900">
        <Check className="h-5 w-5" />
        <h2 className="text-lg font-bold">Thank you — you&rsquo;re signed up</h2>
      </div>
      <p className="mt-2 text-sm text-emerald-900/90">
        We have your request for <strong>{accepted.companyName}</strong>.{' '}
        <strong>Please wait for our team to contact you</strong> on {accepted.phone} or {accepted.email} to
        confirm. Quote <span className="font-mono font-semibold">{accepted.reference}</span> if you call us.
      </p>

      <ol className="mt-6 space-y-3 text-sm text-emerald-900/90">
        {[
          'Our team contacts you to confirm your details — usually the same working day.',
          'You get a payment link for the first month, with your plan and the exact amount.',
          'Once it is paid your workspace opens, and we send your administrator login.',
          'You add branches, shifts and employees — or we help, on Enterprise.',
        ].map((step, i) => (
          <li key={step} className="flex gap-3">
            <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-emerald-600 text-xs font-bold text-white">
              {i + 1}
            </span>
            {step}
          </li>
        ))}
      </ol>

      <div className="mt-8 flex flex-wrap gap-3">
        <Link href="/features" className="rounded-xl border border-emerald-600/30 px-4 py-2.5 text-sm font-semibold text-emerald-900">
          Read what it does
        </Link>
        <Link href="/" className="rounded-xl px-4 py-2.5 text-sm font-semibold text-emerald-900 hover:underline">
          Back to the home page
        </Link>
      </div>
    </div>
  );
}
