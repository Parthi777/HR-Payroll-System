'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { Button } from '@/components/ui/button';
import { isPlatformHost } from '@/lib/tenant';

/**
 * One deployment serves both audiences, so the landing page decides which.
 *
 * `admin.yourdomain.com` (or `platform.`) is the platform console; anything
 * else is a dealer workspace. The reserved-hostname list that keeps a dealer
 * from claiming "admin" is the same list that identifies it here, so the two
 * can never disagree.
 */
export default function HomePage() {
  const router = useRouter();

  useEffect(() => {
    if (isPlatformHost()) router.replace('/platform');
  }, [router]);

  return (
    <main className="flex min-h-screen flex-col items-center justify-center gap-6 p-8 text-center">
      <h1 className="text-4xl font-bold">AI HR Payroll — Master Control</h1>
      <p className="max-w-xl text-muted-foreground">
        Selfie attendance · GPS geofencing · Shift monitor · WhatsApp automation · Payroll engine
      </p>
      <div className="flex flex-wrap justify-center gap-3">
        <Button asChild>
          <Link href="/dashboard">Open Dashboard →</Link>
        </Button>
        <Button asChild variant="outline">
          <Link href="/platform">Platform Console</Link>
        </Button>
      </div>
    </main>
  );
}
