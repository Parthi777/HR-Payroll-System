'use client';

import { useState } from 'react';
import useSWR from 'swr';
import { fetcher, api } from '@/lib/api';
import { PageHero } from '@/components/page-hero';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Building2, GitBranch, Briefcase, Plus, Loader2, Pencil, Trash2, Check, X, CalendarDays, ChevronLeft, ChevronRight, Info } from 'lucide-react';

interface Named { id: string; name: string }

interface Company {
  name: string; address: string; phone: string; email: string; gstin: string;
  /** Shown to every employee in the phone app, under "Contact HR". */
  hrContactName?: string;
  hrContactPhone?: string;
  /** What a new employee is paid on unless their own record says otherwise. */
  defaultPayrollBasis?: 'MONTHLY' | 'PRESENT_DAYS';
  // Attendance policy
  employeeCodePrefix?: string;
  halfDayWindowStart?: string;
  halfDayWindowEnd?: string;
  lateRequiresApproval?: boolean;
  openPunchLookbackDays?: number;
  manualPunchLatest?: string;
  // Payroll policy
  monthDivisor?: number;
  clPerYear?: number;
  otHoursPerDay?: number;
  payrollLateShiftAt?: number;
  payrollPayDay?: number;
  payrollPayDayLate?: number;
  // Security
  faceMatchThreshold?: number;
}

/**
 * One policy control.
 *
 * Every one of these carries a description rather than only a label. They are
 * bare numbers with consequences that are not guessable from their names —
 * `monthDivisor` sets everyone's per-day rate, `payrollLateShiftAt` moves the
 * salary date — and a number box with no explanation is a trap rather than a
 * setting. `min`/`max` mirror the server's Zod bounds so the browser refuses
 * what the API would refuse, instead of handing back a 400 after the fact.
 */
function Field({
  label, hint, warn, children,
}: { label: string; hint: string; warn?: boolean; children: React.ReactNode }) {
  return (
    <div>
      <label className="mb-1 block text-xs font-medium text-muted-foreground">{label}</label>
      {children}
      <p className={`mt-1 text-xs ${warn ? 'font-medium text-amber-700' : 'text-muted-foreground'}`}>{hint}</p>
    </div>
  );
}

export default function SettingsPage() {
  return (
    <div className="space-y-6">
      <PageHero title="Settings" subtitle="Company profile & master data · live" />
      <CompanyCard />
      <div className="grid gap-4 lg:grid-cols-3">
        <BranchesCard />
        <ListManager title="Departments" icon={Briefcase} endpoint="/admin/departments" listKey="departments" />
        <ListManager title="Designations" icon={GitBranch} endpoint="/admin/designations" listKey="designations" />
      </div>
      <HolidaysCard />
    </div>
  );
}

interface Holiday { id: string; name: string; date: string }

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

/** "2026-08-15" -> a Date at local midnight, matching how the backend stores it. */
function parseDay(iso: string): Date {
  const [y, m, d] = iso.split('-').map(Number);
  return new Date(y, m - 1, d);
}

/**
 * The holiday calendar.
 *
 * Payroll, the muster grid and every report read this list to decide whether a
 * day is a paid day off. A day that is not on it is an ordinary working day, so
 * anyone who stays home for an unlisted holiday is marked absent and docked —
 * which is what the empty state says, because an empty calendar looks the same
 * as a correct one until payday.
 */
