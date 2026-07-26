'use client';

import { useState } from 'react';
import useSWR from 'swr';
import { fetcher, apiDownload } from '@/lib/api';
import { PageHero } from '@/components/page-hero';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Loader2, Download, FileSpreadsheet, FileText } from 'lucide-react';

interface DailyRow {
  employeeCode: string; name: string; branch: string; status: string;
  checkIn: string | null; checkOut: string | null; workedHours: number | null;
  geofence: string | null; punchMode: string | null; flagged: boolean;
}
interface MonthlyRow {
  employeeCode: string; name: string; branch: string; presentDays: number;
  lateDays: number; halfDays: number; workedHours: number;
  otHours: number | null; netSalary: number | null; payslipStatus: string | null;
}
interface BranchRow { branch: string; employees: number; presentDays: number; lateDays: number; workedHours: number }
interface LateRow { employeeCode: string; name: string; branch: string; count: number; dates: string[]; checkIns: (string | null)[] }

interface PayrollRow {
  employeeCode: string; name: string; branch: string; designation: string; department: string;
  daysInMonth: number; presentDays: number; halfDays: number; absentDays: number;
  clDays: number; leaveDeduction: number; otHours: number; sundayDays: number;
  salary: number; perDaySalary: number; otSalary: number; payable: number;
  lateDays: number; withheld: boolean;
}
interface PayrollReport {
  label: string;
  rows: PayrollRow[];
  totals: { employees: number; absentDays: number; otHours: number; salary: number; otSalary: number; leaveDeduction: number; payable: number };
}

interface MusterDay {
  day: number; weekday: string; isSunday: boolean;
  inTime: string; outTime: string; work: string; break: string; ot: string;
  status: string; manual: boolean;
}
interface MusterEmployee {
  employeeCode: string; name: string; branch: string; department: string; designation: string; shift: string;
  present: number; weeklyOff: number; holidays: number; leave: number; absent: number;
  paidDays: number; sundayDuty: number; totalWorkPlusOt: string; totalOt: string;
  days: MusterDay[];
}
interface MusterReport { label: string; daysInMonth: number; employees: MusterEmployee[] }

interface Branch { id: string; name: string }

const TABS = ['Daily', 'Monthly', 'Payroll', 'Performance', 'Employee', 'Late Punches'] as const;
type Tab = (typeof TABS)[number];

interface EmpDay { day: number; weekday: number; status: string; checkIn: string | null; checkOut: string | null; workedHours: number | null; punchMode: string | null }
interface Named2 { id: string; name: string; employeeCode?: string; status?: string }

const today = new Date();
const iso = (d: Date) => d.toISOString().slice(0, 10);
const money = (n: number | null | undefined) =>
  n == null ? '—' : `₹${n.toLocaleString('en-IN', { maximumFractionDigits: 0 })}`;
/** Day counts are fractional — show "20" but keep "2.5". */
const days = (n: number | null | undefined) => (n == null ? '—' : Number.isInteger(n) ? String(n) : n.toFixed(1));

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
  const [branchId, setBranchId] = useState('');

  const { data: branchData } = useSWR<{ branches: Branch[] }>('/admin/branches', fetcher, { shouldRetryOnError: false });
  const branches = branchData?.branches ?? [];
  const bq = branchId ? `&branchId=${branchId}` : '';

  return (
    <div className="space-y-6">
      <PageHero title="Reports" subtitle="Attendance · payroll · performance — export to Excel or PDF">
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
        <select value={branchId} onChange={(e) => setBranchId(e.target.value)} className="h-10 rounded-xl bg-white/15 px-3 text-sm text-white ring-1 ring-white/25 [&>option]:text-black">
          <option value="">All branches</option>
          {branches.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
        </select>
      </PageHero>

      <div className="flex flex-wrap gap-2">
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

      <p className="text-xs text-muted-foreground">
        Reports cover active employees only. Deactivated staff are excluded everywhere.
      </p>

      {tab === 'Daily' && <DailyReport date={date} bq={bq} />}
      {tab === 'Monthly' && <MonthlyReport month={month} year={year} bq={bq} />}
      {tab === 'Payroll' && <PayrollReportTab month={month} year={year} bq={bq} />}
      {tab === 'Performance' && <PerformanceReport month={month} year={year} bq={bq} />}
      {tab === 'Employee' && <EmployeeReport month={month} year={year} />}
      {tab === 'Late Punches' && <LateReport month={month} year={year} bq={bq} />}
    </div>
  );
}

