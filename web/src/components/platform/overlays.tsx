'use client';

/** A centred dialog and a right-hand drawer, both animated in, closed by Escape or the backdrop. */
import { useEffect } from 'react';
import { X } from 'lucide-react';

function useEscape(onClose: () => void, enabled: boolean) {
  useEffect(() => {
    if (!enabled) return;
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    const overflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      window.removeEventListener('keydown', onKey);
      document.body.style.overflow = overflow;
    };
  }, [onClose, enabled]);
}

export function Modal({
  open, onClose, children, labelledBy, dismissable = true,
}: {
  open: boolean;
  onClose: () => void;
  children: React.ReactNode;
  labelledBy?: string;
  /** False while something is in flight, so a stray click cannot abandon it. */
  dismissable?: boolean;
}) {
  useEscape(() => dismissable && onClose(), open);
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-ink-950/50 backdrop-blur-[2px] animate-in fade-in-0 duration-200" onClick={() => dismissable && onClose()} />
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby={labelledBy}
        className="relative w-full max-w-md rounded-2xl border border-border bg-card p-6 shadow-2xl animate-in fade-in-0 zoom-in-95 slide-in-from-bottom-2 duration-200"
      >
        {children}
      </div>
    </div>
  );
}

export function Drawer({
  open, onClose, title, subtitle, children, dismissable = true,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  subtitle?: string;
  children: React.ReactNode;
  dismissable?: boolean;
}) {
  useEscape(() => dismissable && onClose(), open);
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50">
      <div className="absolute inset-0 bg-ink-950/50 backdrop-blur-[2px] animate-in fade-in-0 duration-300" onClick={() => dismissable && onClose()} />
      <aside
        role="dialog"
        aria-modal="true"
        aria-label={title}
        className="absolute inset-y-0 right-0 flex w-full max-w-lg flex-col border-l border-border bg-background shadow-2xl animate-in slide-in-from-right duration-300 ease-out"
      >
        <header className="flex items-start justify-between gap-4 border-b border-border px-6 py-5">
          <div>
            <h2 className="text-lg font-bold">{title}</h2>
            {subtitle && <p className="mt-0.5 text-sm text-muted-foreground">{subtitle}</p>}
          </div>
          <button
            onClick={onClose}
            disabled={!dismissable}
            aria-label="Close"
            className="rounded-lg p-1.5 text-muted-foreground hover:bg-muted hover:text-foreground disabled:opacity-40"
          >
            <X className="h-5 w-5" />
          </button>
        </header>
        <div className="flex-1 overflow-y-auto px-6 py-6">{children}</div>
      </aside>
    </div>
  );
}