function HolidaysCard() {
  const [year, setYear] = useState(() => new Date().getFullYear());
  const { data, isLoading, mutate } = useSWR<{ holidays: Holiday[] }>(`/admin/holidays?year=${year}`, fetcher, { shouldRetryOnError: false });
  const holidays = data?.holidays ?? [];

  const [name, setName] = useState('');
  const [date, setDate] = useState('');
  const [saving, setSaving] = useState(false);
  const [editing, setEditing] = useState<Holiday | null>(null);
  const input = 'h-10 rounded-xl border border-border bg-background px-3 text-sm outline-none focus:ring-2 focus:ring-ring/40';

  async function add() {
    if (!name.trim() || !date) return;
    setSaving(true);
    try {
      await api('/admin/holidays', { method: 'POST', body: JSON.stringify({ name: name.trim(), date }) });
      setName('');
      setDate('');
      await mutate();
    } catch (e) {
      alert(e instanceof Error ? e.message : 'Failed to add holiday');
    } finally {
      setSaving(false);
    }
  }

  async function saveEdit() {
    if (!editing || !editing.name.trim() || !editing.date) return;
    try {
      await api(`/admin/holidays/${editing.id}`, {
        method: 'PUT',
        body: JSON.stringify({ name: editing.name.trim(), date: editing.date }),
      });
      setEditing(null);
      await mutate();
    } catch (e) {
      alert(e instanceof Error ? e.message : 'Failed to save holiday');
    }
  }

  async function remove(h: Holiday) {
    if (!confirm(`Remove "${h.name}" from the ${year} calendar? That day becomes an ordinary working day.`)) return;
    try {
      await api(`/admin/holidays/${h.id}`, { method: 'DELETE' });
      await mutate();
    } catch (e) {
      alert(e instanceof Error ? e.message : 'Failed to remove holiday');
    }
  }

  // Grouped by month so a year reads as a calendar rather than a flat list.
  const byMonth = holidays.reduce<Record<number, Holiday[]>>((acc, h) => {
    const m = parseDay(h.date).getMonth();
    (acc[m] ??= []).push(h);
    return acc;
  }, {});

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between gap-3 space-y-0">
        <CardTitle className="text-base flex items-center gap-2">
          <CalendarDays className="h-4 w-4" /> Holiday Calendar
          <span className="text-xs font-normal text-muted-foreground">(paid days off — counted by payroll)</span>
        </CardTitle>
        <div className="flex items-center gap-1">
          <button onClick={() => setYear(year - 1)} title="Previous year" className="flex h-8 w-8 items-center justify-center rounded-lg border border-border text-muted-foreground hover:text-foreground">
            <ChevronLeft className="h-4 w-4" />
          </button>
          <span className="w-14 text-center text-sm font-semibold tabular-nums">{year}</span>
          <button onClick={() => setYear(year + 1)} title="Next year" className="flex h-8 w-8 items-center justify-center rounded-lg border border-border text-muted-foreground hover:text-foreground">
            <ChevronRight className="h-4 w-4" />
          </button>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        {isLoading && <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />}

        {!isLoading && holidays.length === 0 && (
          <div className="flex gap-3 rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900">
            <Info className="mt-0.5 h-4 w-4 shrink-0" />
            <div>
              <div className="font-semibold">No holidays set for {year}.</div>
              Every day of {year} is treated as an ordinary working day. Staff who stay home for a public
              holiday will be marked absent and the day deducted from their salary. Sundays are handled
              automatically and do not need adding.
            </div>
          </div>
        )}

        {Object.keys(byMonth)
          .map(Number)
          .sort((a, b) => a - b)
          .map((m) => (
            <div key={m} className="space-y-2">
              <div className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">{MONTHS[m]}</div>
              {byMonth[m].map((h) => {
                const d = parseDay(h.date);
                const isSunday = d.getDay() === 0;
                return (
                  <div key={h.id} className="flex items-center gap-2 rounded-xl border border-border/60 bg-muted/30 px-3 py-2 text-sm">
                    {editing?.id === h.id ? (
                      <>
                        <input
                          type="date"
                          value={editing.date}
                          onChange={(e) => setEditing({ ...editing, date: e.target.value })}
                          className="h-8 rounded-lg border border-border bg-background px-2 text-sm outline-none focus:ring-2 focus:ring-ring/40"
                        />
                        <input
                          value={editing.name}
                          onChange={(e) => setEditing({ ...editing, name: e.target.value })}
                          onKeyDown={(e) => e.key === 'Enter' && saveEdit()}
                          autoFocus
                          className="h-8 flex-1 rounded-lg border border-border bg-background px-2 text-sm outline-none focus:ring-2 focus:ring-ring/40"
                        />
                        <button onClick={saveEdit} title="Save" className="flex h-8 w-8 items-center justify-center rounded-lg bg-emerald-50 text-emerald-600 hover:bg-emerald-100">
                          <Check className="h-3.5 w-3.5" />
                        </button>
                        <button onClick={() => setEditing(null)} title="Cancel" className="flex h-8 w-8 items-center justify-center rounded-lg border border-border text-muted-foreground">
                          <X className="h-3.5 w-3.5" />
                        </button>
                      </>
                    ) : (
                      <>
                        <span className="w-28 shrink-0 font-mono text-xs text-muted-foreground">
                          {d.toLocaleDateString(undefined, { weekday: 'short', day: '2-digit', month: 'short' })}
                        </span>
                        <span className="flex-1 truncate font-medium">{h.name}</span>
                        {/* A Sunday is already a paid weekly off, so listing it changes no one's pay. */}
                        {isSunday && <span className="chip chip-leave shrink-0 text-[10px]">already a weekly off</span>}
                        <button onClick={() => setEditing(h)} title="Edit" className="flex h-8 w-8 items-center justify-center rounded-lg border border-border text-muted-foreground hover:text-foreground">
                          <Pencil className="h-3.5 w-3.5" />
                        </button>
                        <button onClick={() => remove(h)} title="Remove" className="flex h-8 w-8 items-center justify-center rounded-lg bg-rose-50 text-rose-600 hover:bg-rose-100">
                          <Trash2 className="h-3.5 w-3.5" />
                        </button>
                      </>
                    )}
                  </div>
                );
              })}
            </div>
          ))}

        <div className="flex flex-col gap-2 border-t border-border/60 pt-3 sm:flex-row">
          <input
            type="date"
            value={date}
            onChange={(e) => setDate(e.target.value)}
            className={`${input} sm:w-44`}
          />
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && add()}
            placeholder="Holiday name (e.g. Independence Day)"
            className={`${input} flex-1`}
          />
          <button onClick={add} disabled={saving || !name.trim() || !date} className="flex h-10 items-center justify-center gap-1 rounded-xl brand-gradient px-4 text-sm font-semibold text-white disabled:opacity-60">
            {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />} Add
          </button>
        </div>
        <p className="text-xs text-muted-foreground">
          Changing this calendar affects payroll the next time a month is run. Months already
          finalised keep the figures they were run with until you re-run them.
        </p>
      </CardContent>
    </Card>
  );
}

