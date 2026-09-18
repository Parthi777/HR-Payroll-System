import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { ArrowLeft, ArrowRight, Check, Info } from 'lucide-react';
import { FEATURES, featureBySlug } from '@/lib/features';
import { SiteHeader } from '@/components/site-header';
import { SiteFooter } from '@/components/site-footer';

/** Static pages, one per feature — no request needs to reach a server to read them. */
export function generateStaticParams() {
  return FEATURES.map((f) => ({ slug: f.slug }));
}

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }): Promise<Metadata> {
  const feature = featureBySlug((await params).slug);
  if (!feature) return { title: 'Not found' };
  return { title: `${feature.name} — HR & Payroll`, description: feature.summary };
}

export default async function FeaturePage({ params }: { params: Promise<{ slug: string }> }) {
  const feature = featureBySlug((await params).slug);
  if (!feature) notFound();

  const others = FEATURES.filter((f) => f.slug !== feature.slug);

  return (
    <main className="min-h-screen bg-background">
      <section className="brand-gradient relative isolate overflow-hidden px-6 pb-20 pt-8 text-white sm:px-10">
        <div aria-hidden className="pointer-events-none absolute inset-0 -z-10">
          <div className="absolute -left-40 -top-40 h-[30rem] w-[30rem] animate-drift rounded-full bg-white/20 blur-3xl" />
          <div className="absolute -bottom-48 right-0 h-[26rem] w-[26rem] animate-drift-slow rounded-full bg-indigo-300/20 blur-3xl" />
        </div>

        <div className="mx-auto max-w-4xl">
          <SiteHeader />

          <div className="py-14">
            <Link href="/features" className="inline-flex items-center gap-1.5 text-sm text-white/75 hover:text-white">
              <ArrowLeft className="h-4 w-4" /> All features
            </Link>
            <div className="mt-6 flex h-14 w-14 items-center justify-center rounded-2xl bg-white/15 ring-1 ring-white/25 backdrop-blur">
              <feature.icon className="h-7 w-7" />
            </div>
            <h1 className="mt-5 max-w-2xl text-3xl font-bold leading-tight tracking-tight sm:text-5xl">
              {feature.tagline}
            </h1>
            <p className="mt-4 max-w-xl text-base leading-relaxed text-white/80">{feature.summary}</p>
          </div>
        </div>
      </section>

      <article className="mx-auto max-w-4xl px-6 py-14 sm:px-10">
        <div className="max-w-2xl space-y-4">
          {feature.intro.map((para) => (
            <p key={para} className="text-base leading-relaxed text-foreground/80">{para}</p>
          ))}
        </div>

        <h2 className="mt-14 text-xl font-bold tracking-tight">How it works</h2>
        <ol className="mt-6 space-y-4">
          {feature.steps.map((step, i) => (
            <li key={step.title} className="flex gap-4 rounded-2xl border border-border bg-card p-5">
              <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-accent text-sm font-bold text-accent-foreground">
                {i + 1}
              </span>
              <div>
                <div className="font-semibold">{step.title}</div>
                <p className="mt-1 text-sm leading-relaxed text-muted-foreground">{step.copy}</p>
              </div>
            </li>
          ))}
        </ol>

        <h2 className="mt-14 text-xl font-bold tracking-tight">The rules it enforces</h2>
        <p className="mt-2 max-w-2xl text-sm text-muted-foreground">
          Defaults the system ships with. Anything marked configurable is set per dealership.
        </p>
        <dl className="mt-6 grid gap-4 sm:grid-cols-2">
          {feature.rules.map((rule) => (
            <div key={rule.title} className="rounded-2xl border border-border bg-card p-5">
              <dt className="font-semibold">{rule.title}</dt>
              <dd className="mt-1 text-sm leading-relaxed text-muted-foreground">{rule.copy}</dd>
            </div>
          ))}
        </dl>

        <div className="mt-14 grid gap-5 sm:grid-cols-2">
          <section className="rounded-2xl border border-border bg-card p-6">
            <h2 className="text-base font-bold">What staff see</h2>
            <ul className="mt-4 space-y-2.5">
              {feature.employee.map((item) => (
                <li key={item} className="flex gap-2.5 text-sm text-foreground/80">
                  <Check className="mt-0.5 h-4 w-4 shrink-0 text-primary" />
                  {item}
                </li>
              ))}
            </ul>
          </section>
          <section className="rounded-2xl border border-border bg-card p-6">
            <h2 className="text-base font-bold">What HR sees</h2>
            <ul className="mt-4 space-y-2.5">
              {feature.admin.map((item) => (
                <li key={item} className="flex gap-2.5 text-sm text-foreground/80">
                  <Check className="mt-0.5 h-4 w-4 shrink-0 text-primary" />
                  {item}
                </li>
              ))}
            </ul>
          </section>
        </div>

        {/* The caveat, in the same size type as the promises. */}
        <aside className="mt-8 flex gap-3 rounded-2xl border border-border bg-secondary/50 p-6">
          <Info className="mt-0.5 h-5 w-5 shrink-0 text-muted-foreground" />
          <div>
            <div className="text-sm font-semibold">What it does not do</div>
            <p className="mt-1 text-sm leading-relaxed text-muted-foreground">{feature.note}</p>
          </div>
        </aside>

        <h2 className="mt-14 text-xl font-bold tracking-tight">The rest of it</h2>
        <ul className="mt-6 grid gap-3 sm:grid-cols-2">
          {others.map((f) => (
            <li key={f.slug}>
              <Link
                href={`/features/${f.slug}`}
                className="group flex items-center gap-3 rounded-2xl border border-border bg-card p-4 transition hover:border-primary/30 hover:shadow-brand"
              >
                <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-accent text-accent-foreground">
                  <f.icon className="h-5 w-5" />
                </span>
                <span className="min-w-0">
                  <span className="block text-sm font-semibold">{f.name}</span>
                  <span className="block truncate text-xs text-muted-foreground">{f.summary}</span>
                </span>
                <ArrowRight className="ml-auto h-4 w-4 shrink-0 text-muted-foreground transition-transform group-hover:translate-x-0.5" />
              </Link>
            </li>
          ))}
        </ul>

        <div className="mt-12 flex flex-col items-center gap-3 rounded-2xl border border-border bg-secondary/50 p-8 text-center">
          <h2 className="text-lg font-bold">Set it up for your dealership</h2>
          <p className="max-w-lg text-sm text-muted-foreground">
            Create a workspace, pick a plan for your headcount, and we will review and activate it.
          </p>
          <div className="mt-2 flex flex-wrap justify-center gap-3">
            <Link
              href="/signup"
              className="flex h-11 items-center gap-2 rounded-xl brand-gradient px-6 text-sm font-semibold text-white shadow-brand transition hover:brightness-110"
            >
              Get started <ArrowRight className="h-4 w-4" />
            </Link>
            <Link
              href="/pricing"
              className="flex h-11 items-center rounded-xl border border-border bg-card px-6 text-sm font-semibold transition hover:bg-muted"
            >
              See pricing
            </Link>
          </div>
        </div>
      </article>

      <SiteFooter />
    </main>
  );
}