/** Excel / PDF are generated by the backend so the file matches the printed layout. */
function ServerExports({ path, filename }: { path: string; filename: string }) {
  const [busy, setBusy] = useState<'xlsx' | 'pdf' | null>(null);
  const [err, setErr] = useState<string | null>(null);

  async function go(format: 'xlsx' | 'pdf') {
    setBusy(format);
    setErr(null);
    try {
      const sep = path.includes('?') ? '&' : '?';
      await apiDownload(`${path}${sep}format=${format}`, `${filename}.${format}`);
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Export failed');
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="flex items-center gap-2">
      {err && <span className="text-[11px] text-destructive">{err}</span>}
      <button
        onClick={() => go('xlsx')}
        disabled={busy !== null}
        className="flex h-9 items-center gap-1.5 rounded-lg border border-border px-3 text-xs font-semibold text-emerald-700 hover:bg-emerald-50 disabled:opacity-50"
      >
        {busy === 'xlsx' ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <FileSpreadsheet className="h-3.5 w-3.5" />} Excel
      </button>
      <button
        onClick={() => go('pdf')}
        disabled={busy !== null}
        className="flex h-9 items-center gap-1.5 rounded-lg border border-border px-3 text-xs font-semibold text-rose-700 hover:bg-rose-50 disabled:opacity-50"
      >
        {busy === 'pdf' ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <FileText className="h-3.5 w-3.5" />} PDF
      </button>
    </div>
  );
}

function DailyReport({ date, bq }: { date: string; bq: string }) {
  const { data, isLoading } = useSWR<{ summary: { total: number; present: number; late: number; absent: number }; rows: DailyRow[] }>(
    `/admin/reports/daily?date=${date}${bq}`, fetcher, { shouldRetryOnError: false },
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
        exportPath={`/admin/reports/daily?date=${date}${bq}`}
        exportName={`daily-attendance-${date}`}
        onExport={() => downloadCsv(`daily-${date}.csv`,
          ['Code', 'Name', 'Branch', 'Status', 'Check-In', 'Check-Out', 'Hours', 'Geofence', 'Punch'],
          rows.map((r) => [r.employeeCode, r.name, r.branch, r.status, r.checkIn, r.checkOut, r.workedHours, r.geofence, r.punchMode]))}
      >
        <thead><tr className="border-b border-border/60 text-left text-xs uppercase tracking-wide text-muted-foreground">
          <th className={th}>Employee</th><th className={th}>Branch</th><th className={th}>Status</th>
          <th className={th}>Check-In</th><th className={th}>Check-Out</th><th className={th}>Hours</th>
        </tr></thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.employeeCode} className="border-b border-border/40 last:border-0 hover:bg-muted/40">
              <td className={`${td} font-medium`}>
                {r.name} <span className="text-xs text-muted-foreground">{r.employeeCode}</span>
                {r.punchMode && r.punchMode !== 'GEO' && <PunchTag mode={r.punchMode} />}
              </td>
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

function MonthlyReport({ month, year, bq }: { month: number; year: number; bq: string }) {
  const { data, isLoading } = useSWR<{ rows: MonthlyRow[]; branches: BranchRow[] }>(
    `/admin/reports/monthly?month=${month}&year=${year}${bq}`, fetcher, { shouldRetryOnError: false },
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
        exportPath={`/admin/reports/monthly?month=${month}&year=${year}${bq}`}
        exportName={`monthly-attendance-${tag}`}
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
              <td className={td}>{days(r.presentDays + r.lateDays + r.halfDays * 0.5)}d</td>
              <td className={td}>{r.lateDays > 0 ? <span className={r.lateDays >= 5 ? 'font-semibold text-rose-600' : 'text-amber-600'}>{r.lateDays}d</span> : '—'}</td>
              <td className={td}>{r.workedHours}h</td>
              <td className={td}>{r.otHours ? `${r.otHours}h` : '—'}</td>
              <td className={td}>
                {money(r.netSalary)}
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
              <td className={td}>{days(b.presentDays)}</td>
              <td className={td}>{b.lateDays}</td>
              <td className={td}>{b.workedHours}h</td>
            </tr>
          ))}
        </tbody>
      </TableCard>
    </>
  );
}

