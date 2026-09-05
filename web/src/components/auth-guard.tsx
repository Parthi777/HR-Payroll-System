'use client';

import { useEffect, useState } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import { canAccess, currentRole, landingFor } from '@/lib/permissions';

/**
 * Gate for dashboard pages: signed in, and allowed on this screen.
 *
 * It previously checked only that a token existed, so a cashier could open
 * Payroll or User Access and get a wall of 403s. This sends them to a screen
 * they can actually use instead.
 *
 * Presentation only — the server enforces the same rules on every route, and
 * that is what protects the data.
 */
export function AuthGuard({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const pathname = usePathname();
  const [ready, setReady] = useState(false);

  useEffect(() => {
    if (typeof window === 'undefined') return;

    if (!localStorage.getItem('token')) {
      router.replace('/login');
      return;
    }

    if (!canAccess(pathname)) {
      const role = currentRole();
      // No usable role at all means the stored session is broken — sign out
      // rather than bouncing between screens.
      router.replace(role ? landingFor(role) : '/login');
      return;
    }

    setReady(true);
  }, [router, pathname]);

  if (!ready) return null;
  return <>{children}</>;
}
