import Link from 'next/link';
import { Button } from '@/components/ui/button';

export default function HomePage() {
  return (
    <main className="flex min-h-screen flex-col items-center justify-center gap-6 p-8 text-center">
      <h1 className="text-4xl font-bold">AI HR Payroll — Master Control</h1>
      <p className="max-w-xl text-muted-foreground">
        Selfie attendance · GPS geofencing · Shift monitor · WhatsApp automation · Payroll engine
      </p>
      <Button asChild>
        <Link href="/dashboard">Open Dashboard →</Link>
      </Button>
    </main>
  );
}
