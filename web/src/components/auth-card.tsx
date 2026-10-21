import Link from 'next/link';
import { ArrowLeft } from 'lucide-react';
import { BrandLogo } from '@/components/brand-logo';

/** The frame for the small pages around sign-in: forgot and reset password. */
export function AuthCard({ title, subtitle, children }: { title: string; subtitle?: string; children: React.ReactNode }) {
  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-4 py-12">
      <div className="w-full max-w-[26rem]">
        <BrandLogo height={40} className="mb-8 h-10 w-auto" />
        <div className="rounded-2xl border border-border bg-card p-6 shadow-sm sm:p-8">
          <h1 className="text-2xl font-bold tracking-tight">{title}</h1>
          {subtitle && <p className="mt-1.5 text-sm text-muted-foreground">{subtitle}</p>}
          <div className="mt-6">{children}</div>
        </div>
        <Link
          href="/login"
          className="mt-6 inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground"
        >
          <ArrowLeft className="h-4 w-4" /> Back to sign in
        </Link>
      </div>
    </div>
  );
}

export const authField =
  'h-12 w-full rounded-xl border border-border bg-background px-4 text-sm outline-none transition ' +
  'placeholder:text-muted-foreground/60 focus:border-primary/40 focus:ring-4 focus:ring-ring/15';

export const authButton =
  'flex h-12 w-full items-center justify-center gap-2 rounded-xl bg-primary text-sm font-semibold text-primary-foreground ' +
  'shadow-brand transition hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-60';
