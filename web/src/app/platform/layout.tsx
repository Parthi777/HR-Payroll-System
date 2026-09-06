'use client';

import { useEffect, useState } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import Link from 'next/link';
import { LogOut, ShieldCheck } from 'lucide-react';
import { clearPlatformSession, platformName, platformToken } from '@/lib/platform-api';

/**
 * Shell for the platform console.
 *
 * Visibly different from the dealer app — dark rather than the brand gradient —
 * because the two are genuinely different systems and confusing them is how
 * someone ends up looking for a dealer's payroll in the wrong place.
 */
export default function PlatformLayout({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const pathname = usePathname();
  const isLogin = pathname === '/platform/login';
  const [ready, setReady] = useState(false);
  const [who, setWho] = useState<string | null>(null);

  useEffect(() => {
    if (isLogin) {
      setReady(true);
      return;
    }
    if (!platformToken()) {
      router.replace('/platform/login');
      return;
    }
    setWho(platformName());
    setReady(true);
  }, [router, isLogin]);

  if (!ready) return null;
  if (isLogin) return <>{children}</>;

  return (
    <div className="min-h-screen bg-slate-50">
      <header className="flex items-center gap-3 bg-slate-900 px-6 py-4 text-white">
        <Link href="/platform" className="flex items-center gap-3">
          <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-white/10">
            <ShieldCheck className="h-5 w-5" />
          </div>
          <div className="leading-tight">
            <div className="text-sm font-bold">Platform Console</div>
            <div className="text-[11px] text-white/60">Dealer onboarding</div>
          </div>
        </Link>

        <nav className="ml-8 hidden items-center gap-1 sm:flex">
          {[
            { href: '/platform', label: 'Dealers' },
            { href: '/platform/users', label: 'Team' },
          ].map((item) => {
            const active = item.href === '/platform' ? pathname === '/platform' : pathname.startsWith(item.href);
            return (
              <Link
                key={item.href}
                href={item.href}
                className={`rounded-lg px-3 py-1.5 text-sm ${active ? 'bg-white/15 font-medium text-white' : 'text-white/70 hover:bg-white/10 hover:text-white'}`}
              >
                {item.label}
              </Link>
            );
          })}
        </nav>

        <div className="ml-auto flex items-center gap-4">
          <Link
            href="/platform/account"
            className="text-sm text-white/80 underline-offset-4 hover:text-white hover:underline"
            title="My account"
          >
            {who ?? 'My account'}
          </Link>
          <button
            onClick={() => {
              clearPlatformSession();
              router.replace('/platform/login');
            }}
            className="flex h-9 w-9 items-center justify-center rounded-lg bg-white/10 hover:bg-white/20"
            title="Sign out"
          >
            <LogOut className="h-[18px] w-[18px]" />
          </button>
        </div>
      </header>

      <main className="mx-auto max-w-5xl p-6">{children}</main>
    </div>
  );
}
