import Link from 'next/link';
import { ShieldCheck, LogIn } from 'lucide-react';
import { masterControlHref } from '@/lib/hosts';

/**
 * The public site's header, on the brand gradient.
 *
 * One sign-in link and one way to start — deliberately. Two buttons that both
 * opened the sign-in page made the landing page look like it had two front
 * doors, when the second was the same door.
 */
export function SiteHeader() {
  return (
    <header className="flex items-center justify-between gap-4">
      <Link href="/" className="flex items-center gap-3">
        <div className="relative flex h-11 w-11 items-center justify-center rounded-2xl bg-white/15 ring-1 ring-white/25 backdrop-blur">
          <span aria-hidden className="absolute inset-0 animate-halo rounded-2xl bg-white/20 blur-md" />
          <ShieldCheck className="relative h-6 w-6" />
        </div>
        <div className="leading-tight">
          <div className="text-sm font-semibold tracking-wide">HR &amp; Payroll</div>
          <div className="text-xs text-white/75">Master Control</div>
        </div>
      </Link>

      <nav className="flex items-center gap-1 sm:gap-2">
        <Link href="/features" className="hidden rounded-xl px-3 py-2 text-sm font-medium text-white/85 transition hover:bg-white/10 hover:text-white sm:block">
          Features
        </Link>
        <Link href="/pricing" className="hidden rounded-xl px-3 py-2 text-sm font-medium text-white/85 transition hover:bg-white/10 hover:text-white sm:block">
          Pricing
        </Link>
        <Link
          href={masterControlHref('/login')}
          className="flex h-10 items-center gap-2 rounded-xl px-3 text-sm font-medium text-white/85 transition hover:bg-white/10 hover:text-white"
        >
          <LogIn className="h-4 w-4" /> Sign in
        </Link>
        <Link
          href="/signup"
          className="flex h-10 items-center rounded-xl bg-white px-4 text-sm font-semibold text-brand-600 shadow-brand transition hover:shadow-lg"
        >
          Get started
        </Link>
      </nav>
    </header>
  );
}
