/**
 * The tenant-isolation invariant, pinned.
 *
 * These run without a database: `scopeArgs` is a pure function, and the DMMF
 * check reads the generated client's metadata. The end-to-end proof that no
 * route leaks across tenants lives in tests/isolation.test.ts.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'fs';
import path from 'path';
import { Prisma } from '@prisma/client';
import {
  scopeArgs,
  TENANT_SCOPED_MODELS,
  GLOBAL_MODELS,
} from '../src/context/tenant-scope.js';
import { currentContext, runInTenant, runUnscoped } from '../src/context/tenant-context.js';

const T = 'tenant-a';

describe('scopeArgs — reads', () => {
  it('filters findMany by tenant', () => {
    expect(scopeArgs('findMany', { where: { status: 'ACTIVE' } }, T)).toEqual({
      where: { status: 'ACTIVE', tenantId: T },
    });
  });

  it('filters a findMany that has no where at all', () => {
    expect(scopeArgs('findMany', undefined, T)).toEqual({ where: { tenantId: T } });
  });

  it('filters findUnique — Prisma 5 accepts a non-unique field beside the unique one', () => {
    expect(scopeArgs('findUnique', { where: { id: 'x' } }, T)).toEqual({
      where: { id: 'x', tenantId: T },
    });
  });

  it('filters count, aggregate and groupBy', () => {
    for (const op of ['count', 'aggregate', 'groupBy']) {
      expect(scopeArgs(op, {}, T)).toMatchObject({ where: { tenantId: T } });
    }
  });

  it('preserves a composite unique key alongside the tenant filter', () => {
    expect(
      scopeArgs('findUnique', { where: { employeeId_date: { employeeId: 'e', date: 'd' } } }, T),
    ).toEqual({ where: { employeeId_date: { employeeId: 'e', date: 'd' }, tenantId: T } });
  });

  it('leaves unrelated arguments untouched', () => {
    const args = { where: {}, orderBy: { date: 'desc' }, take: 30, include: { branch: true } };
    expect(scopeArgs('findMany', args, T)).toMatchObject({
      orderBy: { date: 'desc' },
      take: 30,
      include: { branch: true },
    });
  });
});

describe('scopeArgs — a caller cannot choose the tenant', () => {
  it('overwrites a tenantId supplied in a read filter', () => {
    const out = scopeArgs('findMany', { where: { tenantId: 'tenant-b' } }, T);
    expect((out!.where as Record<string, string>).tenantId).toBe(T);
  });

  it('overwrites a tenantId supplied on create', () => {
    const out = scopeArgs('create', { data: { name: 'x', tenantId: 'tenant-b' } }, T);
    expect((out!.data as Record<string, string>).tenantId).toBe(T);
  });

  it('strips tenantId from update data, so a row cannot be moved between tenants', () => {
    const out = scopeArgs('update', { where: { id: 'x' }, data: { name: 'n', tenantId: 'tenant-b' } }, T);
    expect(out!.data).toEqual({ name: 'n' });
    expect(out!.where).toEqual({ id: 'x', tenantId: T });
  });
});

describe('scopeArgs — writes', () => {
  it('stamps the tenant on create', () => {
    expect(scopeArgs('create', { data: { name: 'x' } }, T)).toEqual({
      data: { name: 'x', tenantId: T },
    });
  });

  it('stamps the tenant on every row of createMany', () => {
    const out = scopeArgs('createMany', { data: [{ n: 1 }, { n: 2 }] }, T);
    expect(out!.data).toEqual([{ n: 1, tenantId: T }, { n: 2, tenantId: T }]);
  });

  it('scopes both halves of an upsert', () => {
    const out = scopeArgs(
      'upsert',
      { where: { id: 'x' }, create: { name: 'c' }, update: { name: 'u', tenantId: 'tenant-b' } },
      T,
    );
    expect(out!.where).toEqual({ id: 'x', tenantId: T });
    expect(out!.create).toEqual({ name: 'c', tenantId: T });
    expect(out!.update).toEqual({ name: 'u' });
  });

  it('scopes delete and deleteMany', () => {
    expect(scopeArgs('delete', { where: { id: 'x' } }, T)!.where).toEqual({ id: 'x', tenantId: T });
    expect(scopeArgs('deleteMany', { where: { status: 'OLD' } }, T)!.where).toEqual({
      status: 'OLD',
      tenantId: T,
    });
  });

  it('does not mutate the caller-supplied arguments', () => {
    const args = { where: { id: 'x' }, data: { name: 'n' } };
    scopeArgs('update', args, T);
    expect(args).toEqual({ where: { id: 'x' }, data: { name: 'n' } });
  });
});

describe('context helpers', () => {
  /**
   * Regression: Prisma's client methods return a promise that does not execute
   * until awaited. A helper written as `storage.run(ctx, () => prisma.x.find())`
   * builds the query inside the context frame and executes it outside, with no
   * context — so the query either throws or, worse, runs unfiltered. The helper
   * must await inside the frame. This fake reproduces the laziness exactly.
   */
  it('keeps the context active while a lazily-executed promise runs', async () => {
    let kindSeenAtExecution: string | undefined;
    const lazy = {
      then(resolve: (v: unknown) => void) {
        kindSeenAtExecution = currentContext()?.kind;
        resolve(undefined);
      },
    };

    await runUnscoped('regression test', () => lazy as unknown as Promise<unknown>);
    expect(kindSeenAtExecution).toBe('UNSCOPED');

    await runInTenant({ tenantId: T, subjectId: 's', role: 'SUPER_ADMIN' }, () => lazy as unknown as Promise<unknown>);
    expect(kindSeenAtExecution).toBe('TENANT');
  });

  it('leaves no context behind after the frame exits', async () => {
    await runUnscoped('test', async () => undefined);
    expect(currentContext()).toBeUndefined();
  });
});

