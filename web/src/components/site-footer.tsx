import Link from 'next/link';
import { FEATURES } from '@/lib/features';
import { BrandLogo } from '@/components/brand-logo';
import { masterControlHref } from '@/lib/hosts';

/** The public site's footer. Same links on every page, including the landing. */
export function SiteFooter() {
  return (
    <footer className="border-t border-border bg-secondary/40">
      <div className="mx-auto grid max-w-5xl gap-8 px-6 py-12 sm:grid-cols-3">
        <div>
          <BrandLogo height={44} className="-ml-2 h-11 w-auto dark:hidden" />
          <BrandLogo tone="dark" height={44} className="-ml-2 hidden h-11 w-auto dark:block" />
          <p className="mt-2 text-xs leading-relaxed text-muted-foreground">
            Attendance, people and payroll for multi-branch dealerships. Every check-in verified by
            face and location; every salary traced back to the days behind it.
          </p>
        </div>

        <div>
          <div className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">What it does</div>
          <ul className="mt-3 space-y-2 text-sm">
            {FEATURES.map((f) => (
              <li key={f.slug}>
                <Link href={`/features/${f.slug}`} className="text-foreground/80 hover:text-foreground hover:underline">
                  {f.name}
                </Link>
              </li>
            ))}
          </ul>
        </div>

        <div>
          <div className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Get started</div>
          <ul className="mt-3 space-y-2 text-sm">
            <li><Link href="/pricing" className="text-foreground/80 hover:text-foreground hover:underline">Pricing</Link></li>
            <li><Link href="/signup" className="text-foreground/80 hover:text-foreground hover:underline">Create a workspace</Link></li>
            <li>
              <Link href={masterControlHref('/login')} className="text-foreground/80 hover:text-foreground hover:underline">
                Sign in
              </Link>
            </li>
          </ul>
          <p className="mt-4 text-xs text-muted-foreground">
            Access is limited to registered accounts. Every action inside a workspace is audited.
          </p>
        </div>
      </div>
    </footer>
  );
}
