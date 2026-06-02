import { cn } from '@/lib/utils';

/** Gradient page header used across Master Control sub-pages (matches UI reference). */
export function PageHero({
  title,
  subtitle,
  children,
  className,
}: {
  title: string;
  subtitle?: string;
  children?: React.ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cn(
        'brand-gradient flex flex-wrap items-center justify-between gap-4 rounded-2xl p-6 text-white shadow-brand',
        className,
      )}
    >
      <div>
        <h1 className="text-2xl font-bold tracking-tight">{title}</h1>
        {subtitle && <p className="mt-1 text-sm text-white/75">{subtitle}</p>}
      </div>
      {children && <div className="flex items-center gap-2">{children}</div>}
    </div>
  );
}
