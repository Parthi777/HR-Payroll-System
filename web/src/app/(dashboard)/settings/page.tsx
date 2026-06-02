'use client';

import { useState } from 'react';
import useSWR from 'swr';
import { fetcher, api } from '@/lib/api';
import { PageHero } from '@/components/page-hero';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Building2, GitBranch, Briefcase, Plus, Loader2 } from 'lucide-react';

interface Named { id: string; name: string }

export default function SettingsPage() {
  return (
    <div className="space-y-6">
      <PageHero title="Settings" subtitle="Company master data · live" />
      <div className="grid gap-4 lg:grid-cols-3">
        <BranchesCard />
        <ListManager title="Departments" icon={Briefcase} endpoint="/admin/departments" listKey="departments" />
        <ListManager title="Designations" icon={GitBranch} endpoint="/admin/designations" listKey="designations" />
      </div>
    </div>
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

  async function add() {
    if (!name.trim()) return;
    setSaving(true);
    try {
      await api(endpoint, { method: 'POST', body: JSON.stringify({ name: name.trim() }) });
      setName('');
      await mutate();
    } catch {
      alert(`Failed to add ${title.slice(0, -1).toLowerCase()}`);
    } finally {
      setSaving(false);
    }
  }

  return (
    <Card>
      <CardHeader><CardTitle className="text-base flex items-center gap-2"><Icon className="h-4 w-4" /> {title}</CardTitle></CardHeader>
      <CardContent className="space-y-2">
        {isLoading && <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />}
        {items.map((i) => (
          <div key={i.id} className="rounded-xl border border-border/60 bg-muted/30 px-3 py-2 text-sm font-medium">{i.name}</div>
        ))}
        {!isLoading && items.length === 0 && <div className="text-sm text-muted-foreground">None yet.</div>}
        <div className="flex gap-2 pt-2">
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && add()}
            placeholder={`New ${title.slice(0, -1).toLowerCase()}`}
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
