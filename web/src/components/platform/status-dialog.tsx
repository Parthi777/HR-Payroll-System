'use client';

/**
 * Suspend or resume a dealer — shared by the overview and the dealer page.
 *
 * Suspension signs every one of the dealer's people out on their next request,
 * so the dialog says how many that is and asks for the workspace address to be
 * typed before it will go ahead. Resuming is harmless and needs one click.
 */
import { useState } from 'react';
import { Loader2, Pause, Play, ShieldAlert } from 'lucide-react';
import { platformApi } from '@/lib/platform-api';
import { Modal } from './overlays';
import { SuccessTick } from '@/components/motion';

export interface StatusTarget {
  id: string;
  name: string;
  slug: string;
  status: 'ACTIVE' | 'SUSPENDED';
  staff?: number;
  admins?: number;
}

export function StatusDialog({
  target, onClose, onChanged,
}: {
  target: StatusTarget | null;
  onClose: () => void;
  /** Called after the change lands, with the new status. */
  onChanged: (id: string, status: 'ACTIVE' | 'SUSPENDED') => void;
}) {
  const [typed, setTyped] = useState('');
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const close = () => {
    setTyped('');
    setBusy(false);
    setDone(false);
    setError(null);
    onClose();
  };

  if (!target) return <Modal open={false} onClose={close}>{null}</Modal>;
  const suspending = target.status === 'ACTIVE';
  const next = suspending ? 'SUSPENDED' : 'ACTIVE';
  const canGo = !suspending || typed.trim().toLowerCase() === target.slug;

  async function go() {
    if (!target || !canGo) return;
    setBusy(true);
    setError(null);
    try {
      await platformApi.patch(`/tenants/${target.id}/status`, { status: next });
      setDone(true);
      onChanged(target.id, next);
      setTimeout(close, 1100);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not change the status');
      setBusy(false);
    }
  }

  return (
    <Modal open onClose={close} dismissable={!busy} labelledBy="status-title">
      {done ? (
        <div className="flex flex-col items-center py-6 text-center">
          <SuccessTick />
          <p className="mt-4 font-semibold">{target.name} is {suspending ? 'suspended' : 'active again'}</p>
          <p className="mt-1 text-sm text-muted-foreground">
            {suspending ? 'Its people are signed out on their next request.' : 'Its people can sign in straight away.'}
          </p>
        </div>
      ) : (
        <>
          <div className={`flex h-12 w-12 items-center justify-center rounded-2xl ${suspending ? 'bg-amber-100 text-amber-700' : 'bg-emerald-100 text-emerald-700'}`}>
            {suspending ? <ShieldAlert className="h-6 w-6" /> : <Play className="h-6 w-6" />}
          </div>
          <h2 id="status-title" className="mt-4 text-lg font-bold">
            {suspending ? `Suspend ${target.name}?` : `Resume ${target.name}?`}
          </h2>
          <p className="mt-2 text-sm text-muted-foreground">
            {suspending ? (
              <>
                Everyone at {target.name}
                {target.staff !== undefined && (
                  <> — <strong className="text-foreground">{target.staff} staff</strong>
                    {target.admins !== undefined && <> and <strong className="text-foreground">{target.admins} admin login{target.admins === 1 ? '' : 's'}</strong></>}
                  </>
                )}{' '}
                — is signed out on their next request, and nobody can sign in, punch or be paid through the app until
                you resume it. Their data is kept.
              </>
            ) : (
              <>Their staff and admins can sign in again straight away. Nothing else changes.</>
            )}
          </p>

          {suspending && (
            <label className="mt-5 block">
              <span className="mb-1.5 block text-xs font-semibold text-foreground/80">
                Type <code className="rounded bg-muted px-1 py-0.5">{target.slug}</code> to confirm
              </span>
              <input
                value={typed}
                onChange={(e) => setTyped(e.target.value)}
                autoFocus
                className="w-full rounded-xl border border-border bg-muted/40 px-3 py-2.5 font-mono text-sm outline-none focus:border-amber-500"
                onKeyDown={(e) => e.key === 'Enter' && go()}
              />
            </label>
          )}

          {error && <p className="mt-3 rounded-lg bg-destructive/10 px-3 py-2 text-sm text-destructive">{error}</p>}

          <div className="mt-6 flex justify-end gap-2">
            <button onClick={close} disabled={busy} className="rounded-xl border border-border px-4 py-2.5 text-sm font-medium hover:bg-muted disabled:opacity-60">
              Cancel
            </button>
            <button
              onClick={go}
              disabled={!canGo || busy}
              className={`inline-flex items-center gap-2 rounded-xl px-4 py-2.5 text-sm font-semibold text-white transition disabled:opacity-50 ${
                suspending ? 'bg-amber-600 hover:bg-amber-700' : 'bg-emerald-600 hover:bg-emerald-700'
              }`}
            >
              {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : suspending ? <Pause className="h-4 w-4" /> : <Play className="h-4 w-4" />}
              {suspending ? 'Suspend dealer' : 'Resume dealer'}
            </button>
          </div>
        </>
      )}
    </Modal>
  );
}
