'use client';

import { useRouter } from 'next/navigation';
import { LogOut } from 'lucide-react';
import { clearSession } from '@/lib/tenant';

/** Clears the stored token and returns to the login page. */
export function LogoutButton() {
  const router = useRouter();
  return (
    <button
      onClick={() => {
        // Clears the role and workspace too. Leaving them behind meant the next
        // person to sign in on this browser was briefly gated by — and shown —
        // the previous user's permissions and dealer name.
        clearSession();
        router.replace('/login');
      }}
      className="flex h-10 w-10 items-center justify-center rounded-xl border border-border bg-card text-muted-foreground hover:text-foreground"
      title="Sign out"
    >
      <LogOut className="h-[18px] w-[18px]" />
    </button>
  );
}
