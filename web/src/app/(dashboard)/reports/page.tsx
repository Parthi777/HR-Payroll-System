'use client';

import { useState } from 'react';
import useSWR from 'swr';
import { fetcher } from '@/lib/api';
import { PageHero } from '@/components/page-hero';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Loader2, Download } from 'lucide-react';

interface DailyRow {
  employeeCode: string; name: string; branch: string; status: string;
  checkIn: string | null; checkOut: string | null; workedHours: number | null;
  geofence: string | null; flagged: boolean;
}
interface MonthlyRow {
  employeeCode: string; name: string; branch: string; presentDays: number;
  lateDays: number; halfDays: number; workedHours: number;
  otHours: number | null; netSalary: number | null; payslipStatus: string | null;
}
interface BranchRow { branch: string; employees: number; presentDays: number; lateDays: number; workedHours: number }
interface LateRow { employeeCode: string; name: string; branch: string; count: number; dates: string[]; checkIns: (string | null)[] }

const TABS = ['Daily', 'Monthly', 'Late Punches'] as const;
type Tab = (typeof TABS)[number];

const today = new Date();
const iso = (d: Date) => d.toISOString().slice(0, 10);

/** Client-side CSV download — no backend round-trip needed. */
function downloadCsv(filename: string, header: string[], rows: (string | number | null)[][]) {
  const esc = (v: string | number | null) => `"${String(v ?? '').replace(/"/g, '""')}"`;
  const csv = [header.map(esc).join(','), ...rows.map((r) => r.map(esc).join(','))].join('\n');
  const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv' }));
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

const th = 'px-4 py-3 font-medium';
const td = 'px-4 py-3';

export default function ReportsPage() {
  const [tab, setTab] = useState<Tab>('Daily');
  const [date, setDate] = useState(iso(today));
  const [month, setMonth] = useState(today.getMonth() + 1);
  const [year, setYear] = useState(today.getFullYear());

  return (
    <div className="space-y-6">
      <PageHero title="Reports" subtitle="Attendance performance · daily, monthly, branch & late-punch">
        {tab === 'Daily' ? (
          <input
            type="date"
            value={date}
            max={iso(today)}
            onChange={(e) => setDate(e.target.value)}
            className="h-10 rounded-xl bg-white/15 px-3 text-sm text-white ring-1 ring-white/25 [color-scheme:dark]"
          />
        ) : (
          <>
            <select value={month} onChange={(e) => setMonth(Number(e.target.value))} className="h-10 rounded-xl bg-white/15 px-3 text-sm text-white ring-1 ring-white/25 [&>option]:text-black">
              {Array.from({ length: 12 }, (_, i) => (
                <option key={i + 1} value={i + 1}>{new Date(2000, i).toLocaleDateString('en-US', { month: 'short' })}</option>
              ))}
            </select>
            <select value={year} onChange={(e) => setYear(Number(e.target.value))} className="h-10 rounded-xl bg-white/15 px-3 text-sm text-white ring-1 ring-white/25 [&>option]:text-black">
              {[today.getFullYear() - 1, today.getFullYear()].map((y) => <option key={y} value={y}>{y}</option>)}
            </select>
          </>
        )}
      </PageHero>

      <div className="flex gap-2">
        {TABS.map((t) => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={`h-10 rounded-xl px-4 text-sm font-semibold ${tab === t ? 'brand-gradient text-white shadow-brand' : 'border border-border bg-card text-muted-foreground hover:text-foreground'}`}
          >
            {t}
          </button>
        ))}
      </div>

      {tab === 'Daily' && <DailyReport date={date} />}
      {tab === 'Monthly' && <MonthlyReport month={month} year={year} />}
      {tab === 'Late Punches' && <LateReport month={month} year={year} />}
    </div>
  );
}