describe('model coverage', () => {
  /**
   * The guard that keeps this true over time: a model added to the schema
   * without deciding its tenancy fails the build here, rather than quietly
   * becoming readable by every tenant.
   */
  it('classifies every model in the Prisma schema', () => {
    const unclassified = Prisma.dmmf.datamodel.models
      .map((m) => m.name)
      .filter((n) => !TENANT_SCOPED_MODELS.has(n) && !GLOBAL_MODELS.has(n));
    expect(unclassified, `add these to TENANT_SCOPED_MODELS or GLOBAL_MODELS: ${unclassified}`).toEqual([]);
  });

  it('every tenant-scoped model actually has a tenantId field', () => {
    const missing = Prisma.dmmf.datamodel.models
      .filter((m) => TENANT_SCOPED_MODELS.has(m.name))
      .filter((m) => !m.fields.some((f) => f.name === 'tenantId'))
      .map((m) => m.name);
    expect(missing).toEqual([]);
  });

  it('no global model carries a tenantId', () => {
    const stray = Prisma.dmmf.datamodel.models
      .filter((m) => GLOBAL_MODELS.has(m.name))
      .filter((m) => m.fields.some((f) => f.name === 'tenantId'))
      .map((m) => m.name);
    expect(stray).toEqual([]);
  });
});

describe('bypass audit', () => {
  /**
   * `runUnscoped` disables tenant filtering, so the set of places that call it
   * is a security boundary. This asserts the list rather than the count, so
   * adding one is a deliberate act that shows up in review.
   */
  const ALLOWED = new Set<string>([
    // populated as Phase 4 adds login resolution; every entry needs a reason
  ]);

  function walk(dir: string): string[] {
    return readdirSync(dir).flatMap((entry) => {
      const full = path.join(dir, entry);
      return statSync(full).isDirectory() ? walk(full) : full.endsWith('.ts') ? [full] : [];
    });
  }

  it('only the reviewed call sites bypass tenant scoping', () => {
    const src = path.resolve(__dirname, '../src');
    const callers = walk(src)
      .filter((file) => !file.endsWith('tenant-context.ts')) // its own definition
      .filter((file) => readFileSync(file, 'utf8').includes('runUnscoped('))
      .map((file) => path.relative(src, file))
      .sort();
    expect(
      callers.filter((c) => !ALLOWED.has(c)),
      'a new runUnscoped() bypass appeared — review it, then add it to ALLOWED',
    ).toEqual([]);
  });
});
