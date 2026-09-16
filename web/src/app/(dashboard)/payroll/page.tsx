'use client';

import { useState } from 'react';
import useSWR from 'swr';
import { fetcher, api, apiDownload } from '@/lib/api';
import { PageHero } from '@/components/page-hero';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Play, Loader2, FileDown, Eye, AlertTriangle, X } from 'lucide-react';

interface Payslip {
  id: string;
  netSalary: number;
  grossSalary: number;
  basicSalary?: number;
  hra?: number;
  da?: number;
  otherAllowances?: number;
  pfDeduction: number;
  esiDeduction: number;
  ptDeduction?: number;
  tdsDeduction?: number;
  otherDeductions?: number;
  presentDays: number;
  absentDays?: number;
  lopDays?: number;
  otHours?: number;
  otDays?: number;
  otPay?: number;
  sundayDays?: number;
  sundayPay?: number;
  lateDays?: number;
  payDate?: string | null;
  status: string;
  employee?: { name: string; employeeCode: string } | null;
}

interface PreviewRow {
  employeeId: string;
  name: string;
  employeeCode: string;
  isNew: boolean;
  storedNet: number | null;
  storedOtHours: number | null;
  storedOtPay: number | null;
  storedPresentDays: number | null;
  storedAbsentDays: number | null;
  net: number;
  otHours: number;
  otPay: number;
  presentDays: number;
  absentDays: number;
  pendingDays: number;
  delta: number | null;
}

interface PreviewResult {
  month: number;
  year: number;
  rows: PreviewRow[];
  skipped: { employeeId: string; name: string; employeeCode: string; status: string; storedNet: number; storedOtHours: number }[];
  summary: {
    employees: number;
    newSlips: number;
    changedSlips: number;
    skippedSlips: number;
    storedNetTotal: number;
    netTotal: number;
    netDelta: number;
    storedOtPayTotal: number;
    otPayTotal: number;
    payDateMoves: number;
  };
}

const now = new Date();
const inr = (n: number) => '₹' + n.toLocaleString('en-IN', { maximumFractionDigits: 0 });

