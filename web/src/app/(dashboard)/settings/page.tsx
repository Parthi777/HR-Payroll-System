'use client';

import { useState } from 'react';
import useSWR from 'swr';
import { fetcher, api } from '@/lib/api';
import { PageHero } from '@/components/page-hero';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Building2, GitBranch, Briefcase, Plus, Loader2, Pencil, Trash2, Check, X } from 'lucide-react';

interface Named { id: string; name: string }

interface Company { name: string; address: string; phone: string; email: string; gstin: string }

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
    </div>
  );
}

/** Company profile — printed on salary slips & the salary register PDF. */
function CompanyCard() {
  const { data, mutate } = useSWR<{ company: Company }>('/admin/company', fetcher, { shouldRetryOnError: false });
  const [f, setF] = useState<Company | null>(null);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const c = f ?? data?.company ?? { name: '', address: '', phone: '', email: '', gstin: '' };
  const set = (k: keyof Company, v: string) => { setSaved(false); setF({ ...c, [k]: v }); };
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
        <div className="flex items-center gap-3 sm:col-span-2">
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
