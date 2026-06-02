'use client';

import useSWR from 'swr';
import { fetcher } from '@/lib/api';
import { PageHero } from '@/components/page-hero';
import { Card, CardContent } from '@/components/ui/card';
import { UserPlus, Upload, Loader2 } from 'lucide-react';

interface EmployeeRow {
  id: string;
  name: string;
  employeeCode: string;
  phone: string;
  status: string;
  branch?: { name: string } | null;
}

const chipClass: Record<string, string> = {
  ACTIVE: 'chip-present',
  INACTIVE: 'chip-off',
  SUSPENDED: 'chip-half',
};

export default function EmployeesPage() {
  const { data, error, isLoading } = useSWR<{ employees: EmployeeRow[] }>(
    '/admin/employees',
    fetcher,
    { shouldRetryOnError: false },
  );
  const employees = data?.employees ?? [];

  return (
    <div className="space-y-6">
      <PageHero title="Employees" subtitle={`${employees.length} staff · live from database`}>
        <button className="flex h-10 items-center gap-2 rounded-xl bg-white/15 px-4 text-sm font-medium ring-1 ring-white/25 hover:bg-white/25">
          <Upload className="h-4 w-4" /> Bulk Import
        </button>
        <button className="flex h-10 items-center gap-2 rounded-xl bg-white px-4 text-sm font-semibold text-brand-600 hover:bg-white/90">
          <UserPlus className="h-4 w-4" /> Add Employee
        </button>
      </PageHero>

      {isLoading && (
        <div className="flex items-center gap-2 text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" /> Loading employees…
        </div>
      )}
      {error && (
        <Card><CardContent className="p-5 text-sm text-destructive">
          Couldn&apos;t load employees. Make sure you&apos;re signed in and the backend is running.
        </CardContent></Card>
      )}

      {!isLoading && !error && (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {employees.length === 0 && (
            <Card><CardContent className="p-5 text-sm text-muted-foreground">No employees yet.</CardContent></Card>
          )}
          {employees.map((e) => (
            <Card key={e.id}>
              <CardContent className="flex items-center gap-4 p-5">
                <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-full brand-gradient text-sm font-bold text-white">
                  {e.name.split(' ').map((n) => n[0]).join('').slice(0, 2)}
                </div>
                <div className="min-w-0 flex-1">
                  <div className="truncate font-semibold">{e.name}</div>
                  <div className="truncate text-xs text-muted-foreground">
                    {e.employeeCode} · {e.branch?.name ?? '—'}
                  </div>
                </div>
                <span className={`chip ${chipClass[e.status] ?? 'chip-leave'}`}>{e.status}</span>
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