/** Company profile — printed on salary slips & the salary register PDF. */
function CompanyCard() {
  const { data, mutate } = useSWR<{ company: Company }>('/admin/company', fetcher, { shouldRetryOnError: false });
  const [f, setF] = useState<Company | null>(null);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const c = f ?? data?.company ?? { name: '', address: '', phone: '', email: '', gstin: '' };
  const set = (k: keyof Company, v: string | number | boolean) => { setSaved(false); setF({ ...c, [k]: v }); };
  /** Empty stays undefined rather than becoming 0 — the server would take a 0. */
  const num = (k: keyof Company, v: string) => set(k, v === '' ? (undefined as never) : Number(v));
  const input = 'h-10 w-full rounded-xl border border-border bg-background px-3 text-sm outline-none focus:ring-2 focus:ring-ring/40';

  async function save() {
    setSaving(true);
    try {
      await api('/admin/company', { method: 'PUT', body: JSON.stringify(c) });
      await mutate();
      setSaved(true);
    } catch (e) {
      alert(e instanceof Error ? e.message : 'Save failed');
    } finally {
      setSaving(false);
    }
  }

  return (
    <Card>
      <CardHeader><CardTitle className="text-base flex items-center gap-2"><Building2 className="h-4 w-4" /> Company Profile <span className="text-xs font-normal text-muted-foreground">(shown on salary slips)</span></CardTitle></CardHeader>
      <CardContent className="grid gap-3 sm:grid-cols-2">
        <input className={`${input} sm:col-span-2`} placeholder="Company name" value={c.name} onChange={(e) => set('name', e.target.value)} />
        <input className={`${input} sm:col-span-2`} placeholder="Address" value={c.address} onChange={(e) => set('address', e.target.value)} />
        <input className={input} placeholder="Phone" value={c.phone} onChange={(e) => set('phone', e.target.value)} />
        <input className={input} placeholder="Email" value={c.email} onChange={(e) => set('email', e.target.value)} />
        <input className={input} placeholder="GSTIN" value={c.gstin} onChange={(e) => set('gstin', e.target.value)} />
        <div className="sm:col-span-2">
          <label className="mb-1 block text-xs font-medium text-muted-foreground">
            Default pay basis — applies to staff whose own record does not set one
          </label>
          <select
            className={input}
            value={c.defaultPayrollBasis ?? 'MONTHLY'}
            onChange={(e) => set('defaultPayrollBasis', e.target.value)}
          >
            <option value="MONTHLY">Monthly — weekly offs and approved leave are paid</option>
            <option value="PRESENT_DAYS">Present days — paid only for days worked</option>
          </select>
        </div>

        <div className="border-t border-border/60 pt-4 sm:col-span-2">
          <h3 className="text-sm font-semibold">Contact HR</h3>
          <p className="mb-3 mt-1 text-xs text-muted-foreground">
            Every employee sees this in the phone app and taps to call. Leave the number empty and
            the button is hidden rather than dialling the company line.
          </p>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Name" hint="Who picks up — a person, not a department, reads better on a phone.">
              <input className={input} placeholder="Latha · HR" value={c.hrContactName ?? ''} onChange={(e) => set('hrContactName', e.target.value)} />
            </Field>
            <Field label="Phone" hint="Dialled straight from the app. Include the country code.">
              <input className={input} placeholder="+91 90000 00000" value={c.hrContactPhone ?? ''} onChange={(e) => set('hrContactPhone', e.target.value)} />
            </Field>
          </div>
        </div>

        <div className="border-t border-border/60 pt-4 sm:col-span-2">
          <h3 className="mb-3 text-sm font-semibold">Attendance policy</h3>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Late punches need approval" hint="On: a late arrival is held for sign-off and the day is unpaid until approved. Off: it is recorded as late and paid normally.">
              <select className={input} value={String(c.lateRequiresApproval ?? true)} onChange={(e) => set('lateRequiresApproval', e.target.value === 'true')}>
                <option value="true">Yes — hold for approval</option>
                <option value="false">No — record and pay</option>
              </select>
            </Field>
            <Field label="Employee code prefix" hint="Leading text on new employee codes, e.g. EMP → EMP001. Existing codes are untouched.">
              <input className={input} maxLength={12} value={c.employeeCodePrefix ?? ''} onChange={(e) => set('employeeCodePrefix', e.target.value)} placeholder="EMP" />
            </Field>
            <Field label="Half-day window opens" hint="A punch in or out inside this window marks the day a half day. Default 12:30.">
              <input type="time" className={input} value={c.halfDayWindowStart ?? ''} onChange={(e) => set('halfDayWindowStart', e.target.value)} />
            </Field>
            <Field label="Half-day window closes" hint="The other end of that window. Default 14:00.">
              <input type="time" className={input} value={c.halfDayWindowEnd ?? ''} onChange={(e) => set('halfDayWindowEnd', e.target.value)} />
            </Field>
            <Field label="Latest self-entered check-out" hint="The latest time an employee may type when settling a forgotten check-out. Past this, HR has to record it. Default 20:00.">
              <input type="time" className={input} value={c.manualPunchLatest ?? ''} onChange={(e) => set('manualPunchLatest', e.target.value)} />
            </Field>
            <Field label="Forgotten check-out lookback (days)" hint="How far back an unclosed day still blocks the next check-in. 0–90, default 7.">
              <input type="number" min={0} max={90} className={input} value={c.openPunchLookbackDays ?? ''} onChange={(e) => num('openPunchLookbackDays', e.target.value)} />
            </Field>
          </div>
        </div>

        <div className="border-t border-border/60 pt-4 sm:col-span-2">
          <h3 className="mb-3 text-sm font-semibold">Payroll policy</h3>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field
              label="Days a month is divided by"
              warn
              hint="Per-day salary = monthly salary ÷ this, whatever the month's real length. Changing it changes every employee's daily rate on the next run. 28–31, default 30."
            >
              <input type="number" min={28} max={31} className={input} value={c.monthDivisor ?? ''} onChange={(e) => num('monthDivisor', e.target.value)} />
            </Field>
            <Field label="Casual leave per year" hint="Paid CL days per calendar year. Beyond this, CL becomes unpaid LOP. 0–60, default 12.">
              <input type="number" min={0} max={60} className={input} value={c.clPerYear ?? ''} onChange={(e) => num('clPerYear', e.target.value)} />
            </Field>
            <Field label="Overtime hours to a day's pay" hint="This many OT hours earns one extra day's salary, pro-rated. 1–24, default 10.">
              <input type="number" min={1} max={24} className={input} value={c.otHoursPerDay ?? ''} onChange={(e) => num('otHoursPerDay', e.target.value)} />
            </Field>
            <Field label="Late punches that move the pay date" hint="At this many late punches in a month, salary shifts to the later pay day. Nothing is withheld. 0–31, default 5.">
              <input type="number" min={0} max={31} className={input} value={c.payrollLateShiftAt ?? ''} onChange={(e) => num('payrollLateShiftAt', e.target.value)} />
            </Field>
            <Field label="Salary pay day" hint="Day of the following month salary is dated. 1–28, default 5.">
              <input type="number" min={1} max={28} className={input} value={c.payrollPayDay ?? ''} onChange={(e) => num('payrollPayDay', e.target.value)} />
            </Field>
            <Field label="Pay day after too many lates" hint="The later date used once the late threshold above is hit. 1–28, default 8.">
              <input type="number" min={1} max={28} className={input} value={c.payrollPayDayLate ?? ''} onChange={(e) => num('payrollPayDayLate', e.target.value)} />
            </Field>
          </div>
          <p className="mt-3 text-xs text-muted-foreground">
            Payroll settings apply the next time a month is run. Months already finalised keep the figures
            they were run with — preview a month before re-running it.
          </p>
        </div>

        <div className="border-t border-border/60 pt-4 sm:col-span-2">
          <h3 className="mb-3 text-sm font-semibold">Security</h3>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field
              label="Face match threshold"
              warn
              hint="Confidence a check-in selfie must reach to be accepted as the logged-in employee. Lower means more wrong faces let through — the floor is 70 for that reason. Default 85."
            >
              <input type="number" min={70} max={100} className={input} value={c.faceMatchThreshold ?? ''} onChange={(e) => num('faceMatchThreshold', e.target.value)} />
            </Field>
          </div>
        </div>

        <div className="flex items-center gap-3 border-t border-border/60 pt-4 sm:col-span-2">
          <button onClick={save} disabled={saving} className="flex h-10 items-center gap-2 rounded-xl brand-gradient px-5 text-sm font-semibold text-white disabled:opacity-60">
            {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />} Save
          </button>
          {saved && <span className="text-sm font-medium text-emerald-600">Saved ✓</span>}
        </div>
      </CardContent>
    </Card>
  );
}

