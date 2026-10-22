'use client';

/**
 * The few chart pieces every monitoring screen shares — a card to hold a chart,
 * the brand palette in chart order, a donut with its legend, and one tooltip
 * style — so the console and Master Control read as one product.
 */
import { Cell, Pie, PieChart, ResponsiveContainer, Tooltip } from 'recharts';

/** Brand first, then distinguishable supporting colours. */
export const CHART = {
  green: '#00A174',
  deep: '#00835E',
  mint: '#9FDCC6',
  gold: '#F0B323',
  ink: '#171C20',
  sky: '#0284C7',
  indigo: '#4F46E5',
  rose: '#E11D48',
  amber: '#B45309',
  slate: '#94A3B8',
};
export const SERIES = [CHART.green, CHART.gold, CHART.sky, CHART.indigo, CHART.rose, CHART.amber, CHART.slate];

export const tooltipStyle = {
  contentStyle: { borderRadius: 12, border: '1px solid #e5e7eb', fontSize: 12, boxShadow: '0 8px 24px -12px rgba(0,0,0,.25)' },
  cursor: { fill: 'rgba(0,161,116,0.06)' },
};
export const axis = { tick: { fontSize: 11, fill: '#6b7280' }, tickLine: false, axisLine: false } as const;

export function ChartCard({
  title, subtitle, action, children, className = '', delay = 0,
}: {
  title: string;
  subtitle?: string;
  action?: React.ReactNode;
  children: React.ReactNode;
  className?: string;
  /** Stagger, in ms, for the entrance. */
  delay?: number;
}) {
  return (
    <section
      className={`rounded-2xl border border-border bg-card p-5 shadow-sm ${className}`}
      style={{ animation: `rise-in 0.6s cubic-bezier(0.22,1,0.36,1) ${delay}ms both` }}
    >
      <div className="mb-4 flex items-start justify-between gap-3">
        <div>
          <h3 className="text-sm font-semibold">{title}</h3>
          {subtitle && <p className="mt-0.5 text-xs text-muted-foreground">{subtitle}</p>}
        </div>
        {action}
      </div>
      {children}
    </section>
  );
}

export function EmptyChart({ text = 'Nothing to show yet', height = 220 }: { text?: string; height?: number }) {
  return (
    <div className="flex items-center justify-center rounded-xl bg-muted/40 text-xs text-muted-foreground" style={{ height }}>
      {text}
    </div>
  );
}

/** A donut with its own legend, for small categorical mixes. */
export function Donut({
  data, height = 180, colors = SERIES, centre,
}: {
  data: { name: string; value: number }[];
  height?: number;
  colors?: string[];
  /** Big number in the middle, e.g. the total. */
  centre?: { value: string; label: string };
}) {
  const shown = data.filter((d) => d.value > 0);
  if (shown.length === 0) return <EmptyChart height={height} />;
  return (
    <div className="flex items-center gap-4">
      <div className="relative shrink-0" style={{ width: height, height }}>
        <ResponsiveContainer width="100%" height="100%">
          <PieChart>
            <Pie data={shown} dataKey="value" nameKey="name" innerRadius="62%" outerRadius="100%" paddingAngle={2} stroke="none">
              {shown.map((d, i) => <Cell key={d.name} fill={colors[i % colors.length]} />)}
            </Pie>
            <Tooltip {...tooltipStyle} />
          </PieChart>
        </ResponsiveContainer>
        {centre && (
          <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center">
            <span className="text-lg font-bold tabular-nums">{centre.value}</span>
            <span className="text-[10px] uppercase tracking-wide text-muted-foreground">{centre.label}</span>
          </div>
        )}
      </div>
      <ul className="min-w-0 space-y-1.5 text-xs">
        {shown.map((d, i) => (
          <li key={d.name} className="flex items-center gap-2">
            <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ background: colors[i % colors.length] }} />
            <span className="truncate text-muted-foreground">{d.name}</span>
            <span className="ml-auto pl-2 font-semibold tabular-nums">{d.value}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}
