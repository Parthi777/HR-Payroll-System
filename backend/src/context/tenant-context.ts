/**
 * Per-request tenant context.
 *
 * Every database query is scoped by the tenant recorded here rather than by a
 * filter written at the call site — see `tenant-scope.ts` for the rule and
 * `plugins/prisma.ts` for the wiring.
 *
 * The store is a mutable *holder* rather than the context itself. That is what
 * makes it work inside Fastify: the frame has to be opened in an `onRequest`
 * hook (by calling `done()` inside `storage.run`, so the whole rest of the
 * lifecycle runs within it), but the tenant is not known until `authenticate()`
 * has verified the JWT several hooks later. `AsyncLocalStorage.enterWith()` from
 * a `preHandler` does NOT reach the route handler — Fastify invokes the handler
 * from a callback chain created before the hook ran, so the store is lost.
 * Opening the frame early and filling the holder in later is the pattern that
 * actually holds.
 */
import { AsyncLocalStorage } from 'node:async_hooks';

export type TenantContext =
  /** A signed-in member of one tenant. The overwhelmingly common case. */
  | { kind: 'TENANT'; tenantId: string; subjectId: string; role: string; branchId?: string }
  /** Platform staff, operating above tenancy (tenant CRUD, suspension). */
  | { kind: 'PLATFORM'; subjectId: string }
  /**
   * A deliberate, named bypass. Only legitimate for work that cannot know its
   * tenant yet — resolving a login, or an operator script. The reason string is
   * mandatory so `grep -rn "runUnscoped" src` is a complete audit of every
   * bypass in the codebase; `tenancy-extension.test.ts` pins that list.
   */
  | { kind: 'UNSCOPED'; reason: string };

interface Holder {
  ctx?: TenantContext;
  /**
   * The tenant's settings, memoised for the life of one request.
   *
   * A single check-in or report reads them two or three times — the route, the
   * service and the PDF header each ask. They cannot change mid-request, so
   * re-reading is pure waste. Typed as unknown to keep this module free of a
   * dependency on the settings service, which would be circular.
   */
  policy?: unknown;
}

const storage = new AsyncLocalStorage<Holder>();

/** The active context, or undefined outside any frame (which fails closed). */
export function currentContext(): TenantContext | undefined {
  return storage.getStore()?.ctx;
}

/** The tenant to scope queries to, or undefined for platform/unscoped work. */
export function currentTenantId(): string | undefined {
  const ctx = currentContext();
  return ctx?.kind === 'TENANT' ? ctx.tenantId : undefined;
}

/**
 * The tenant to stamp on a new row.
 *
 * Creates name their owner explicitly rather than relying only on the
 * extension: it keeps the code honest for anyone reading it without knowing
 * about the extension, and it satisfies Prisma's types now that `tenantId` is
 * required. The extension still overwrites the value, so a caller cannot create
 * a row inside someone else's tenant by passing a different id.
 */
export function requireTenantId(): string {
  const id = currentTenantId();
  if (!id) throw new Error('No tenant context — refusing to create a tenant-owned row');
  return id;
}

/**
 * The per-request memo for this tenant's settings. Returns undefined outside a
 * request frame, in which case the caller simply reads from the database.
 */
export function cachedPolicy<T>(): T | undefined {
  return storage.getStore()?.policy as T | undefined;
}

/** Record the settings for the rest of this request. */
export function setCachedPolicy(policy: unknown): void {
  const holder = storage.getStore();
  if (holder) holder.policy = policy;
}

/** Drop the memo — called when settings are written, so a later read is fresh. */
export function clearCachedPolicy(): void {
  const holder = storage.getStore();
  if (holder) holder.policy = undefined;
}

/**
 * Open an empty context frame for one request and continue the lifecycle inside
 * it. Registered as an `onRequest` hook; `authenticate()` fills it in via
 * `enterContext` once the JWT is verified.
 */
export function beginRequestContext(done: () => void): void {
  storage.run({}, done);
}

/** Record the context for the current request frame. */
export function enterContext(ctx: TenantContext): void {
  const holder = storage.getStore();
  if (holder) {
    holder.ctx = ctx;
    return;
  }
  // No frame (a script, or a caller outside the request lifecycle). enterWith
  // is sufficient there because nothing has captured an earlier async resource.
  storage.enterWith({ ctx });
}

/**
 * Run `fn` inside its own context frame.
 *
 * The `async () => await fn()` wrapper is load-bearing, not ceremony. Prisma's
 * client methods return a LAZY promise that does not execute until it is
 * awaited, so `storage.run(ctx, () => prisma.x.findMany())` would build the
 * query inside the frame and run it outside — with no context at all. Awaiting
 * inside the callback keeps the execution within the frame.
 */
function inContext<T>(ctx: TenantContext, fn: () => T | Promise<T>): Promise<T> {
  return storage.run({ ctx }, async () => await fn());
}

export function runInTenant<T>(
  ctx: { tenantId: string; subjectId: string; role: string; branchId?: string },
  fn: () => T | Promise<T>,
): Promise<T> {
  return inContext({ kind: 'TENANT', ...ctx }, fn);
}

export function runAsPlatform<T>(subjectId: string, fn: () => T | Promise<T>): Promise<T> {
  return inContext({ kind: 'PLATFORM', subjectId }, fn);
}

/**
 * Escape hatch. Use only where the tenant genuinely cannot be known yet, and
 * say why in `reason` — it is read by humans auditing the bypass list.
 */
export function runUnscoped<T>(reason: string, fn: () => T | Promise<T>): Promise<T> {
  return inContext({ kind: 'UNSCOPED', reason }, fn);
}