function BranchesCard() {
  const { data, isLoading } = useSWR<{ branches: (Named & { address: string; strictMode: boolean })[] }>('/admin/branches', fetcher, { shouldRetryOnError: false });
  const branches = data?.branches ?? [];
  return (
    <Card>
      <CardHeader><CardTitle className="text-base flex items-center gap-2"><Building2 className="h-4 w-4" /> Branches</CardTitle></CardHeader>
      <CardContent className="space-y-2">
        {isLoading && <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />}
        {branches.map((b) => (
          <div key={b.id} className="rounded-xl border border-border/60 bg-muted/30 p-3">
            <div className="font-medium">{b.name}</div>
            <div className="text-xs text-muted-foreground">{b.address}</div>
          </div>
        ))}
        {!isLoading && branches.length === 0 && <div className="text-sm text-muted-foreground">No branches.</div>}
      </CardContent>
    </Card>
  );
}

function ListManager({ title, icon: Icon, endpoint, listKey }: { title: string; icon: React.ElementType; endpoint: string; listKey: string }) {
  const { data, isLoading, mutate } = useSWR<Record<string, Named[]>>(endpoint, fetcher, { shouldRetryOnError: false });
  const items = data?.[listKey] ?? [];
  const [name, setName] = useState('');
  const [saving, setSaving] = useState(false);
  const [editing, setEditing] = useState<{ id: string; name: string } | null>(null);
  const singular = title.slice(0, -1).toLowerCase();

  async function add() {
    if (!name.trim()) return;
    setSaving(true);
    try {
      await api(endpoint, { method: 'POST', body: JSON.stringify({ name: name.trim() }) });
      setName('');
      await mutate();
    } catch {
      alert(`Failed to add ${singular}`);
    } finally {
      setSaving(false);
    }
  }

  async function rename() {
    if (!editing || !editing.name.trim()) return;
    try {
      await api(`${endpoint}/${editing.id}`, { method: 'PUT', body: JSON.stringify({ name: editing.name.trim() }) });
      setEditing(null);
      await mutate();
    } catch (e) {
      alert(e instanceof Error ? e.message : `Failed to rename ${singular}`);
    }
  }

  async function remove(item: Named) {
    if (!confirm(`Delete ${singular} "${item.name}"?`)) return;
    try {
      await api(`${endpoint}/${item.id}`, { method: 'DELETE' });
      await mutate();
    } catch (e) {
      alert(e instanceof Error ? e.message : `Failed to delete ${singular}`);
    }
  }

  return (
    <Card>
      <CardHeader><CardTitle className="text-base flex items-center gap-2"><Icon className="h-4 w-4" /> {title}</CardTitle></CardHeader>
      <CardContent className="space-y-2">
        {isLoading && <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />}
        {items.map((i) => (
          <div key={i.id} className="flex items-center gap-2 rounded-xl border border-border/60 bg-muted/30 px-3 py-2 text-sm font-medium">
            {editing?.id === i.id ? (
              <>
                <input
                  value={editing.name}
                  onChange={(e) => setEditing({ id: i.id, name: e.target.value })}
                  onKeyDown={(e) => e.key === 'Enter' && rename()}
                  autoFocus
                  className="h-8 flex-1 rounded-lg border border-border bg-background px-2 text-sm outline-none focus:ring-2 focus:ring-ring/40"
                />
                <button onClick={rename} title="Save" className="flex h-8 w-8 items-center justify-center rounded-lg bg-emerald-50 text-emerald-600 hover:bg-emerald-100">
                  <Check className="h-3.5 w-3.5" />
                </button>
                <button onClick={() => setEditing(null)} title="Cancel" className="flex h-8 w-8 items-center justify-center rounded-lg border border-border text-muted-foreground">
                  <X className="h-3.5 w-3.5" />
                </button>
              </>
            ) : (
              <>
                <span className="flex-1 truncate">{i.name}</span>
                <button onClick={() => setEditing({ id: i.id, name: i.name })} title="Rename" className="flex h-8 w-8 items-center justify-center rounded-lg border border-border text-muted-foreground hover:text-foreground">
                  <Pencil className="h-3.5 w-3.5" />
                </button>
                <button onClick={() => remove(i)} title="Delete" className="flex h-8 w-8 items-center justify-center rounded-lg bg-rose-50 text-rose-600 hover:bg-rose-100">
                  <Trash2 className="h-3.5 w-3.5" />
                </button>
              </>
            )}
          </div>
        ))}
        {!isLoading && items.length === 0 && <div className="text-sm text-muted-foreground">None yet.</div>}
        <div className="flex gap-2 pt-2">
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && add()}
            placeholder={`New ${singular}`}
            className="h-10 flex-1 rounded-xl border border-border bg-background px-3 text-sm outline-none focus:ring-2 focus:ring-ring/40"
          />
          <button onClick={add} disabled={saving} className="flex h-10 items-center gap-1 rounded-xl brand-gradient px-3 text-sm font-semibold text-white disabled:opacity-60">
            {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />}
          </button>
        </div>
      </CardContent>
    </Card>
  );
}
