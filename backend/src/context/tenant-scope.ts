/**
 * The tenant-scoping rule, as a pure function so it can be tested without a
 * database or a Prisma client. `plugins/prisma.ts` wraps it in a Prisma client
 * extension that runs it over every operation on every model.
 *
 * Why centrally and not at the call site: there are ~100 queries that fetch
 * across all employees, and a filter forgotten at any one of them is a
 * cross-tenant data breach. Applying the rule in one place means there is one
 * thing to get right and one thing to test.
 */

/** Models that carry a `tenantId` and must never be read across tenants. */
export const TENANT_SCOPED_MODELS = new Set([
  'Employee', 'Attendance', 'GPSLog', 'Branch', 'Department', 'Designation',
  'Shift', 'Leave', 'Claim', 'ClaimMessage', 'LeaveBalance', 'Payslip',
  'Notification', 'WhatsAppLog', 'GeofenceViolation', 'AdminUser', 'AuditLog',
  'TenantSettings', 'Holiday',
]);

/**
 * Models that live above tenancy. Adding a model to this set is a deliberate
 * decision to make its rows visible to every tenant, so keep it short — the
 * DMMF coverage test fails on any model that is in neither set.
 */
export const GLOBAL_MODELS = new Set(['Tenant', 'PlatformUser', 'PlatformAuditLog']);

/** Operations whose `where` is a plain filter, or an extended unique filter. */
const WHERE_OPS = new Set([
  'findUnique', 'findUniqueOrThrow', 'findFirst', 'findFirstOrThrow', 'findMany',
  'count', 'aggregate', 'groupBy', 'update', 'updateMany', 'delete', 'deleteMany', 'upsert',
]);

const CREATE_OPS = new Set(['create', 'createMany']);
const UPDATE_OPS = new Set(['update', 'updateMany', 'upsert']);

type Args = Record<string, unknown> | undefined;

/**
 * Apply the tenant filter to one operation's arguments.
 *
 * `tenantId` is *overwritten* rather than merged, so a caller that supplies
 * another tenant's id — whether by mistake or from a request body — cannot win.
 *
 * Prisma 5's extended `whereUnique` accepts extra non-unique fields alongside a
 * unique one, so `findUnique`/`update`/`delete` take the filter directly and
 * keep their return shapes: a wrong-tenant `findUnique` returns null and a
 * wrong-tenant `update` raises P2025. (Verified against Postgres 16, Prisma
 * 5.22 — this is the reason the extension does not have to rewrite operations.)
 */
export function scopeArgs(operation: string, args: Args, tenantId: string): Args {
  const next: Record<string, unknown> = { ...(args ?? {}) };

  if (WHERE_OPS.has(operation)) {
    next.where = { ...((next.where as object) ?? {}), tenantId };
  }

  if (CREATE_OPS.has(operation) && next.data != null) {
    next.data = Array.isArray(next.data)
      ? next.data.map((row) => ({ ...(row as object), tenantId }))
      : { ...(next.data as object), tenantId };
  }

  // upsert carries its own create payload alongside `where`/`update`.
  if (operation === 'upsert' && next.create != null) {
    next.create = { ...(next.create as object), tenantId };
  }

  // A row must never be moved between tenants by an update.
  if (UPDATE_OPS.has(operation) && next.data != null && !Array.isArray(next.data)) {
    const { tenantId: _dropped, ...rest } = next.data as Record<string, unknown>;
    next.data = rest;
  }
  if (operation === 'upsert' && next.update != null) {
    const { tenantId: _dropped, ...rest } = next.update as Record<string, unknown>;
    next.update = rest;
  }

  return next;
}
