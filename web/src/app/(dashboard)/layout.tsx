import Link from 'next/link';
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
} from 'lucide-react';

const nav = [
  { href: '/dashboard', label: 'Dashboard', icon: LayoutDashboard },
  { href: '/attendance', label: 'Live Attendance', icon: Clock },
  { href: '/employees', label: 'Employees', icon: Users },
  { href: '/geofence', label: 'Geofence', icon: MapPin },
  { href: '/shifts', label: 'Shifts', icon: Clock },
  { href: '/leaves', label: 'Leaves', icon: CalendarDays },
  { href: '/payroll', label: 'Payroll', icon: Wallet },
  { href: '/whatsapp', label: 'WhatsApp', icon: MessageSquare },
  { href: '/reports', label: 'Reports', icon: BarChart3 },
  { href: '/settings', label: 'Settings', icon: Settings },
];

export default function DashboardLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-screen bg-background">
      {/* Brand sidebar */}
      <aside className="brand-gradient sticky top-0 flex h-screen w-64 shrink-0 flex-col p-4 text-white">
        <div className="mb-8 flex items-center gap-3 px-2 pt-2">
          <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-white/15 ring-1 ring-white/25">
            <UserCheck className="h-5 w-5" />
          </div>
          <div className="leading-tight">
            <div className="text-base font-bold tracking-tight">HR &amp; Payroll</div>
            <div className="text-[11px] text-white/70">Master Control</div>
          </div>
        </div>

        <nav className="space-y-1">
          {nav.map(({ href, label, icon: Icon }) => (
            <Link
              key={href}
              href={href}
              className="group flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-medium text-white/75 transition-colors hover:bg-white/15 hover:text-white"
            >
              <Icon className="h-[18px] w-[18px]" />
              {label}
            </Link>
          ))}
        </nav>

        <div className="mt-auto rounded-2xl bg-white/10 p-4 ring-1 ring-white/15">
          <div className="text-xs font-semibold">Smart Solutions</div>
          <div className="mt-1 text-[11px] text-white/70">
            Selfie attendance · GPS · WhatsApp · Payroll
          </div>
        </div>
      </aside>

      {/* Main column */}
      <div className="flex flex-1 flex-col">
        <header className="sticky top-0 z-10 flex h-16 items-center gap-4 border-b border-border/60 bg-background/80 px-8 backdrop-blur">
          <div className="relative flex-1 max-w-md">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <input
              placeholder="Search employees, branches…"
              className="h-10 w-full rounded-xl border border-border bg-card pl-9 pr-3 text-sm outline-none focus:ring-2 focus:ring-ring/40"
            />
          </div>
          <button className="relative flex h-10 w-10 items-center justify-center rounded-xl border border-border bg-card text-muted-foreground hover:text-foreground">
            <Bell className="h-[18px] w-[18px]" />
            <span className="absolute right-2.5 top-2.5 h-2 w-2 rounded-full bg-destructive" />
          </button>
          <div className="flex items-center gap-3">
            <div className="h-9 w-9 rounded-full brand-gradient" />
            <div className="hidden leading-tight sm:block">
              <div className="text-sm font-semibold">Admin</div>
              <div className="text-[11px] text-muted-foreground">Super Admin</div>
            </div>
          </div>
        </header>

        <main className="flex-1 p-8">{children}</main>
      </div>
    </div>
  );
}
