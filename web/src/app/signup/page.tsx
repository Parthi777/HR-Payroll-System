'use client';

import { Suspense, useEffect, useState } from 'react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { ArrowRight, Check, Loader2 } from 'lucide-react';
import { PLANS, rupees, type Plan } from '@/lib/plans';
import { WORKSPACE_ADDRESS, publicApi, slugify, type SignupAccepted } from '@/lib/public-api';
import { SiteHeader } from '@/components/site-header';
import { SiteFooter } from '@/components/site-footer';

/**
 * Where a dealership asks for a workspace.
 *
 * It creates a request, not an account: nothing here provisions anything, and
 * the page says so rather than implying an instant login that is not coming.
 * Every field is checked again on the server — this validation is for the
 * person filling it in, not for the system's safety.
 */
export default function SignupPage() {
  return (
    <main className="min-h-screen bg-background">
      <section className="brand-gradient px-6 pb-16 pt-8 text-white sm:px-10">
        <div className="mx-auto max-w-3xl">
          <SiteHeader />
          <div className="py-12">
            <h1 className="text-3xl font-bold leading-tight tracking-tight sm:text-4xl">
              Set up your dealership.
            </h1>
            <p className="mt-3 max-w-xl text-base leading-relaxed text-white/80">
              Tell us who you are and which plan fits. We review every request — usually the same
              working day — and send you a payment link. Your workspace opens once it is paid.
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

function SignupForm() {
  const params = useSearchParams();
  const [plan, setPlan] = useState<Plan['code']>('GROWTH');
  const [companyName, setCompanyName] = useState('');
  const [slug, setSlug] = useState('');
  const [slugEdited, setSlugEdited] = useState(false);
  const [contactName, setContactName] = useState('');
  const [email, setEmail] = useState('');
  const [phone, setPhone] = useState('');
  const [staffCount, setStaffCount] = useState('');
  const [branchCount, setBranchCount] = useState('');
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<SignupAccepted | null>(null);

  // Arriving from a pricing card preselects that plan.
  useEffect(() => {
    const wanted = params.get('plan');
    if (wanted && PLANS.some((p) => p.code === wanted)) setPlan(wanted as Plan['code']);
  }, [params]);

  // The address follows the company name until someone types their own.
  useEffect(() => {
    if (!slugEdited) setSlug(slugify(companyName));
  }, [companyName, slugEdited]);

  const slugLooksWrong = slug.length > 0 && !WORKSPACE_ADDRESS.test(slug);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (slugLooksWrong) return;
    setBusy(true);
    setError(null);
    try {
      setDone(
        await publicApi.post<SignupAccepted>('/signup', {
          companyName: companyName.trim(),
          slug,
          contactName: contactName.trim(),
          email: email.trim(),
          phone: phone.trim(),
          planCode: plan,
          ...(staffCount ? { staffCount: Number(staffCount) } : {}),
          ...(branchCount ? { branchCount: Number(branchCount) } : {}),
          ...(note.trim() ? { note: note.trim() } : {}),
        }),
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not send your request');
    } finally {
      setBusy(false);
    }
  }

  if (done) return <Accepted accepted={done} />;

  return (
    <form onSubmit={submit} className="space-y-8">
      <section>
        <h2 className="text-lg font-bold">Your plan</h2>
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

      <section className="space-y-4">
        <h2 className="text-lg font-bold">Your dealership</h2>

        <label className="block">
          <span className="mb-1.5 block text-xs font-semibold text-foreground/80">Dealership name</span>
          <input value={companyName} onChange={(e) => setCompanyName(e.target.value)} placeholder="Bhavani Motors" className={field} required />
        </label>

        <label className="block">
          <span className="mb-1.5 block text-xs font-semibold text-foreground/80">Workspace address</span>
          <input
            value={slug}
            onChange={(e) => { setSlugEdited(true); setSlug(e.target.value.toLowerCase()); }}
            placeholder="bhavani-motors"
            className={`${field} font-mono`}
            required
          />
          <span className={`mt-1.5 block text-xs ${slugLooksWrong ? 'text-destructive' : 'text-muted-foreground'}`}>
            {slugLooksWrong
              ? 'Lowercase letters, digits and hyphens only — at least two characters.'
              : 'Where your staff sign in. Lowercase letters, digits and hyphens.'}
          </span>
        </label>

        <div className="grid gap-4 sm:grid-cols-2">
          <label className="block">
            <span className="mb-1.5 block text-xs font-semibold text-foreground/80">Employees to track</span>
            <input type="number" min={1} value={staffCount} onChange={(e) => setStaffCount(e.target.value)} placeholder="40" className={field} />
          </label>
          <label className="block">
            <span className="mb-1.5 block text-xs font-semibold text-foreground/80">Branches</span>
            <input type="number" min={1} value={branchCount} onChange={(e) => setBranchCount(e.target.value)} placeholder="2" className={field} />
          </label>
        </div>
      </section>

      <section className="space-y-4">
        <h2 className="text-lg font-bold">Who we should talk to</h2>
        <div className="grid gap-4 sm:grid-cols-2">
          <label className="block">
            <span className="mb-1.5 block text-xs font-semibold text-foreground/80">Your name</span>
            <input value={contactName} onChange={(e) => setContactName(e.target.value)} placeholder="Ravi Kumar" className={field} required />
          </label>
          <label className="block">
            <span className="mb-1.5 block text-xs font-semibold text-foreground/80">Phone</span>
            <input value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="+91 90000 00000" className={field} required />
          </label>
        </div>
        <label className="block">
          <span className="mb-1.5 block text-xs font-semibold text-foreground/80">Email</span>
          <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="you@dealership.com" className={field} required />
          <span className="mt-1.5 block text-xs text-muted-foreground">
            This becomes the first administrator login for your workspace.
          </span>
        </label>
        <label className="block">
          <span className="mb-1.5 block text-xs font-semibold text-foreground/80">Anything we should know (optional)</span>
          <textarea
            value={note}
            onChange={(e) => setNote(e.target.value)}
            rows={3}
            placeholder="Two showrooms and a workshop; night shift for security staff."
            className="w-full rounded-xl border border-border bg-card p-4 text-sm outline-none transition placeholder:text-muted-foreground/60 focus:border-primary/40 focus:ring-4 focus:ring-ring/15"
          />
        </label>
      </section>

      {error && (
        <p role="alert" className="rounded-xl border border-destructive/25 bg-destructive/5 px-4 py-3 text-sm text-destructive">
          {error}
        </p>
      )}

      <div className="flex flex-wrap items-center gap-4">
        <button
          type="submit"
          disabled={busy || slugLooksWrong}
          className="flex h-12 items-center gap-2 rounded-xl brand-gradient px-6 text-sm font-semibold text-white shadow-brand transition hover:brightness-110 disabled:opacity-60"
        >
          {busy && <Loader2 className="h-4 w-4 animate-spin" />}
          {busy ? 'Sending…' : 'Send request'}
          {!busy && <ArrowRight className="h-4 w-4" />}
        </button>
        <span className="text-xs text-muted-foreground">
          No payment now. Nothing is charged until we approve and you choose to pay.
        </span>
      </div>
    </form>
  );
}

/** What happens next, in the order it happens. */
function Accepted({ accepted }: { accepted: SignupAccepted }) {
  return (
    <div className="rounded-2xl border-2 border-emerald-500/40 bg-emerald-50 p-8">
      <div className="flex items-center gap-2 text-emerald-900">
        <Check className="h-5 w-5" />
        <h2 className="text-lg font-bold">Request received</h2>
      </div>
      <p className="mt-2 text-sm text-emerald-900/90">
        Thank you — we have your request for <strong>{accepted.companyName}</strong>. Quote{' '}
        <span className="font-mono font-semibold">{accepted.reference}</span> if you call us about it.
      </p>

      <ol className="mt-6 space-y-3 text-sm text-emerald-900/90">
        {[
          'We review the request, usually the same working day.',
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
