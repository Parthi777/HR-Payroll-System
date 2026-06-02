'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';

/** Redirects to /login when no admin token is present. Wraps dashboard pages. */
export function AuthGuard({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const [ready, setReady] = useState(false);

  useEffect(() => {
    if (typeof window !== 'undefined' && !localStorage.getItem('token')) {
      router.replace('/login');
    } else {
      setReady(true);
    }
  }, [router]);

  if (!ready) return null;
  return <>{children}</>;
}
