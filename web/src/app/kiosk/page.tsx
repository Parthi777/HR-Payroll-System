'use client';

import { useCallback, useEffect, useState } from 'react';
import { AlertCircle, ArrowRight, Check, Clock, Delete, Loader2, LogIn, LogOut, ShieldCheck } from 'lucide-react';
import {
  forgetKiosk,
  kioskApi,
  kioskToken,
  saveKioskToken,
  type EmployeeLookup,
  type KioskSession,
  type PairedKiosk,
  type PunchResult,
} from '@/lib/kiosk-api';
import { LivenessCheck } from '@/components/kiosk/liveness-check';
import { CameraCapture } from '@/components/kiosk/camera-capture';

/**
 * The branch kiosk: a tablet by the door that staff punch on.
 *
 * Built for someone standing up, in a hurry, possibly with oily hands: big
 * targets, one question per screen, and every screen returns to the keypad by
 * itself so the tablet is never left mid-punch showing the last person's name.
 *
 * It shows a person their own name and nothing else about them. A shared screen
 * in a showroom is not the place for anyone's attendance history or salary.
 */
type Stage =
  | { kind: 'code' }
  | { kind: 'confirm'; found: EmployeeLookup }
  | { kind: 'capture'; found: EmployeeLookup }
  | { kind: 'done'; result: PunchResult };

export default function KioskPage() {
  const [session, setSession] = useState<KioskSession | null>(null);
  const [checking, setChecking] = useState(true);

  useEffect(() => {
    if (!kioskToken()) return setChecking(false);
    kioskApi
      .get<KioskSession>('/session')
      .then(setSession)
      .catch(() => forgetKiosk())
      .finally(() => setChecking(false));
  }, []);

  if (checking) {
    return (
      <main className="flex min-h-screen items-center justify-center bg-slate-950 text-white/70">
        <Loader2 className="h-6 w-6 animate-spin" />
      </main>
    );
  }

  if (!session) return <PairScreen onPaired={setSession} />;
  return <PunchScreen session={session} />;
}

/** Pairing: done once, by an administrator standing at the tablet. */
function PairScreen({ onPaired }: { onPaired: (s: KioskSession) => void }) {
  const [workspace, setWorkspace] = useState('');
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const paired = await kioskApi.post<PairedKiosk>('/pair', { workspace: workspace.trim().toLowerCase(), code: code.trim() });
      saveKioskToken(paired.token);
      onPaired(paired);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not pair this tablet');
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="flex min-h-screen items-center justify-center bg-slate-950 p-6 text-white">
      <form onSubmit={submit} className="w-full max-w-sm">
        <div className="mb-8 flex flex-col items-center text-center">
          <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-white/10 ring-1 ring-white/20">
            <ShieldCheck className="h-7 w-7" />
          </div>
          <h1 className="mt-4 text-xl font-bold">Set up this tablet</h1>
          <p className="mt-1 text-sm text-white/60">
            Create a kiosk in Master Control under Kiosks, then type its pairing code here.
          </p>
        </div>

        <label className="mb-1.5 block text-xs font-semibold text-white/70">Workspace address</label>
        <input
          value={workspace}
          onChange={(e) => setWorkspace(e.target.value)}
          placeholder="bhavani-motors"
          autoCapitalize="none"
          className="mb-5 h-14 w-full rounded-2xl border border-white/15 bg-white/5 px-4 font-mono text-lg outline-none focus:border-white/40"
          required
        />

        <label className="mb-1.5 block text-xs font-semibold text-white/70">Pairing code</label>
        <input
          value={code}
          onChange={(e) => setCode(e.target.value.toUpperCase())}
          placeholder="ABCD-EFGH"
          autoCapitalize="characters"
          className="h-14 w-full rounded-2xl border border-white/15 bg-white/5 px-4 text-center font-mono text-2xl tracking-[0.2em] outline-none focus:border-white/40"
          required
        />

        {error && (
          <p role="alert" className="mt-4 flex items-start gap-2 rounded-xl bg-rose-500/15 px-4 py-3 text-sm text-rose-200">
            <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" /> {error}
          </p>
        )}

        <button
          type="submit"
          disabled={busy}
          className="mt-6 flex h-14 w-full items-center justify-center gap-2 rounded-2xl bg-white text-base font-semibold text-slate-900 disabled:opacity-60"
        >
          {busy ? <Loader2 className="h-5 w-5 animate-spin" /> : <ArrowRight className="h-5 w-5" />}
          {busy ? 'Pairing…' : 'Pair this tablet'}
        </button>

        <p className="mt-6 text-center text-xs text-white/40">
          The code works once and expires after 30 minutes.
        </p>
      </form>
    </main>
  );
}

