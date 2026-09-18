'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { ShieldCheck, ScanFace, MapPin, Wallet, Clock, MessageSquare, ArrowRight, LogIn } from 'lucide-react';
import { isPlatformHost } from '@/lib/tenant';
import { masterControlHref } from '@/lib/hosts';

/**
 * The public page.
 *
 * A description and a way in, on the bare domain.
 * Master Control can live on its own address (NEXT_PUBLIC_ADMIN_HOST), which
 * is where both links below point once it is set — see src/proxy.ts. The
 * platform console is not linked from here at all.
 */

/** What the product does, in the order a working day uses it. */
const CAPABILITIES = [
  { icon: ScanFace, title: 'Selfie attendance', copy: 'Check-in verified against the enrolled face — nobody clocks in for anyone else.' },
  { icon: MapPin, title: 'GPS geofencing', copy: 'Punches tied to a branch boundary, with every exception raised for sign-off.' },
  { icon: Clock, title: 'Shift monitor', copy: 'Live hours, breaks and overtime against the roster someone is actually on.' },
  { icon: Wallet, title: 'Payroll engine', copy: 'Attendance straight through to net salary, payslips and the bank transfer file.' },
  { icon: MessageSquare, title: 'WhatsApp alerts', copy: 'Check-in confirmations, leave decisions and payslips where staff already read.' },
  { icon: ShieldCheck, title: 'Audited throughout', copy: 'Every approval, correction and payroll run recorded with who did it and when.' },
];

export default function HomePage() {
  const router = useRouter();

  useEffect(() => {
    if (isPlatformHost()) router.replace('/platform');
  }, [router]);

  /**
   * Staggered arrival, as pure CSS.
   *
   * Deliberately NOT gated on a hydration flag. Doing that ships the markup at
   * opacity 0 and waits for React to release it, which means a slow bundle
   * shows a blank page and a failed one shows a blank page forever — on the
   * screen whose whole job is the first impression.
   *
   * `both` holds the keyframe's opening frame during the delay, so an element
   * is invisible only while its own animation is pending and the browser
   * guarantees the end state. With CSS disabled everything simply renders.
   * Under prefers-reduced-motion globals.css collapses these to one frame.
   */
  const rise = (delayMs: number) => ({
    animation: `rise-in 0.7s cubic-bezier(0.22,1,0.36,1) ${delayMs}ms both`,
  });

  return (
    <main className="brand-gradient relative isolate min-h-screen overflow-hidden text-white">
      {/* Ambient depth: two drifting light sources and a masked grid. Decorative
          only, and all of it stops under prefers-reduced-motion. */}
      <div aria-hidden className="pointer-events-none absolute inset-0 -z-10">
        <div className="absolute -left-40 -top-40 h-[34rem] w-[34rem] animate-drift rounded-full bg-white/20 blur-3xl" />
        <div className="absolute -bottom-52 -right-32 h-[32rem] w-[32rem] animate-drift-slow rounded-full bg-indigo-300/20 blur-3xl" />
        <div className="absolute left-1/2 top-1/3 h-[24rem] w-[24rem] -translate-x-1/2 animate-drift-slow rounded-full bg-violet-400/10 blur-3xl" />
        <div
          className="absolute inset-0 opacity-[0.16]
            [background-image:linear-gradient(to_right,rgba(255,255,255,.7)_1px,transparent_1px),linear-gradient(to_bottom,rgba(255,255,255,.7)_1px,transparent_1px)]
            [background-size:56px_56px]
            [mask-image:radial-gradient(ellipse_at_top,black,transparent_75%)]"
        />
      </div>

      <div className="mx-auto flex min-h-screen max-w-6xl flex-col px-6 py-8 sm:px-10 lg:py-12">
        <header className="flex items-center justify-between" style={rise(0)}>
          <div className="flex items-center gap-3">
            <div className="relative flex h-11 w-11 items-center justify-center rounded-2xl bg-white/15 ring-1 ring-white/25 backdrop-blur">
              <span aria-hidden className="absolute inset-0 animate-halo rounded-2xl bg-white/20 blur-md" />
              <ShieldCheck className="relative h-6 w-6" />
            </div>
            <div className="leading-tight">
              <div className="text-sm font-semibold tracking-wide">HR &amp; Payroll</div>
              <div className="text-xs text-white/75">Master Control</div>
            </div>
          </div>
          <Link
            href={masterControlHref('/login')}
            className="flex h-10 items-center gap-2 rounded-xl bg-white/15 px-4 text-sm font-medium ring-1 ring-white/25 backdrop-blur transition hover:bg-white/25"
          >
            <LogIn className="h-4 w-4" /> Sign in
          </Link>
        </header>

        <div className="flex flex-1 flex-col justify-center py-14 lg:py-20">
          <p
            className="inline-flex w-fit items-center gap-2 rounded-full bg-white/12 px-3.5 py-1.5 text-xs font-semibold ring-1 ring-white/20 backdrop-blur"
            style={rise(80)}
          >
            <span className="relative flex h-1.5 w-1.5">
              <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-300 opacity-75" />
              <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-emerald-300" />
            </span>
            Live across every branch
          </p>

          <h1
            className="mt-6 max-w-3xl text-4xl font-bold leading-[1.08] tracking-tight sm:text-5xl lg:text-6xl"
            style={rise(160)}
          >
            Attendance, people and payroll in one place.
          </h1>

          <p className="mt-5 max-w-xl text-base leading-relaxed text-white/75" style={rise(240)}>
            Every check-in verified by face and location. Every salary traced back to the days behind it.
          </p>

          <div className="mt-9 flex flex-wrap gap-3" style={rise(320)}>
            <Link
              href={masterControlHref('/login')}
              className="group relative flex h-12 items-center gap-2 overflow-hidden rounded-xl bg-white px-6 text-sm font-semibold text-brand-600 shadow-brand transition hover:shadow-lg"
            >
              {/* A highlight crossing the button once in a while — the only
                  motion on an interactive element, and it never moves it. */}
              <span aria-hidden className="absolute inset-y-0 -left-full w-1/2 animate-sheen bg-gradient-to-r from-transparent via-brand-100/70 to-transparent" />
              <span className="relative">Open Master Control</span>
              <ArrowRight className="relative h-4 w-4 transition-transform group-hover:translate-x-0.5" />
            </Link>
            {/* No link to the platform console. Every visitor here is a dealer,
                and that sign-in manages every dealer — advertising it to all of
                them buys nothing. Platform staff go to /platform/login directly. */}
          </div>
        </div>

        <ul className="grid gap-4 pb-6 sm:grid-cols-2 lg:grid-cols-3">
          {CAPABILITIES.map((c, i) => (
            <li
              key={c.title}
              // Cards arrive after the headline has landed, one just behind the
              // next, so the grid assembles rather than appearing all at once.
              style={rise(420 + i * 70)}
              className="group rounded-2xl bg-white/[0.07] p-5 ring-1 ring-white/15 backdrop-blur transition duration-300 hover:-translate-y-1 hover:bg-white/[0.12] hover:ring-white/25"
            >
              <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-white/12 ring-1 ring-white/20 transition group-hover:scale-105">
                <c.icon className="h-5 w-5" />
              </div>
              <div className="mt-4 text-sm font-semibold">{c.title}</div>
              <p className="mt-1.5 text-xs leading-relaxed text-white/70">{c.copy}</p>
            </li>
          ))}
        </ul>

        <footer className="border-t border-white/15 pt-5 text-xs text-white/60" style={rise(900)}>
          Access is limited to registered accounts. Every action inside a workspace is audited.
        </footer>
      </div>
    </main>
  );
}
