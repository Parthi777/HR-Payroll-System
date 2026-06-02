import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'AI HR Payroll — Master Control',
  description: 'Selfie attendance · GPS geofencing · Shift monitor · WhatsApp · Payroll',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className="min-h-screen bg-background antialiased">{children}</body>
    </html>
  );
}