function DailyReport({ date }: { date: string }) {
  const { data, isLoading } = useSWR<{ summary: { total: number; present: number; late: number; absent: number }; rows: DailyRow[] }>(
    `/admin/reports/daily?date=${date}`, fetcher, { shouldRetryOnError: false },
  );
  const rows = data?.rows ?? [];
  return (
    <>
      {data && (
        <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
          <Stat label="Employees" value={data.summary.total} />
          <Stat label="Present" value={data.summary.present} tint="text-emerald-600" />
          <Stat label="Late" value={data.summary.late} tint="text-amber-600" />
          <Stat label="Absent" value={data.summary.absent} tint="text-rose-600" />
        </div>
      )}
      <TableCard
        title={`Daily attendance — ${date}`}
        loading={isLoading}
        empty={rows.length === 0 ? 'No employees found.' : null}
        onExport={() => downloadCsv(`daily-${date}.csv`,
          ['Code', 'Name', 'Branch', 'Status', 'Check-In', 'Check-Out', 'Hours', 'Geofence'],
          rows.map((r) => [r.employeeCode, r.name, r.branch, r.status, r.checkIn, r.checkOut, r.workedHours, r.geofence]))}
      >
        <thead><tr className="border-b border-border/60 text-left text-xs uppercase tracking-wide text-muted-foreground">
          <th className={th}>Employee</th><th className={th}>Branch</th><th className={th}>Status</th>
          <th className={th}>Check-In</th><th className={th}>Check-Out</th><th className={th}>Hours</th>
        </tr></thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.employeeCode} className="border-b border-border/40 last:border-0 hover:bg-muted/40">
              <td className={`${td} font-medium`}>{r.name} <span className="text-xs text-muted-foreground">{r.employeeCode}</span></td>
              <td className={`${td} text-muted-foreground`}>{r.branch}</td>
              <td className={td}><StatusChip status={r.status} /></td>
              <td className={td}>{r.checkIn ?? '—'}</td>
              <td className={td}>{r.checkOut ?? '—'}</td>
              <td className={td}>{r.workedHours != null ? `${r.workedHours}h` : '—'}</td>
            </tr>
          ))}
        </tbody>
      </TableCard>
    </>
  );
}

function MonthlyReport({ month, year }: { month: number; year: number }) {
  const { data, isLoading } = useSWR<{ rows: MonthlyRow[]; branches: BranchRow[] }>(
    `/admin/reports/monthly?month=${month}&year=${year}`, fetcher, { shouldRetryOnError: false },
  );
  const rows = data?.rows ?? [];
  const branches = data?.branches ?? [];
  const tag = `${year}-${String(month).padStart(2, '0')}`;
  return (
    <>
      <TableCard
        title={`Employee-wise — ${tag}`}
        loading={isLoading}
        empty={rows.length === 0 ? 'No data for this month.' : null}
        onExport={() => downloadCsv(`monthly-employees-${tag}.csv`,
          ['Code', 'Name', 'Branch', 'Present', 'Late', 'Half', 'Worked h', 'OT h', 'Net Salary', 'Slip'],
          rows.map((r) => [r.employeeCode, r.name, r.branch, r.presentDays, r.lateDays, r.halfDays, r.workedHours, r.otHours, r.netSalary, r.payslipStatus]))}
      >
        <thead><tr className="border-b border-border/60 text-left text-xs uppercase tracking-wide text-muted-foreground">
          <th className={th}>Employee</th><th className={th}>Branch</th><th className={th}>Present</th>
          <th className={th}>Late</th><th className={th}>Worked</th><th className={th}>OT</th><th className={th}>Net</th>
        </tr></thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.employeeCode} className="border-b border-border/40 last:border-0 hover:bg-muted/40">
              <td className={`${td} font-medium`}>{r.name} <span className="text-xs text-muted-foreground">{r.employeeCode}</span></td>
              <td className={`${td} text-muted-foreground`}>{r.branch}</td>
              <td className={td}>{r.presentDays + r.lateDays + r.halfDays}d</td>
              <td className={td}>{r.lateDays > 0 ? <span className={r.lateDays >= 5 ? 'font-semibold text-rose-600' : 'text-amber-600'}>{r.lateDays}d</span> : '—'}</td>
              <td className={td}>{r.workedHours}h</td>
              <td className={td}>{r.otHours ? `${r.otHours}h` : '—'}</td>
              <td className={td}>
                {r.netSalary != null ? `₹${r.netSalary.toLocaleString('en-IN', { maximumFractionDigits: 0 })}` : '—'}
                {r.payslipStatus === 'WITHHELD' && <span className="ml-1 rounded-full bg-rose-100 px-1.5 text-[10px] font-bold text-rose-700">WH</span>}
              </td>
            </tr>
          ))}
        </tbody>
      </TableCard>

      <TableCard
        title={`Branch-wise — ${tag}`}
        loading={isLoading}
        empty={branches.length === 0 ? 'No data.' : null}
        onExport={() => downloadCsv(`monthly-branches-${tag}.csv`,
          ['Branch', 'Employees', 'Present days', 'Late days', 'Worked h'],
          branches.map((b) => [b.branch, b.employees, b.presentDays, b.lateDays, b.workedHours]))}
      >
        <thead><tr className="border-b border-border/60 text-left text-xs uppercase tracking-wide text-muted-foreground">
          <th className={th}>Branch</th><th className={th}>Employees</th><th className={th}>Present days</th>
          <th className={th}>Late days</th><th className={th}>Worked hours</th>
        </tr></thead>
        <tbody>
          {branches.map((b) => (
            <tr key={b.branch} className="border-b border-border/40 last:border-0 hover:bg-muted/40">
              <td className={`${td} font-medium`}>{b.branch}</td>
              <td className={td}>{b.employees}</td>
              <td className={td}>{b.presentDays}</td>
              <td className={td}>{b.lateDays}</td>
              <td className={td}>{b.workedHours}h</td>
            </tr>
          ))}
        </tbody>
      </TableCard>
    </>
  );
}

