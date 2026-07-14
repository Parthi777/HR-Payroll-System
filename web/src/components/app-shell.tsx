'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import {
  LayoutDashboard,
  Users,
  MapPin,
  Clock,
  CalendarDays,
  Wallet,
  MessageSquare,
  BarChart3,
  Settings,
  Bell,
  Search,
  UserCheck,
  ReceiptText,
  ShieldCheck,
  Menu,
  X,
} from 'lucide-react';
import { LogoutButton } from '@/components/logout-button';

const nav = [
  { href: '/dashboard', label: 'Dashboard', icon: LayoutDashboard },
  { href: '/attendance', label: 'Live Attendance', icon: Clock },
  { href: '/employees', label: 'Employees', icon: Users },
  { href: '/geofence', label: 'Geofence', icon: MapPin },
  { href: '/shifts', label: 'Shifts', icon: Clock },
  { href: '/leaves', label: 'Leaves', icon: CalendarDays },
  { href: '/claims', label: 'Claims', icon: ReceiptText },
  { href: '/payroll', label: 'Payroll', icon: Wallet },
  { href: '/whatsapp', label: 'WhatsApp', icon: MessageSquare },
  { href: '/reports', label: 'Reports', icon: BarChart3 },
  { href: '/access', label: 'User Access', icon: ShieldCheck },
  { href: '/settings', label: 'Settings', icon: Settings },
];

/** Responsive dashboard shell: sticky sidebar on desktop, slide-in drawer on mobile. */
export function AppShell({ children }: { children: React.ReactNode }) {
  const [open, setOpen] = useState(false);
  const pathname = usePathname();

  // Close the drawer whenever navigation happens.
  useEffect(() => setOpen(false), [pathname]);

  return (
    <div className="flex min-h-screen bg-background">
      {/* Mobile backdrop */}
      {open && (
        <div
          className="fixed inset-0 z-40 bg-black/50 md:hidden"
          onClick={() => setOpen(false)}
          aria-hidden
        />
      )}

      {/* Brand sidebar — drawer on mobile, sticky on md+ */}
      <aside
        className={`brand-gradient fixed inset-y-0 left-0 z-50 flex h-full w-64 shrink-0 flex-col p-4 text-white transition-transform duration-200 md:sticky md:top-0 md:h-screen md:translate-x-0 ${
          open ? 'translate-x-0' : '-translate-x-full'
        }`}
      >
        <div className="mb-6 flex items-center gap-3 px-2 pt-2">
          <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-white/15 ring-1 ring-white/25">
            <UserCheck className="h-5 w-5" />
          </div>
          <div className="leading-tight">
            <div className="text-base font-bold tracking-tight">HR &amp; Payroll</div>
            <div className="text-[11px] text-white/70">Master Control</div>
          </div>
          <button
            onClick={() => setOpen(false)}
            className="ml-auto flex h-9 w-9 items-center justify-center rounded-lg bg-white/10 md:hidden"
            aria-label="Close menu"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        <nav className="flex-1 space-y-1 overflow-y-auto">
          {nav.map(({ href, label, icon: Icon }) => {
            const active = pathname?.startsWith(href);
            return (
              <Link
                key={href}
                href={href}
                className={`group flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-medium transition-colors ${
                  active
                    ? 'bg-white/20 text-white'
                    : 'text-white/75 hover:bg-white/15 hover:text-white'
                }`}
              >
                <Icon className="h-[18px] w-[18px]" />
                {label}
              </Link>
            );
          })}
        </nav>

        <div className="mt-4 hidden rounded-2xl bg-white/10 p-4 ring-1 ring-white/15 md:block">
          <div className="text-xs font-semibold">Smart Solutions</div>
          <div className="mt-1 text-[11px] text-white/70">
            Selfie attendance · GPS · WhatsApp · Payroll
          </div>
        </div>
      </aside>

      {/* Main column */}
      <div className="flex min-w-0 flex-1 flex-col">
        <header className="sticky top-0 z-10 flex h-16 items-center gap-3 border-b border-border/60 bg-background/80 px-4 backdrop-blur md:px-8">
          <button
            onClick={() => setOpen(true)}
            className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border border-border bg-card text-muted-foreground hover:text-foreground md:hidden"
            aria-label="Open menu"
          >
            <Menu className="h-5 w-5" />
          </button>

          <div className="relative hidden max-w-md flex-1 sm:block">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <input
              placeholder="Search employees, branches…"
              className="h-10 w-full rounded-xl border border-border bg-card pl-9 pr-3 text-sm outline-none focus:ring-2 focus:ring-ring/40"
            />
          </div>

          <div className="ml-auto flex items-center gap-3">
            <button className="relative flex h-10 w-10 items-center justify-center rounded-xl border border-border bg-card text-muted-foreground hover:text-foreground">
              <Bell className="h-[18px] w-[18px]" />
              <span className="absolute right-2.5 top-2.5 h-2 w-2 rounded-full bg-destructive" />
            </button>
            <LogoutButton />
            <div className="hidden items-center gap-3 sm:flex">
              <div className="h-9 w-9 rounded-full brand-gradient" />
              <div className="hidden leading-tight lg:block">
                <div className="text-sm font-semibold">Admin</div>
                <div className="text-[11px] text-muted-foreground">Super Admin</div>
              </div>
            </div>
          </div>
        </header>

        <main className="flex-1 p-4 md:p-8">{children}</main>
      </div>
    </div>
  );
}
