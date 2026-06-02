'use client';

import { useState } from 'react';
import useSWR from 'swr';
import { fetcher, api, apiDownload } from '@/lib/api';
import { PageHero } from '@/components/page-hero';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Play, Loader2, FileDown } from 'lucide-react';

interface Payslip {
  id: string;
  netSalary: number;
  grossSalary: number;
  pfDeduction: number;
  esiDeduction: number;
  presentDays: number;
  status: string;
  employee?: { name: string; employeeCode: string } | null;
}

const now = new Date();
const inr = (n: number) => '₹' + n.toLocaleString('en-IN', { maximumFractionDigits: 0 });

export default function PayrollPage() {
  const [month, setMonth] = useState(now.getMonth() + 1);
  const [year, setYear] = useState(now.getFullYear());
  const [running, setRunning] = useState(false);

  const { data, error, isLoading, mutate } = useSWR<{ payslips: Payslip[] }>(
    `/admin/payroll/payslips/${month}/${year}`,
    fetcher,
    { shouldRetryOnError: false },
  );
  const payslips = data?.payslips ?? [];

  const totalGross = payslips.reduce((s, p) => s + p.grossSalary, 0);
  const totalDed = payslips.reduce((s, p) => s + p.pfDeduction + p.esiDeduction, 0);
  const totalNet = payslips.reduce((s, p) => s + p.netSalary, 0);

  async function run() {
    setRunning(true);
    try {
      await api('/admin/payroll/run', { method: 'POST', body: JSON.stringify({ month, year }) });
      await mutate();
    } catch {
      alert('Payroll run failed');
    } finally {
      setRunning(false);
    }
  }

  const monthName = new Date(year, month - 1).toLocaleDateString('en-US', { month: 'long', year: 'numeric' });

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
          onClick={run}
          disabled={running}
          className="flex h-10 items-center gap-2 rounded-xl bg-white px-4 text-sm font-semibold text-brand-600 hover:bg-white/90 disabled:opacity-60"
        >
          {running ? <Loader2 className="h-4 w-4 animate-spin" /> : <Play className="h-4 w-4" />} Run Payroll
        </button>
      </PageHero>

      <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
        <Card><CardContent className="p-5"><div className="text-2xl font-bold">{inr(totalGross)}</div><div className="text-xs text-muted-foreground">Gross Payout</div></CardContent></Card>
        <Card><CardContent className="p-5"><div className="text-2xl font-bold text-rose-600">{inr(totalDed)}</div><div className="text-xs text-muted-foreground">Deductions</div></CardContent></Card>
        <Card><CardContent className="p-5"><div className="text-2xl font-bold text-emerald-600">{inr(totalNet)}</div><div className="text-xs text-muted-foreground">Net Payout</div></CardContent></Card>
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
                    <th className="px-6 py-3 font-medium">Gross</th>
                    <th className="px-6 py-3 font-medium">Deductions</th>
                    <th className="px-6 py-3 font-medium">Net</th>
                    <th className="px-6 py-3 font-medium"></th>
                  </tr>
                </thead>
                <tbody>
                  {payslips.map((p) => (
                    <tr key={p.id} className="border-b border-border/40 last:border-0 hover:bg-muted/40">
                      <td className="px-6 py-4 font-medium">{p.employee?.name ?? '—'}</td>
                      <td className="px-6 py-4">{p.presentDays}d</td>
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
    </div>
  );
}
