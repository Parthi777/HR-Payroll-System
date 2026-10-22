'use client';

/**
 * Small, dependency-free motion for the monitoring screens: numbers that count
 * up, a sparkline, a success tick and a handful of confetti. Each one settles
 * instantly for anyone who has asked their system for reduced motion.
 */
import { useEffect, useRef, useState } from 'react';

const prefersReducedMotion = () =>
  typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;

/** A number easing from its previous value to `target`. */
export function useCountUp(target: number, durationMs = 800): number {
  const [value, setValue] = useState(0);
  const from = useRef(0);
  useEffect(() => {
    if (prefersReducedMotion()) {
      setValue(target);
      from.current = target;
      return;
    }
    const start = performance.now();
    const begin = from.current;
    let frame = 0;
    const tick = (now: number) => {
      const t = Math.min(1, (now - start) / durationMs);
      const eased = 1 - Math.pow(1 - t, 3);
      setValue(begin + (target - begin) * eased);
      if (t < 1) frame = requestAnimationFrame(tick);
      else from.current = target;
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [target, durationMs]);
  return value;
}

export function CountUp({ value, format = (n) => Math.round(n).toLocaleString('en-IN') }: { value: number; format?: (n: number) => string }) {
  return <span className="tabular-nums">{format(useCountUp(value))}</span>;
}

/** A tiny line of the last few days, no axes. */
export function Sparkline({
  values, width = 96, height = 28, color = '#00A174',
}: { values: number[]; width?: number; height?: number; color?: string }) {
  if (values.length < 2) return null;
  const max = Math.max(1, ...values);
  const step = width / (values.length - 1);
  const pts = values.map((v, i) => [i * step, height - 2 - (v / max) * (height - 4)] as const);
  const line = pts.map(([x, y], i) => `${i ? 'L' : 'M'}${x.toFixed(1)},${y.toFixed(1)}`).join(' ');
  const area = `${line} L${width},${height} L0,${height} Z`;
  const id = `spark-${color.replace('#', '')}`;
  return (
    <svg width={width} height={height} viewBox={`0 0 ${width} ${height}`} aria-hidden className="overflow-visible">
      <defs>
        <linearGradient id={id} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={color} stopOpacity={0.28} />
          <stop offset="100%" stopColor={color} stopOpacity={0} />
        </linearGradient>
      </defs>
      <path d={area} fill={`url(#${id})`} />
      <path d={line} fill="none" stroke={color} strokeWidth={1.75} strokeLinejoin="round" strokeLinecap="round" />
      <circle cx={pts[pts.length - 1][0]} cy={pts[pts.length - 1][1]} r={2.5} fill={color} />
    </svg>
  );
}

/** A green circle that lands, and a tick that draws itself across it. */
export function SuccessTick({ size = 64 }: { size?: number }) {
  return (
    <div className="relative" style={{ width: size, height: size }}>
      <div className="absolute inset-0 animate-pop rounded-full bg-emerald-500 shadow-[0_10px_30px_-10px_rgba(0,161,116,.8)]" />
      <svg viewBox="0 0 24 24" className="relative h-full w-full p-[22%]" fill="none" stroke="white" strokeWidth={3} strokeLinecap="round" strokeLinejoin="round">
        <path d="M5 12.5l4.5 4.5L19 7.5" strokeDasharray="48" className="animate-check-draw" />
      </svg>
    </div>
  );
}

const CONFETTI_COLORS = ['#00A174', '#F0B323', '#0284C7', '#E11D48', '#4F46E5', '#00835E'];

/** A short burst from the middle of its parent (which must be `relative`). */
export function Confetti({ pieces = 26 }: { pieces?: number }) {
  if (prefersReducedMotion()) return null;
  return (
    <div aria-hidden className="pointer-events-none absolute inset-0 overflow-visible">
      {Array.from({ length: pieces }, (_, i) => {
        const angle = (i / pieces) * Math.PI * 2;
        const dist = 70 + ((i * 37) % 60);
        const style = {
          '--dx': `${Math.cos(angle) * dist}px`,
          '--dy': `${Math.sin(angle) * dist + 40}px`,
          '--rot': `${(i * 67) % 360}deg`,
          background: CONFETTI_COLORS[i % CONFETTI_COLORS.length],
          animationDelay: `${(i % 5) * 30}ms`,
        } as React.CSSProperties;
        return (
          <span
            key={i}
            className={`absolute left-1/2 top-1/2 animate-confetti ${i % 3 ? 'h-2 w-1 rounded-sm' : 'h-1.5 w-1.5 rounded-full'}`}
            style={style}
          />
        );
      })}
    </div>
  );
}

/** "3 minutes ago", "2 days ago", or a fallback when there is no date. */
export function timeAgo(iso: string | null | undefined, never = 'Never'): string {
  if (!iso) return never;
  const s = Math.max(0, (Date.now() - new Date(iso).getTime()) / 1000);
  if (s < 60) return 'just now';
  const m = s / 60;
  if (m < 60) return `${Math.floor(m)} min ago`;
  const h = m / 60;
  if (h < 24) return `${Math.floor(h)} h ago`;
  const d = h / 24;
  if (d < 30) return `${Math.floor(d)} day${Math.floor(d) === 1 ? '' : 's'} ago`;
  return new Date(iso).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' });
}
