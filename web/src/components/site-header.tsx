import Link from 'next/link';
import { LogIn } from 'lucide-react';
import { BrandLogo } from '@/components/brand-logo';
import { masterControlHref } from '@/lib/hosts';

/**
 * The public site's header, on the charcoal brand panel.
 *
 * One sign-in link and one way to start — deliberately. Two buttons that both
 * opened the sign-in page made the landing page look like it had two front
 * doors, when the second was the same door.
 */
export function SiteHeader() {
  return (
    <header className="flex items-center justify-between gap-4">
      <Link href="/" className="flex items-center gap-3" aria-label="Kayaazh Payroll — home">
        {/* Reversed lockup on the charcoal hero; the symbol alone on a phone,
            where the lockup would be narrower than the brand minimum. */}
        <BrandLogo tone="dark" height={48} className="-ml-2 hidden h-12 w-auto sm:block" />
        <BrandLogo variant="symbol" height={40} className="h-10 w-10 sm:hidden" />
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
