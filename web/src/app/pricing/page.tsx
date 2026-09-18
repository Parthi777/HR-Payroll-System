import type { Metadata } from 'next';
import Link from 'next/link';
import { ArrowRight, Check } from 'lucide-react';
import { PLANS, rupees } from '@/lib/plans';
import { SiteHeader } from '@/components/site-header';
import { SiteFooter } from '@/components/site-footer';

export const metadata: Metadata = {
  title: 'Pricing — HR & Payroll',
  description: 'Flat monthly plans by dealership size. Starter, Growth and Enterprise.',
};

const FAQ = [
  {
    q: 'How do I know which plan I need?',
    a: 'Count the people you will actually track — active employees on the payroll. Deactivated staff do not count towards the limit, and you can move up a plan at any time.',
  },
  {
    q: 'What happens after I sign up?',
    a: 'Your request reaches us for review, usually the same working day. Once it is approved you pay for the first month, and your workspace opens with your branches, shifts and first admin login ready.',
  },
  {
    q: 'Is there a setup fee?',
    a: 'No. Enterprise includes help with onboarding and moving your existing employee data across; on the other plans you set it up yourself, and the bulk employee import takes an Excel file.',
  },
  {
    q: 'What about GST?',
    a: 'Prices are shown excluding GST, which is added at checkout and appears on your invoice.',
  },
  {
    q: 'Can I cancel?',
    a: 'Yes. Plans are monthly — stop renewing and the workspace closes at the end of the paid month. Your data is exportable while the workspace is open.',
  },
  {
    q: 'Does the price depend on branches?',
    a: 'No. Branches and geofences are unlimited from Growth upwards; Starter covers a single branch. The limit that matters is headcount.',
  },
];

export default function PricingPage() {
  return (
    <main className="min-h-screen bg-background">
      <section className="brand-gradient relative isolate overflow-hidden px-6 pb-24 pt-8 text-white sm:px-10">
        <div aria-hidden className="pointer-events-none absolute inset-0 -z-10">
          <div className="absolute -left-40 -top-40 h-[30rem] w-[30rem] animate-drift rounded-full bg-white/20 blur-3xl" />
          <div className="absolute -bottom-52 right-0 h-[26rem] w-[26rem] animate-drift-slow rounded-full bg-indigo-300/20 blur-3xl" />
        </div>
        <div className="mx-auto max-w-5xl">
          <SiteHeader />
          <div className="mx-auto max-w-2xl py-16 text-center">
            <h1 className="text-3xl font-bold leading-tight tracking-tight sm:text-5xl">
              One monthly price for your size.
            </h1>
            <p className="mt-4 text-base leading-relaxed text-white/80">
              No per-punch charges, no per-branch charges, nothing that grows quietly in the middle
              of a month. Pick the band your headcount falls in.
            </p>
          </div>
        </div>
      </section>

      {/* Cards lift into the gradient above them, the way the app's hero cards do.
          `relative z-10` is load-bearing: the hero above creates its own stacking
          context, so without it the gradient paints over the cards' top edge. */}
      <div className="relative z-10 mx-auto -mt-16 max-w-5xl px-6 sm:px-10">
        <ul className="grid gap-5 lg:grid-cols-3">
          {PLANS.map((plan) => (
            <li
              key={plan.code}
              className={`flex flex-col rounded-2xl border bg-card p-6 shadow-brand ${
                plan.featured ? 'border-primary/40 ring-1 ring-primary/20' : 'border-border'
              }`}
            >
              <div className="flex items-center justify-between gap-2">
                <h2 className="text-lg font-bold">{plan.name}</h2>
                {plan.featured && (
                  <span className="rounded-full bg-accent px-2.5 py-0.5 text-xs font-semibold text-accent-foreground">
                    Most dealerships
                  </span>
                )}
              </div>
              <p className="mt-1 text-sm text-muted-foreground">{plan.blurb}</p>

              <div className="mt-5 flex items-baseline gap-1.5">
                <span className="text-3xl font-bold tracking-tight">{rupees(plan.priceMonthly)}</span>
                <span className="text-sm text-muted-foreground">/ month</span>
              </div>
              <div className="mt-1 text-xs text-muted-foreground">
                excluding GST · {plan.staffLimit ? `up to ${plan.staffLimit} employees` : 'unlimited employees'}
              </div>

              <ul className="mt-6 flex-1 space-y-2.5">
                {plan.highlights.map((h) => (
                  <li key={h} className="flex gap-2.5 text-sm text-foreground/80">
                    <Check className="mt-0.5 h-4 w-4 shrink-0 text-primary" />
                    {h}
                  </li>
                ))}
              </ul>

              <Link
                href={`/signup?plan=${plan.code}`}
                className={`mt-6 flex h-11 items-center justify-center gap-2 rounded-xl text-sm font-semibold transition ${
                  plan.featured
                    ? 'brand-gradient text-white shadow-brand hover:brightness-110'
                    : 'border border-border bg-card hover:bg-muted'
                }`}
              >
                Choose {plan.name} <ArrowRight className="h-4 w-4" />
              </Link>
            </li>
          ))}
        </ul>
      </div>

      <section className="mx-auto max-w-3xl px-6 py-16 sm:px-10">
        <h2 className="text-xl font-bold tracking-tight">Questions worth asking first</h2>
        <dl className="mt-6 space-y-4">
          {FAQ.map((item) => (
            <div key={item.q} className="rounded-2xl border border-border bg-card p-5">
              <dt className="font-semibold">{item.q}</dt>
              <dd className="mt-1.5 text-sm leading-relaxed text-muted-foreground">{item.a}</dd>
            </div>
          ))}
        </dl>
      </section>

      <SiteFooter />
    </main>
  );
}
