import type { Metadata } from 'next';
import Link from 'next/link';
import { ArrowRight } from 'lucide-react';
import { FEATURES } from '@/lib/features';
import { SiteHeader } from '@/components/site-header';
import { SiteFooter } from '@/components/site-footer';

export const metadata: Metadata = {
  title: 'What it does — HR & Payroll',
  description:
    'Selfie attendance, GPS geofencing, shift monitoring, payroll, WhatsApp alerts and a full audit trail — what each one actually does.',
};

/** The index of the feature pages: one card each, straight through to the detail. */
export default function FeaturesPage() {
  return (
    <main className="min-h-screen bg-background">
      <section className="brand-gradient relative isolate overflow-hidden px-6 pb-20 pt-8 text-white sm:px-10">
        <div aria-hidden className="pointer-events-none absolute inset-0 -z-10">
          <div className="absolute -left-40 -top-40 h-[30rem] w-[30rem] animate-drift rounded-full bg-white/20 blur-3xl" />
          <div className="absolute -bottom-52 right-0 h-[26rem] w-[26rem] animate-drift-slow rounded-full bg-indigo-300/20 blur-3xl" />
        </div>
        <div className="mx-auto max-w-5xl">
          <SiteHeader />
          <div className="mx-auto max-w-2xl py-16 text-center">
            <h1 className="text-3xl font-bold leading-tight tracking-tight sm:text-5xl">
              Six things, each doing its job properly.
            </h1>
            <p className="mt-4 text-base leading-relaxed text-white/80">
              No module list. Open any one of them and you will find what it checks, what it
              refuses, the defaults it ships with, and what it does not do.
            </p>
          </div>
        </div>
      </section>

      <div className="mx-auto max-w-5xl px-6 py-14 sm:px-10">
        <ul className="grid gap-5 sm:grid-cols-2">
          {FEATURES.map((f) => (
            <li key={f.slug}>
              <Link
                href={`/features/${f.slug}`}
                className="group flex h-full flex-col rounded-2xl border border-border bg-card p-6 transition hover:-translate-y-0.5 hover:border-primary/30 hover:shadow-brand"
              >
                <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-accent text-accent-foreground">
                  <f.icon className="h-5 w-5" />
                </div>
                <div className="mt-4 text-base font-bold">{f.name}</div>
                <p className="mt-1.5 text-sm leading-relaxed text-muted-foreground">{f.summary}</p>
                <span className="mt-4 inline-flex items-center gap-1.5 text-sm font-semibold text-primary">
                  Explore
                  <ArrowRight className="h-4 w-4 transition-transform group-hover:translate-x-0.5" />
                </span>
              </Link>
            </li>
          ))}
        </ul>

        <div className="mt-12 flex flex-col items-center gap-3 rounded-2xl border border-border bg-secondary/50 p-8 text-center">
          <h2 className="text-lg font-bold">Ready to set it up for your dealership?</h2>
          <p className="max-w-lg text-sm text-muted-foreground">
            Create a workspace, tell us about your branches, and pick the plan that fits your headcount.
          </p>
          <Link
            href="/signup"
            className="mt-2 flex h-11 items-center gap-2 rounded-xl brand-gradient px-6 text-sm font-semibold text-white shadow-brand transition hover:brightness-110"
          >
            Get started <ArrowRight className="h-4 w-4" />
          </Link>
        </div>
      </div>

      <SiteFooter />
    </main>
  );
}