function PunchScreen({ session }: { session: KioskSession }) {
  const [stage, setStage] = useState<Stage>({ kind: 'code' });
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [now, setNow] = useState<Date | null>(null);

  // Rendered after mount only: a clock in the server's markup would disagree
  // with the browser's and break hydration.
  useEffect(() => {
    setNow(new Date());
    const tick = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(tick);
  }, []);

  const reset = useCallback(() => {
    setStage({ kind: 'code' });
    setCode('');
    setError(null);
    setBusy(false);
  }, []);

  // Nobody presses "done" on a kiosk; it clears itself.
  useEffect(() => {
    if (stage.kind !== 'done') return;
    const back = setTimeout(reset, 6000);
    return () => clearTimeout(back);
  }, [stage, reset]);

  async function lookup() {
    if (!code.trim()) return;
    setBusy(true);
    setError(null);
    try {
      setStage({ kind: 'confirm', found: await kioskApi.post<EmployeeLookup>('/lookup', { code: code.trim() }) });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'That code was not recognised');
      setCode('');
    } finally {
      setBusy(false);
    }
  }

  async function punch(found: EmployeeLookup, body: { sessionId?: string; photo?: Blob }) {
    setBusy(true);
    setError(null);
    try {
      const form = new FormData();
      form.append('employeeId', found.employee.id);
      if (body.sessionId) form.append('livenessSessionId', body.sessionId);
      if (body.photo) form.append('selfie', body.photo, 'selfie.jpg');
      setStage({ kind: 'done', result: await kioskApi.upload<PunchResult>('/punch', form) });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'That did not go through');
      setStage({ kind: 'code' });
      setCode('');
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="min-h-screen bg-slate-950 p-6 text-white">
      <div className="mx-auto flex min-h-[calc(100vh-3rem)] max-w-xl flex-col">
        <header className="flex items-center justify-between border-b border-white/10 pb-4">
          <div>
            <div className="text-sm font-semibold">{session.branch.name}</div>
            <div className="text-xs text-white/50">{session.device.name}</div>
          </div>
          <div className="text-right">
            <div className="font-mono text-2xl font-bold tabular-nums">
              {now ? now.toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' }) : '--:--'}
            </div>
            <div className="text-xs text-white/50">
              {now ? now.toLocaleDateString('en-IN', { weekday: 'short', day: 'numeric', month: 'short' }) : ''}
            </div>
          </div>
        </header>

        <div className="flex flex-1 flex-col justify-center py-8">
          {error && (
            <p role="alert" className="mb-6 flex items-start gap-2 rounded-2xl bg-rose-500/15 px-4 py-3 text-sm text-rose-200">
              <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" /> {error}
            </p>
          )}

          {stage.kind === 'code' && (
            <Keypad code={code} onChange={setCode} onSubmit={lookup} busy={busy} />
          )}

          {stage.kind === 'confirm' && (
            <div className="text-center">
              <div className="text-sm text-white/60">{stage.found.employee.code}</div>
              <h1 className="mt-1 text-3xl font-bold">{stage.found.employee.name}</h1>
              {stage.found.checkedInAt && (
                <p className="mt-2 inline-flex items-center gap-1.5 text-sm text-white/60">
                  <Clock className="h-4 w-4" />
                  In since {new Date(stage.found.checkedInAt).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' })}
                </p>
              )}

              <button
                type="button"
                onClick={() => setStage({ kind: 'capture', found: stage.found })}
                className={`mt-8 flex h-20 w-full items-center justify-center gap-3 rounded-2xl text-xl font-bold text-white shadow-brand ${
                  stage.found.nextAction === 'IN' ? 'bg-emerald-600' : 'bg-slate-700'
                }`}
              >
                {stage.found.nextAction === 'IN' ? <LogIn className="h-7 w-7" /> : <LogOut className="h-7 w-7" />}
                {stage.found.nextAction === 'IN' ? 'Check in' : 'Check out'}
              </button>
              <button type="button" onClick={reset} className="mt-4 w-full py-3 text-sm text-white/50">
                Not you? Start again
              </button>
            </div>
          )}

          {stage.kind === 'capture' && (
            <div>
              <p className="mb-5 text-center text-lg font-semibold">
                {stage.found.employee.name}, look at the camera
              </p>
              {session.liveness.enabled ? (
                <LivenessCheck
                  onFinished={(sessionId) => punch(stage.found, { sessionId })}
                  onCancel={reset}
                  onError={(message) => { setError(message); setStage({ kind: 'confirm', found: stage.found }); }}
                />
              ) : (
                <CameraCapture
                  busy={busy}
                  onCapture={(photo) => punch(stage.found, { photo })}
                  onError={(message) => { setError(message); setStage({ kind: 'confirm', found: stage.found }); }}
                />
              )}
              <button type="button" onClick={reset} className="mt-4 w-full py-3 text-sm text-white/50">
                Cancel
              </button>
            </div>
          )}

          {stage.kind === 'done' && <Done result={stage.result} onDone={reset} />}
        </div>

        <footer className="border-t border-white/10 pt-4 text-center text-xs text-white/40">
          {session.liveness.enabled
            ? 'Your photo is checked against your enrolled face.'
            : 'Camera check is not switched on for this tablet.'}
        </footer>
      </div>
    </main>
  );
}

/** Big numbers, because this is pressed standing up. */
function Keypad({
  code,
  onChange,
  onSubmit,
  busy,
}: {
  code: string;
  onChange: (v: string) => void;
  onSubmit: () => void;
  busy: boolean;
}) {
  const keys = ['1', '2', '3', '4', '5', '6', '7', '8', '9', 'clear', '0', 'back'];
  return (
    <div>
      <p className="text-center text-lg font-semibold">Enter your employee code</p>
      <p className="mt-1 text-center text-sm text-white/50">The number is enough — 1 finds EMP001.</p>
      <div className="mx-auto mt-5 flex h-16 w-full max-w-xs items-center justify-center rounded-2xl border border-white/15 bg-white/5 font-mono text-3xl tracking-[0.25em]">
        {code || <span className="text-white/25">— — —</span>}
      </div>

      <div className="mx-auto mt-6 grid max-w-xs grid-cols-3 gap-3">
        {keys.map((key) => (
          <button
            key={key}
            type="button"
            onClick={() => {
              if (key === 'clear') return onChange('');
              if (key === 'back') return onChange(code.slice(0, -1));
              onChange((code + key).slice(0, 20));
            }}
            className="flex h-16 items-center justify-center rounded-2xl bg-white/10 text-2xl font-semibold active:bg-white/20"
          >
            {key === 'back' ? <Delete className="h-6 w-6" /> : key === 'clear' ? <span className="text-sm">Clear</span> : key}
          </button>
        ))}
      </div>

      <button
        type="button"
        onClick={onSubmit}
        disabled={!code || busy}
        className="mx-auto mt-6 flex h-16 w-full max-w-xs items-center justify-center gap-2 rounded-2xl brand-gradient text-lg font-semibold text-white disabled:opacity-40"
      >
        {busy ? <Loader2 className="h-5 w-5 animate-spin" /> : <ArrowRight className="h-5 w-5" />}
        {busy ? 'Checking…' : 'Continue'}
      </button>
    </div>
  );
}

function Done({ result, onDone }: { result: PunchResult; onDone: () => void }) {
  const time = result.action === 'IN' ? result.checkIn : result.checkOut;
  return (
    <div className="text-center">
      <div className={`mx-auto flex h-24 w-24 items-center justify-center rounded-full ${result.action === 'IN' ? 'bg-emerald-600' : 'bg-slate-700'}`}>
        <Check className="h-12 w-12" />
      </div>
      <h1 className="mt-6 text-3xl font-bold">{result.employee.name}</h1>
      <p className="mt-2 text-lg text-white/70">
        {result.action === 'IN' ? 'Checked in' : 'Checked out'}
        {time ? ` at ${new Date(time).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' })}` : ''}
      </p>
      {result.action === 'OUT' && result.workingMinutes != null && (
        <p className="mt-1 text-sm text-white/50">
          {Math.floor(result.workingMinutes / 60)}h {result.workingMinutes % 60}m today
        </p>
      )}
      <button type="button" onClick={onDone} className="mt-8 h-14 w-full rounded-2xl bg-white/10 text-base font-semibold">
        Done
      </button>
    </div>
  );
}