/** The owner's salary sheet: days, leave, OT and what is payable per employee. */
function PayrollReportTab({ month, year, bq }: { month: number; year: number; bq: string }) {
  const { data, isLoading } = useSWR<PayrollReport>(
    `/admin/reports/payroll-summary?month=${month}&year=${year}${bq}`, fetcher, { shouldRetryOnError: false },
  );
  const rows = data?.rows ?? [];
  const t = data?.totals;
  const tag = `${year}-${String(month).padStart(2, '0')}`;

  return (
    <>
      {t && (
        <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
          <Stat label="Employees" value={t.employees} />
          <Stat label="Absent days" value={t.absentDays} tint="text-rose-600" />
          <Stat label="OT hours" value={t.otHours} tint="text-amber-600" />
          <MoneyStat label="Total payable" value={t.payable} />
        </div>
      )}
      <TableCard
        title={`Payroll summary — ${data?.label ?? tag}`}
        loading={isLoading}
        empty={rows.length === 0 ? 'No active employees for this month.' : null}
        exportPath={`/admin/reports/payroll-summary?month=${month}&year=${year}${bq}`}
        exportName={`payroll-summary-${tag}`}
        onExport={() => downloadCsv(`payroll-summary-${tag}.csv`,
          ['Code', 'Employee', 'Branch', 'Designation', 'Department', 'Days in Month', 'Present Days',
            'Absent Days', 'CL Days', 'Leave Deduction', 'OT Hours', 'Sunday Duty', 'Salary',
            'Per Day Salary', 'OT Salary', 'Payable'],
          rows.map((r) => [r.employeeCode, r.name, r.branch, r.designation, r.department, r.daysInMonth,
            r.presentDays, r.absentDays, r.clDays, r.leaveDeduction, r.otHours, r.sundayDays,
            r.salary, r.perDaySalary, r.otSalary, r.payable]))}
      >
        <thead><tr className="border-b border-border/60 text-left text-xs uppercase tracking-wide text-muted-foreground">
          <th className={th}>Employee</th><th className={th}>Branch</th><th className={th}>Designation</th>
          <th className={th}>Department</th>
          <th className={`${th} text-right`}>Days</th>
          <th className={`${th} text-right`}>Absent</th>
          <th className={`${th} text-right`}>CL</th>
          <th className={`${th} text-right`}>Leave Ded.</th>
          <th className={`${th} text-right`}>OT h</th>
          <th className={`${th} text-right`}>Salary</th>
          <th className={`${th} text-right`}>Per Day</th>
          <th className={`${th} text-right`}>OT Salary</th>
          <th className={`${th} text-right`}>Payable</th>
        </tr></thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.employeeCode} className="border-b border-border/40 last:border-0 hover:bg-muted/40">
              <td className={`${td} font-medium`}>
                {r.name} <span className="text-xs text-muted-foreground">{r.employeeCode}</span>
                {r.withheld && <span className="ml-1 rounded-full bg-rose-100 px-1.5 text-[10px] font-bold text-rose-700">WH</span>}
              </td>
              <td className={`${td} text-muted-foreground`}>{r.branch}</td>
              <td className={`${td} text-muted-foreground`}>{r.designation}</td>
              <td className={`${td} text-muted-foreground`}>{r.department}</td>
              <td className={`${td} text-right`}>{r.daysInMonth}</td>
              <td className={`${td} text-right ${r.absentDays > 0 ? 'text-rose-600' : ''}`}>{days(r.absentDays)}</td>
              <td className={`${td} text-right`}>{days(r.clDays)}</td>
              <td className={`${td} text-right`}>{money(r.leaveDeduction)}</td>
              <td className={`${td} text-right`}>
                {days(r.otHours)}
                {r.sundayDays > 0 && <span className="ml-1 text-[10px] text-emerald-600">+{r.sundayDays} Sun</span>}
              </td>
              <td className={`${td} text-right`}>{money(r.salary)}</td>
              <td className={`${td} text-right`}>{money(r.perDaySalary)}</td>
              <td className={`${td} text-right text-emerald-700`}>{money(r.otSalary)}</td>
              <td className={`${td} text-right font-semibold`}>{money(r.payable)}</td>
            </tr>
          ))}
          {t && rows.length > 0 && (
            <tr className="border-t-2 border-border bg-muted/50 font-semibold">
              <td className={td}>TOTAL ({t.employees})</td>
              <td className={td} colSpan={4} />
              <td className={`${td} text-right`}>{days(t.absentDays)}</td>
              <td className={td} />
              <td className={`${td} text-right`}>{money(t.leaveDeduction)}</td>
              <td className={`${td} text-right`}>{days(t.otHours)}</td>
              <td className={`${td} text-right`}>{money(t.salary)}</td>
              <td className={td} />
              <td className={`${td} text-right`}>{money(t.otSalary)}</td>
              <td className={`${td} text-right`}>{money(t.payable)}</td>
            </tr>
          )}
        </tbody>
      </TableCard>
      <p className="text-xs text-muted-foreground">
        Absent days include the unworked half of a half day (2 absences + 1 half day = 2.5). Sundays are paid weekly-offs;
        working a Sunday pays one extra full day — even for a half day — and is included in OT Salary.
      </p>
    </>
  );
}

