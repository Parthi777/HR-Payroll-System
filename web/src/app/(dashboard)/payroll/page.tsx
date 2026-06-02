import { PageHero } from '@/components/page-hero';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Play, Send } from 'lucide-react';

const payslips = [
  { name: 'Ravi Kumar', gross: '₹32,000', deductions: '₹3,840', net: '₹28,160', status: 'Paid' },
  { name: 'Priya S', gross: '₹28,500', deductions: '₹3,420', net: '₹25,080', status: 'Paid' },
  { name: 'Arjun M', gross: '₹24,000', deductions: '₹2,880', net: '₹21,120', status: 'Draft' },
  { name: 'Divya R', gross: '₹30,000', deductions: '₹3,600', net: '₹26,400', status: 'Draft' },
];

export default function PayrollPage() {
  return (
    <div className="space-y-6">
      <PageHero title="Payroll" subtitle="February 2026 · 86 employees">
        <button className="flex h-10 items-center gap-2 rounded-xl bg-white/15 px-4 text-sm font-medium ring-1 ring-white/25 hover:bg-white/25">
          <Send className="h-4 w-4" /> Send Slips
        </button>
        <button className="flex h-10 items-center gap-2 rounded-xl bg-white px-4 text-sm font-semibold text-brand-600 hover:bg-white/90">
          <Play className="h-4 w-4" /> Run Payroll
        </button>
      </PageHero>

      <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
        <Card><CardContent className="p-5"><div className="text-2xl font-bold">₹24.6L</div><div className="text-xs text-muted-foreground">Gross Payout</div></CardContent></Card>
        <Card><CardContent className="p-5"><div className="text-2xl font-bold text-rose-600">₹2.9L</div><div className="text-xs text-muted-foreground">Total Deductions</div></CardContent></Card>
        <Card><CardContent className="p-5"><div className="text-2xl font-bold text-emerald-600">₹21.7L</div><div className="text-xs text-muted-foreground">Net Payout</div></CardContent></Card>
        <Card><CardContent className="p-5"><div className="text-2xl font-bold text-amber-600">12</div><div className="text-xs text-muted-foreground">Pending Slips</div></CardContent></Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Payslips</CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border/60 text-left text-xs uppercase tracking-wide text-muted-foreground">
                  <th className="px-6 py-3 font-medium">Employee</th>
                  <th className="px-6 py-3 font-medium">Gross</th>
                  <th className="px-6 py-3 font-medium">Deductions</th>
                  <th className="px-6 py-3 font-medium">Net</th>
                  <th className="px-6 py-3 font-medium">Status</th>
                </tr>
              </thead>
              <tbody>
                {payslips.map((p) => (
                  <tr key={p.name} className="border-b border-border/40 last:border-0 hover:bg-muted/40">
                    <td className="px-6 py-4 font-medium">{p.name}</td>
                    <td className="px-6 py-4">{p.gross}</td>
                    <td className="px-6 py-4 text-rose-600">- {p.deductions}</td>
                    <td className="px-6 py-4 font-semibold text-emerald-600">{p.net}</td>
                    <td className="px-6 py-4">
                      <span className={`chip ${p.status === 'Paid' ? 'chip-present' : 'chip-half'}`}>{p.status}</span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
