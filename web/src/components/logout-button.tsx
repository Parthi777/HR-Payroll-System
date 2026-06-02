'use client';

import { useRouter } from 'next/navigation';
import { LogOut } from 'lucide-react';

/** Clears the stored token and returns to the login page. */
export function LogoutButton() {
  const router = useRouter();
  return (
    <button
      onClick={() => {
        localStorage.removeItem('token');
        localStorage.removeItem('adminName');
        router.replace('/login');
      }}
      className="flex h-10 w-10 items-center justify-center rounded-xl border border-border bg-card text-muted-foreground hover:text-foreground"
      title="Sign out"
    >
      <LogOut className="h-[18px] w-[18px]" />
    </button>
  );
}