function LateReport({ month, year }: { month: number; year: number }) {
  const { data, isLoading } = useSWR<{ rows: LateRow[] }>(
    `/admin/reports/late?month=${month}&year=${year}`, fetcher, { shouldRetryOnError: false },
  );
  const rows = data?.rows ?? [];
  const tag = `${year}-${String(month).padStart(2, '0')}`;
  return (
    <TableCard
      title={`Late punches — ${tag}`}
      loading={isLoading}
      empty={rows.length === 0 ? 'No late punches this month. 🎉' : null}
      onExport={() => downloadCsv(`late-punches-${tag}.csv`,
        ['Code', 'Name', 'Branch', 'Late count', 'Dates'],
        rows.map((r) => [r.employeeCode, r.name, r.branch, r.count, r.dates.join(' | ')]))}
    >
      <thead><tr className="border-b border-border/60 text-left text-xs uppercase tracking-wide text-muted-foreground">
        <th className={th}>Employee</th><th className={th}>Branch</th><th className={th}>Late days</th><th className={th}>Dates (check-in)</th>
      </tr></thead>
      <tbody>
        {rows.map((r) => (
          <tr key={r.employeeCode} className="border-b border-border/40 align-top last:border-0 hover:bg-muted/40">
            <td className={`${td} font-medium`}>{r.name} <span className="text-xs text-muted-foreground">{r.employeeCode}</span></td>
            <td className={`${td} text-muted-foreground`}>{r.branch}</td>
            <td className={td}>
              <span className={r.count > 8 ? 'font-bold text-rose-600' : r.count >= 5 ? 'font-semibold text-amber-600' : ''}>{r.count}</span>
              {r.count >= 5 && <span className="ml-1 text-[10px] text-muted-foreground">{r.count > 8 ? '(slip withheld)' : '(pay date → 8th)'}</span>}
            </td>
            <td className={`${td} text-xs text-muted-foreground`}>
              {r.dates.map((d, i) => `${d.slice(8)}${r.checkIns[i] ? ` (${r.checkIns[i]})` : ''}`).join(', ')}
            </td>
          </tr>
        ))}
      </tbody>
    </TableCard>
  );
}

function Stat({ label, value, tint = '' }: { label: string; value: number; tint?: string }) {
  return (
    <Card><CardContent className="p-5">
      <div className={`text-2xl font-bold ${tint}`}>{value}</div>
      <div className="text-xs text-muted-foreground">{label}</div>
    </CardContent></Card>
  );
}

function StatusChip({ status }: { status: string }) {
  const cls = status === 'PRESENT' ? 'chip-present'
    : status === 'LATE' ? 'chip-half'
    : status === 'ABSENT' ? 'chip-off'
    : status.includes('approval') ? 'chip-half'
    : 'chip-leave';
  return <span className={`chip ${cls}`}>{status.replace('_', ' ')}</span>;
}

function TableCard({ title, loading, empty, onExport, children }: {
  title: string; loading: boolean; empty: string | null; onExport: () => void; children: React.ReactNode;
}) {
  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between space-y-0">
        <CardTitle className="text-base">{title}</CardTitle>
        <button onClick={onExport} className="flex h-9 items-center gap-1.5 rounded-lg border border-border px-3 text-xs font-semibold text-brand-600 hover:bg-brand-50">
          <Download className="h-3.5 w-3.5" /> CSV
        </button>
      </CardHeader>
      <CardContent className="p-0">
        {loading && <div className="flex items-center gap-2 p-6 text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin" /> Loading…</div>}
        {!loading && empty && <div className="p-6 text-sm text-muted-foreground">{empty}</div>}
        {!loading && !empty && (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">{children}</table>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