/** Client-side CSV download — opens directly in Excel. */
function downloadCsv(filename: string, header: string[], rows: (string | number | null | undefined)[][]) {
  const esc = (v: string | number | null | undefined) => `"${String(v ?? '').replace(/"/g, '""')}"`;
  const csv = [header.map(esc).join(','), ...rows.map((r) => r.map(esc).join(','))].join('\n');
  const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv' }));
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

export default function PayrollPage() {
  const [month, setMonth] = useState(now.getMonth() + 1);
  const [year, setYear] = useState(now.getFullYear());
  const [running, setRunning] = useState(false);
  const [preview, setPreview] = useState<PreviewResult | null>(null);
  const [previewing, setPreviewing] = useState(false);

  const { data, error, isLoading, mutate } = useSWR<{ payslips: Payslip[] }>(
    `/admin/payroll/payslips/${month}/${year}`,
    fetcher,
    { shouldRetryOnError: false },
  );
  const payslips = data?.payslips ?? [];

  const totalGross = payslips.reduce((s, p) => s + p.grossSalary, 0);
  const totalDed = payslips.reduce((s, p) => s + p.pfDeduction + p.esiDeduction, 0);
  const totalNet = payslips.reduce((s, p) => s + p.netSalary, 0);
  const totalOtHours = payslips.reduce((s, p) => s + (p.otHours ?? 0), 0);
  const totalOtPay = payslips.reduce((s, p) => s + (p.otPay ?? 0) + (p.sundayPay ?? 0), 0);

  async function loadPreview() {
    setPreviewing(true);
    try {
      setPreview(await api<PreviewResult>(`/admin/payroll/preview/${month}/${year}`));
    } catch (e) {
      alert(e instanceof Error ? e.message : 'Could not build preview');
    } finally {
      setPreviewing(false);
    }
  }

  async function run() {
    // A run upserts in place and there is no history table, so the stored row
    // is the only record of what someone was actually paid. Re-running a month
    // that already has payslips overwrites that, which is worth stopping for.
    const existing = payslips.length;
    if (existing > 0) {
      const warning =
        `Re-run ${monthName}?\n\n` +
        `${existing} payslip(s) already exist and will be OVERWRITTEN with freshly ` +
        `computed figures. There is no undo and no history — if these were already ` +
        `paid out, export the register first so you keep a record of what was paid.`;
      if (!confirm(warning)) return;
    }
    setRunning(true);
    try {
      await api('/admin/payroll/run', { method: 'POST', body: JSON.stringify({ month, year }) });
      setPreview(null);
      await mutate();
    } catch (e) {
      alert(e instanceof Error ? e.message : 'Payroll run failed');
    } finally {
      setRunning(false);
    }
  }

  const monthName = new Date(year, month - 1).toLocaleDateString('en-US', { month: 'long', year: 'numeric' });
  const tag = `${year}-${String(month).padStart(2, '0')}`;

  function exportExcel() {
    downloadCsv(
      `salary-${tag}.csv`,
      ['Code', 'Name', 'Present', 'Absent', 'LOP', 'Late', 'Pay Date', 'OT Hours', 'OT Days', 'OT Pay', 'Sunday Days', 'Sunday Pay',
        'Salary (earned)', 'Gross', 'PF', 'ESI', 'Net Salary', 'Status'],
      payslips.map((p) => [
        p.employee?.employeeCode, p.employee?.name, p.presentDays, p.absentDays, p.lopDays, p.lateDays,
        p.payDate ? new Date(p.payDate).toLocaleDateString('en-GB') : '',
        p.otHours, p.otDays, p.otPay, p.sundayDays, p.sundayPay,
        p.basicSalary, p.grossSalary,
        p.pfDeduction, p.esiDeduction, p.netSalary, p.status,
      ]),
    );
  }

  return (
    <div className="space-y-6">
      <PageHero title="Payroll" subtitle={`${monthName} · ${payslips.length} payslips`}>
        <select
          value={month}
          onChange={(e) => setMonth(Number(e.target.value))}
          className="h-10 rounded-xl bg-white/15 px-3 text-sm text-white ring-1 ring-white/25 [&>option]:text-black"
        >
          {Array.from({ length: 12 }, (_, i) => (
            <option key={i + 1} value={i + 1}>{new Date(2000, i).toLocaleDateString('en-US', { month: 'short' })}</option>
          ))}
        </select>
        <button
          onClick={loadPreview}
          disabled={previewing}
          title="Show what a run would change, without writing anything"
          className="flex h-10 items-center gap-2 rounded-xl bg-white/15 px-4 text-sm font-medium ring-1 ring-white/25 hover:bg-white/25 disabled:opacity-60"
        >
          {previewing ? <Loader2 className="h-4 w-4 animate-spin" /> : <Eye className="h-4 w-4" />} Preview
        </button>
        <button
          onClick={run}
          disabled={running}
          className="flex h-10 items-center gap-2 rounded-xl bg-white px-4 text-sm font-semibold text-brand-600 hover:bg-white/90 disabled:opacity-60"
        >
          {running ? <Loader2 className="h-4 w-4 animate-spin" /> : <Play className="h-4 w-4" />} Run Payroll
        </button>
        <button
          onClick={exportExcel}
          disabled={payslips.length === 0}
          title="Download all employees' salary details as a spreadsheet"
          className="flex h-10 items-center gap-2 rounded-xl bg-white/15 px-4 text-sm font-medium ring-1 ring-white/25 hover:bg-white/25 disabled:opacity-50"
        >
          <FileDown className="h-4 w-4" /> Excel
        </button>
        <button
          onClick={() => apiDownload(`/admin/payroll/register/${month}/${year}/pdf`, `salary-register-${tag}.pdf`).catch((e) => alert(e instanceof Error ? e.message : 'Download failed'))}
          disabled={payslips.length === 0}
          title="Download the monthly salary register as PDF"
          className="flex h-10 items-center gap-2 rounded-xl bg-white/15 px-4 text-sm font-medium ring-1 ring-white/25 hover:bg-white/25 disabled:opacity-50"
        >
          <FileDown className="h-4 w-4" /> PDF
        </button>
      </PageHero>

      {preview && <PreviewPanel preview={preview} monthName={monthName} onClose={() => setPreview(null)} />}

      <div className="grid grid-cols-2 gap-4 md:grid-cols-5">
        <Card><CardContent className="p-5"><div className="text-2xl font-bold">{inr(totalGross)}</div><div className="text-xs text-muted-foreground">Gross Payout</div></CardContent></Card>
        <Card><CardContent className="p-5"><div className="text-2xl font-bold text-rose-600">{inr(totalDed)}</div><div className="text-xs text-muted-foreground">Deductions</div></CardContent></Card>
        <Card><CardContent className="p-5"><div className="text-2xl font-bold text-emerald-600">{inr(totalNet)}</div><div className="text-xs text-muted-foreground">Net Payout</div></CardContent></Card>
        <Card><CardContent className="p-5"><div className="text-2xl font-bold text-indigo-600">{inr(totalOtPay)}</div><div className="text-xs text-muted-foreground">OT + Sunday Pay · {totalOtHours.toFixed(1)}h OT</div></CardContent></Card>
        <Card><CardContent className="p-5"><div className="text-2xl font-bold">{payslips.length}</div><div className="text-xs text-muted-foreground">Payslips</div></CardContent></Card>
      </div>

      <Card>
        <CardHeader><CardTitle className="text-base">Payslips</CardTitle></CardHeader>
        <CardContent className="p-0">
          {isLoading && <div className="flex items-center gap-2 p-6 text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin" /> Loading…</div>}
          {error && <div className="p-6 text-sm text-destructive">Couldn&apos;t load payslips. Sign in and ensure the backend is running.</div>}
          {!isLoading && !error && payslips.length === 0 && (
            <div className="p-6 text-sm text-muted-foreground">No payslips for {monthName}. Click <b>Run Payroll</b> to generate them.</div>
          )}
          {payslips.length > 0 && (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-border/60 text-left text-xs uppercase tracking-wide text-muted-foreground">
                    <th className="px-6 py-3 font-medium">Employee</th>
                    <th className="px-6 py-3 font-medium">Present</th>
                    <th className="px-6 py-3 font-medium">Late</th>
                    <th className="px-6 py-3 font-medium">Pay Date</th>
                    <th className="px-6 py-3 font-medium">OT</th>
                    <th className="px-6 py-3 font-medium">Sunday</th>
                    <th className="px-6 py-3 font-medium">OT + Sun Pay</th>
                    <th className="px-6 py-3 font-medium">Gross</th>
                    <th className="px-6 py-3 font-medium">Deductions</th>
                    <th className="px-6 py-3 font-medium">Net</th>
                    <th className="px-6 py-3 font-medium"></th>
                  </tr>
                </thead>
                <tbody>
                  {payslips.map((p) => (
                    <tr key={p.id} className="border-b border-border/40 last:border-0 hover:bg-muted/40">
                      <td className="px-6 py-4 font-medium">
                        {p.employee?.name ?? '—'}
                      </td>
                      <td className="px-6 py-4">{p.presentDays}d</td>
                      <td className="px-6 py-4">
                        {(p.lateDays ?? 0) > 0
                          ? <span className={(p.lateDays ?? 0) >= 5 ? 'font-semibold text-rose-600' : 'text-amber-600'}>{p.lateDays}d</span>
                          : <span className="text-muted-foreground">—</span>}
                      </td>
                      <td className="px-6 py-4">
                        {p.payDate
                          ? new Date(p.payDate).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })
                          : <span className="text-muted-foreground">—</span>}
                      </td>
                      <td className="px-6 py-4">
                        {(p.otHours ?? 0) > 0
                          ? <span title={`${p.otHours}h OT → ${p.otDays} day(s) pay`}>{p.otHours}h <span className="text-xs text-muted-foreground">({p.otDays}d)</span></span>
                          : <span className="text-muted-foreground">—</span>}
                      </td>
                      <td className="px-6 py-4">{(p.sundayDays ?? 0) > 0 ? `${p.sundayDays}d` : <span className="text-muted-foreground">—</span>}</td>
                      <td className="px-6 py-4 text-indigo-600">{((p.otPay ?? 0) + (p.sundayPay ?? 0)) > 0 ? inr((p.otPay ?? 0) + (p.sundayPay ?? 0)) : <span className="text-muted-foreground">—</span>}</td>
                      <td className="px-6 py-4">{inr(p.grossSalary)}</td>
                      <td className="px-6 py-4 text-rose-600">- {inr(p.pfDeduction + p.esiDeduction)}</td>
                      <td className="px-6 py-4 font-semibold text-emerald-600">{inr(p.netSalary)}</td>
                      <td className="px-6 py-4">
                        <button
                          onClick={() => apiDownload(`/admin/payroll/payslips/${p.id}/pdf`, `payslip-${p.employee?.employeeCode ?? p.id}-${month}-${year}.pdf`)}
                          className="flex items-center gap-1 rounded-lg border border-border px-3 py-1.5 text-xs font-medium text-brand-600 hover:bg-brand-50"
                        >
                          <FileDown className="h-3.5 w-3.5" /> PDF
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>

      <p className="text-xs text-muted-foreground">
        Salary policy: no HRA/DA split — total salary only · PF/ESI deducted only for employees flagged
        on the Employees form · per-day = monthly ÷ 30 · OT counts only beyond 10 hours/day · every 10 OT hours
        pays 1 extra day (15h → 1.5 days, 20h → 2 days) · Sunday duty pays +1 full day on top of the
        paid weekly-off · CL paid up to the yearly quota, then LOP · salary dated the 5th of next month,
        moved to the 8th at 5+ late punches · more than 8 late punches withholds the slip (amounts still
        computed; employee sees &quot;contact HR&quot;).
      </p>
    </div>
  );
}


/**
 * What a run would change, before it changes it.
 *
 * A payroll run upserts in place and there is no history table, so the stored
 * payslip is the only record of what an employee was actually paid. For a month
 * that has already been disbursed, that makes a re-run irreversible in the one
 * way that matters — which is why this shows the per-person deltas rather than
 * a total, and why it names the rows a run would not touch at all.
 */
function PreviewPanel({ preview, monthName, onClose }: { preview: PreviewResult; monthName: string; onClose: () => void }) {
  const { summary, rows, skipped } = preview;
  // Biggest reductions first: a re-run that lowers someone's pay is the case
  // that needs a human decision, so it should not be below the fold.
  const changed = rows
    .filter((r) => r.delta !== null && Math.abs(r.delta) >= 0.01)
    .sort((a, b) => (a.delta ?? 0) - (b.delta ?? 0));
  const money = (n: number) => (n > 0 ? '+' : '') + inr(n);

  return (
    <Card className="border-amber-300/60">
      <CardHeader className="flex flex-row items-start justify-between gap-3 space-y-0">
        <div>
          <CardTitle className="flex items-center gap-2 text-base">
            <Eye className="h-4 w-4 text-amber-600" /> Preview — {monthName}
          </CardTitle>
          <p className="mt-1 text-xs text-muted-foreground">
            Computed live. Nothing has been written.
          </p>
        </div>
        <button onClick={onClose} title="Close preview" className="flex h-8 w-8 items-center justify-center rounded-lg border border-border text-muted-foreground hover:text-foreground">
          <X className="h-4 w-4" />
        </button>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
          <div className="rounded-xl border border-border/60 bg-muted/30 p-3">
            <div className="text-lg font-bold">{summary.changedSlips}</div>
            <div className="text-xs text-muted-foreground">payslips would change</div>
          </div>
          <div className="rounded-xl border border-border/60 bg-muted/30 p-3">
            <div className={`text-lg font-bold ${summary.netDelta < 0 ? 'text-rose-600' : 'text-emerald-600'}`}>
              {money(summary.netDelta)}
            </div>
            <div className="text-xs text-muted-foreground">net change across all</div>
          </div>
          <div className="rounded-xl border border-border/60 bg-muted/30 p-3">
            <div className="text-lg font-bold">
              {inr(summary.storedOtPayTotal)} → {inr(summary.otPayTotal)}
            </div>
            <div className="text-xs text-muted-foreground">OT &amp; Sunday pay</div>
          </div>
          <div className="rounded-xl border border-border/60 bg-muted/30 p-3">
            <div className="text-lg font-bold">{summary.newSlips}</div>
            <div className="text-xs text-muted-foreground">new payslips created</div>
          </div>
        </div>

        {skipped.length > 0 && (
          <div className="flex gap-3 rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900">
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
            <div>
              <div className="font-semibold">
                {skipped.length} payslip(s) will NOT be touched — the employee is no longer active.
              </div>
              A run only covers active staff, so these keep whatever figures they already have:{' '}
              {skipped.map((k) => `${k.name} (${k.employeeCode}, ${inr(k.storedNet)})`).join(', ')}.
            </div>
          </div>
        )}

        {changed.length === 0 ? (
          <div className="rounded-xl border border-border/60 bg-muted/30 p-4 text-sm text-muted-foreground">
            Nothing would change. Every stored payslip already matches what the engine computes today.
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[720px] text-sm">
              <thead>
                <tr className="border-b border-border text-left text-xs uppercase tracking-wide text-muted-foreground">
                  <th className="py-2 pr-3 font-medium">Employee</th>
                  <th className="py-2 pr-3 text-right font-medium">Stored net</th>
                  <th className="py-2 pr-3 text-right font-medium">New net</th>
                  <th className="py-2 pr-3 text-right font-medium">Change</th>
                  <th className="py-2 pr-3 text-right font-medium">OT hours</th>
                  <th className="py-2 pr-3 text-right font-medium">Present</th>
                </tr>
              </thead>
              <tbody>
                {changed.map((r) => (
                  <tr key={r.employeeId} className="border-b border-border/40">
                    <td className="py-2 pr-3">
                      <span className="font-medium">{r.name}</span>{' '}
                      <span className="text-xs text-muted-foreground">({r.employeeCode})</span>
                      {r.pendingDays > 0 && (
                        <span className="ml-1.5 rounded-full bg-amber-100 px-1.5 py-0.5 text-[10px] font-bold text-amber-700">
                          {r.pendingDays} unapproved
                        </span>
                      )}
                    </td>
                    <td className="py-2 pr-3 text-right tabular-nums text-muted-foreground">{inr(r.storedNet ?? 0)}</td>
                    <td className="py-2 pr-3 text-right font-semibold tabular-nums">{inr(r.net)}</td>
                    <td className={`py-2 pr-3 text-right font-semibold tabular-nums ${(r.delta ?? 0) < 0 ? 'text-rose-600' : 'text-emerald-600'}`}>
                      {money(r.delta ?? 0)}
                    </td>
                    <td className="py-2 pr-3 text-right tabular-nums text-muted-foreground">
                      {(r.storedOtHours ?? 0).toFixed(1)} → {r.otHours.toFixed(1)}
                    </td>
                    <td className="py-2 pr-3 text-right tabular-nums text-muted-foreground">
                      {r.storedPresentDays ?? 0} → {r.presentDays}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        <p className="text-xs text-muted-foreground">
          A run overwrites these rows in place. There is no history, so for a month already paid out,
          export the register first — that spreadsheet becomes your only record of what was actually
          disbursed. Days still awaiting approval are unpaid here; approve them first if they should count.
          {summary.payDateMoves > 0 && ` ${summary.payDateMoves} salary pay-date(s) would also move.`}
        </p>
      </CardContent>
    </Card>
  );
}
