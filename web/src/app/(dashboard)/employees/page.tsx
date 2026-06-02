import { PageHero } from '@/components/page-hero';
import { Card, CardContent } from '@/components/ui/card';
import { UserPlus, Upload } from 'lucide-react';

const employees = [
  { name: 'Ravi Kumar', role: 'Sales Executive', branch: 'Bhavani', status: 'Present' },
  { name: 'Priya S', role: 'Accountant', branch: 'Erode', status: 'Present' },
  { name: 'Arjun M', role: 'Technician', branch: 'Salem', status: 'Absent' },
  { name: 'Divya R', role: 'HR Associate', branch: 'Bhavani', status: 'Present' },
  { name: 'Karthik V', role: 'Driver', branch: 'Erode', status: 'On Leave' },
  { name: 'Meena L', role: 'Receptionist', branch: 'Salem', status: 'Present' },
];

const chipClass: Record<string, string> = {
  Present: 'chip-present',
  Absent: 'chip-off',
  'On Leave': 'chip-leave',
};

export default function EmployeesPage() {
  return (
    <div className="space-y-6">
      <PageHero title="Employees" subtitle="Manage staff, face enrollment & assignments">
        <button className="flex h-10 items-center gap-2 rounded-xl bg-white/15 px-4 text-sm font-medium ring-1 ring-white/25 hover:bg-white/25">
          <Upload className="h-4 w-4" /> Bulk Import
        </button>
        <button className="flex h-10 items-center gap-2 rounded-xl bg-white px-4 text-sm font-semibold text-brand-600 hover:bg-white/90">
          <UserPlus className="h-4 w-4" /> Add Employee
        </button>
      </PageHero>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {employees.map((e) => (
          <Card key={e.name}>
            <CardContent className="flex items-center gap-4 p-5">
              <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-full brand-gradient text-sm font-bold text-white">
                {e.name.split(' ').map((n) => n[0]).join('')}
              </div>
              <div className="min-w-0 flex-1">
                <div className="truncate font-semibold">{e.name}</div>
                <div className="truncate text-xs text-muted-foreground">
                  {e.role} · {e.branch}
                </div>
              </div>
              <span className={`chip ${chipClass[e.status]}`}>{e.status}</span>
            </CardContent>
          </Card>
        ))}
      </div>
    </div>
  );
}