const CODE_CLASS: Record<string, string> = {
  P: 'text-emerald-600', 'WO*': 'text-emerald-600', 'HL*': 'text-emerald-600',
  HD: 'text-amber-600', PN: 'text-amber-600',
  A: 'text-rose-600', LOP: 'text-rose-600',
  WO: 'text-blue-600', HL: 'text-violet-600', LV: 'text-violet-600',
};

/** Day-by-day muster grid — mirrors the biometric monthly performance report. */
function PerformanceReport({ month, year, bq }: { month: number; year: number; bq: string }) {
  const { data, isLoading } = useSWR<MusterReport>(
    `/admin/reports/monthly-performance?month=${month}&year=${year}${bq}`, fetcher, { shouldRetryOnError: false },
  );
  const employees = data?.employees ?? [];
  const tag = `${year}-${String(month).padStart(2, '0')}`;

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between space-y-0">
        <CardTitle className="text-base">Monthly performance — {data?.label ?? tag}</CardTitle>
        <ServerExports
          path={`/admin/reports/monthly-performance?month=${month}&year=${year}${bq}`}
          filename={`monthly-performance-${tag}`}
        />
      </CardHeader>
      <CardContent className="space-y-6 p-4">
        {isLoading && <div className="flex items-center gap-2 text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin" /> Loading…</div>}
        {!isLoading && employees.length === 0 && <p className="text-sm text-muted-foreground">No active employees for this month.</p>}

        {employees.map((e) => (
          <div key={e.employeeCode} className="rounded-xl border border-border">
            <div className="flex flex-wrap items-center justify-between gap-2 rounded-t-xl bg-muted/50 px-3 py-2 text-xs">
              <div className="font-semibold">
                {e.name} <span className="text-muted-foreground">· {e.employeeCode} · {e.department} · {e.designation} · {e.branch}</span>
              </div>
              <div className="flex flex-wrap gap-3 text-muted-foreground">
                <span className="text-emerald-600">Present <b>{days(e.present)}</b></span>
                <span className="text-blue-600">WO <b>{e.weeklyOff}</b></span>
                <span className="text-violet-600">HL <b>{e.holidays}</b> · LV <b>{e.leave}</b></span>
                <span className="text-rose-600">Absent <b>{days(e.absent)}</b></span>
                <span>Paid <b>{days(e.paidDays)}</b></span>
                {e.sundayDuty > 0 && <span className="text-emerald-600">Sun duty <b>{e.sundayDuty}</b></span>}
                <span>Work+OT <b>{e.totalWorkPlusOt}</b></span>
                <span>OT <b>{e.totalOt}</b></span>
              </div>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-[10px]">
                <thead>
                  <tr className="border-b border-border/60">
                    <th className="sticky left-0 z-10 bg-card px-2 py-1 text-left font-medium text-muted-foreground">Day</th>
                    {e.days.map((d) => (
                      <th key={d.day} className={`px-1 py-1 text-center font-semibold ${d.isSunday ? 'text-blue-600' : ''}`}>
                        {d.day}<div className="font-normal text-muted-foreground">{d.weekday}</div>
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {([['IN', 'inTime'], ['OUT', 'outTime'], ['WORK', 'work'], ['Break', 'break'], ['OT', 'ot']] as const).map(([label, key], i) => (
                    <tr key={label} className={i % 2 === 1 ? 'bg-muted/30' : ''}>
                      <td className="sticky left-0 z-10 bg-inherit px-2 py-1 font-semibold text-muted-foreground">{label}</td>
                      {e.days.map((d) => (
                        <td key={d.day} className="whitespace-nowrap px-1 py-1 text-center tabular-nums">{d[key]}</td>
                      ))}
                    </tr>
                  ))}
                  <tr className="border-t border-border/60">
                    <td className="sticky left-0 z-10 bg-card px-2 py-1 font-semibold text-muted-foreground">Status</td>
                    {e.days.map((d) => (
                      <td key={d.day} className={`px-1 py-1 text-center font-bold ${CODE_CLASS[d.status] ?? ''}`} title={d.manual ? 'Manual / selfie punch' : undefined}>
                        {d.status}{d.manual && d.status ? '#' : ''}
                      </td>
                    ))}
                  </tr>
                </tbody>
              </table>
            </div>
          </div>
        ))}

        {employees.length > 0 && (
          <p className="text-[11px] text-muted-foreground">
            P = Present · HD = Half day (0.5) · A = Absent · WO = Weekly off (Sunday, paid) · WO* = Sunday duty (pays one extra
            full day) · HL = Holiday · LV = Paid leave · LOP = Loss of pay · PN = Awaiting approval · # = manual/selfie punch
          </p>
        )}
      </CardContent>
    </Card>
  );
}

function LateReport({ month, year, bq }: { month: number; year: number; bq: string }) {
  const { data, isLoading } = useSWR<{ rows: LateRow[] }>(
    `/admin/reports/late?month=${month}&year=${year}${bq}`, fetcher, { shouldRetryOnError: false },
  );
  const rows = data?.rows ?? [];
  const tag = `${year}-${String(month).padStart(2, '0')}`;
  return (
    <TableCard
      title={`Late punches — ${tag}`}
      loading={isLoading}
      empty={rows.length === 0 ? 'No late punches this month. 🎉' : null}
      exportPath={`/admin/reports/late?month=${month}&year=${year}${bq}`}
      exportName={`late-punches-${tag}`}
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
      <div className={`text-2xl font-bold ${tint}`}>{days(value)}</div>
      <div className="text-xs text-muted-foreground">{label}</div>
    </CardContent></Card>
  );
}

function MoneyStat({ label, value }: { label: string; value: number }) {
  return (
    <Card><CardContent className="p-5">
      <div className="text-2xl font-bold text-brand-600">{money(value)}</div>
      <div className="text-xs text-muted-foreground">{label}</div>
    </CardContent></Card>
  );
}

function PunchTag({ mode }: { mode: string }) {
  return (
    <span className="ml-1 rounded-full bg-amber-100 px-1.5 text-[10px] font-bold text-amber-700">
      {mode === 'SELFIE' ? 'SELFIE' : 'MANUAL'}
    </span>
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

function TableCard({ title, loading, empty, onExport, exportPath, exportName, children }: {
  title: string; loading: boolean; empty: string | null; onExport: () => void;
  exportPath?: string; exportName?: string; children: React.ReactNode;
}) {
  return (
    <Card>
      <CardHeader className="flex flex-row flex-wrap items-center justify-between gap-2 space-y-0">
        <CardTitle className="text-base">{title}</CardTitle>
        <div className="flex items-center gap-2">
          <button onClick={onExport} className="flex h-9 items-center gap-1.5 rounded-lg border border-border px-3 text-xs font-semibold text-brand-600 hover:bg-brand-50">
            <Download className="h-3.5 w-3.5" /> CSV
          </button>
          {exportPath && exportName && <ServerExports path={exportPath} filename={exportName} />}
        </div>
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

function EmployeeReport({ month, year }: { month: number; year: number }) {
  const { data: emps } = useSWR<{ employees: Named2[] }>('/admin/employees', fetcher, { shouldRetryOnError: false });
  // Reports cover active employees only — keep the picker consistent with that.
  const list = (emps?.employees ?? []).filter((e) => e.status !== 'INACTIVE');
  const [empId, setEmpId] = useState('');
  const { data, isLoading } = useSWR<{
    employee: { name: string; employeeCode: string; branch: string; shift: string };
    days: EmpDay[];
    summary: { present: number; late: number; half: number; absent: number; off: number; workedHours: number };
  }>(empId ? `/admin/reports/employee/${empId}?month=${month}&year=${year}` : null, fetcher, { shouldRetryOnError: false });
  const tag = `${year}-${String(month).padStart(2, '0')}`;

  return (
    <>
      <Card>
        <CardContent className="p-4">
          <select value={empId} onChange={(e) => setEmpId(e.target.value)} className="h-10 w-full rounded-xl border border-border bg-background px-3 text-sm outline-none focus:ring-2 focus:ring-ring/40 sm:max-w-sm">
            <option value="">Select an employee…</option>
            {list.map((e) => <option key={e.id} value={e.id}>{e.name} {e.employeeCode ? `(${e.employeeCode})` : ''}</option>)}
          </select>
        </CardContent>
      </Card>

      {empId && data && (
        <div className="grid grid-cols-2 gap-4 md:grid-cols-5">
          <Stat label="Present" value={data.summary.present} tint="text-emerald-600" />
          <Stat label="Half days" value={data.summary.half} tint="text-amber-600" />
          <Stat label="Absent" value={data.summary.absent} tint="text-rose-600" />
          <Stat label="Off/Holiday" value={data.summary.off} />
          <Stat label="Worked hrs" value={data.summary.workedHours} tint="text-brand-600" />
        </div>
      )}

      {empId && (
        <TableCard
          title={data ? `${data.employee.name} · ${data.employee.employeeCode} · ${tag}` : `Employee report — ${tag}`}
          loading={isLoading}
          empty={!data ? 'No data.' : null}
          exportPath={`/admin/reports/employee/${empId}?month=${month}&year=${year}`}
          exportName={`employee-${data?.employee.employeeCode ?? empId}-${tag}`}
          onExport={() => data && downloadCsv(`employee-${data.employee.employeeCode}-${tag}.csv`,
            ['Day', 'Status', 'Check-In', 'Check-Out', 'Hours', 'Punch'],
            data.days.map((d) => [d.day, d.status, d.checkIn, d.checkOut, d.workedHours, d.punchMode]))}
        >
          <thead><tr className="border-b border-border/60 text-left text-xs uppercase tracking-wide text-muted-foreground">
            <th className={th}>Date</th><th className={th}>Status</th><th className={th}>Check-In</th><th className={th}>Check-Out</th><th className={th}>Hours</th>
          </tr></thead>
          <tbody>
            {data?.days.map((d) => (
              <tr key={d.day} className="border-b border-border/40 last:border-0 hover:bg-muted/40">
                <td className={td}>
                  {tag}-{String(d.day).padStart(2, '0')}
                  {d.punchMode && d.punchMode !== 'GEO' && <PunchTag mode={d.punchMode} />}
                </td>
                <td className={td}><StatusChip status={d.status} /></td>
                <td className={td}>{d.checkIn ?? '—'}</td>
                <td className={td}>{d.checkOut ?? '—'}</td>
                <td className={td}>{d.workedHours != null ? `${d.workedHours}h` : '—'}</td>
              </tr>
            ))}
          </tbody>
        </TableCard>
      )}
    </>
  );
}
