/**
 * Reading a dealer's own audit trail.
 *
 * The platform console's activity page answers "what did we do to our
 * customers"; this answers the same question one level down, inside a single
 * workspace: who approved that leave, who moved that fence, who ran payroll
 * twice. The platform console's own copy already tells dealers that their
 * staff's activity "lives in their workspace" — this is the surface that makes
 * that true.
 *
 * Rows are tenant-owned, so the Prisma extension scopes every query here by
 * the caller's own tenant. There is deliberately no `tenantId` filter on this
 * endpoint: it is not that one dealer is filtered out of another's log, it is
 * that another dealer's rows are not reachable from this connection at all.
 */
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { requireRole } from '../middleware/auth.js';

const auditQuerySchema = z.object({
  actorId: z.string().optional(),
  entity: z.string().optional(),
  action: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(200).default(50),
  cursor: z.string().optional(),
});

export async function auditRoutes(app: FastifyInstance) {
  /**
   * SUPER_ADMIN only, and not because the log is secret.
   *
   * It carries salary revisions, payroll totals and every approval decision —
   * so it reveals, in one place, things the individual screens keep apart. An
   * HR manager who cannot open the payroll page should not read the payroll
   * figures out of the audit trail either.
   */
  const guard = requireRole('SUPER_ADMIN');

  app.get('/admin/audit', { preHandler: guard }, async (req) => {
    const q = auditQuerySchema.parse(req.query);

    const where = {
      ...(q.actorId ? { adminId: q.actorId } : {}),
      ...(q.entity ? { entity: q.entity } : {}),
      ...(q.action ? { action: q.action } : {}),
    };

    // One row beyond the page: its existence is what says there is more,
    // without a second count query over a log that only ever grows.
    const page = await app.prisma.auditLog.findMany({
      where,
      // Id breaks ties on timestamp. Two entries can share one — a bulk import
      // and its follow-up, or two writes inside a single request — and without
      // a total order the cursor could skip a row or serve it twice.
      orderBy: [{ timestamp: 'desc' }, { id: 'desc' }],
      take: q.limit + 1,
      ...(q.cursor ? { cursor: { id: q.cursor }, skip: 1 } : {}),
    });
    const rows = page.slice(0, q.limit);
    const nextCursor = page.length > q.limit ? (rows[rows.length - 1]?.id ?? null) : null;

    const actors = await actorsFor(rows.map((r) => r.adminId));

    const entries = rows.map((r) => ({
      id: r.id,
      action: r.action,
      entity: r.entity,
      entityId: r.entityId,
      actorId: r.adminId,
      // Accounts are disabled rather than deleted — which is exactly so this
      // line can still name whoever acted, however long ago.
      actorName: actors.get(r.adminId)?.name ?? 'A removed account',
      actorRole: actors.get(r.adminId)?.role ?? null,
      metadata: r.metadata,
      ipAddress: r.ipAddress,
      timestamp: r.timestamp,
    }));

    // Filter options describe the whole log, not the page on screen — otherwise
    // an option disappears as soon as you scroll past its last entry. Sent with
    // the first page only; paging on does not need them again.
    const filters = q.cursor ? undefined : await filterOptions();

    return { entries, nextCursor, ...(filters ? { filters } : {}) };
  });

  /** Resolve admin ids to name and role, in one query. */
  async function actorsFor(ids: string[]): Promise<Map<string, { name: string; role: string }>> {
    const unique = [...new Set(ids)];
    if (unique.length === 0) return new Map();
    const people = await app.prisma.adminUser.findMany({
      where: { id: { in: unique } },
      select: { id: true, name: true, role: true },
    });
    return new Map(people.map((p) => [p.id, { name: p.name, role: p.role }]));
  }

  /**
   * Who has acted, and what kinds of entry exist — grouped in the database
   * rather than counted from the page, so the filters stay complete however
   * long the log grows.
   */
  async function filterOptions() {
    const [byActor, byAction, byEntity] = await Promise.all([
      app.prisma.auditLog.groupBy({ by: ['adminId'], _count: { _all: true } }),
      app.prisma.auditLog.groupBy({ by: ['action'], _count: { _all: true } }),
      app.prisma.auditLog.groupBy({ by: ['entity'], _count: { _all: true } }),
    ]);

    const actors = await actorsFor(byActor.map((a) => a.adminId));

    return {
      actors: byActor
        .map((a) => ({
          id: a.adminId,
          name: actors.get(a.adminId)?.name ?? 'A removed account',
          count: a._count._all,
        }))
        .sort((a, b) => b.count - a.count),
      actions: byAction
        .map((a) => ({ action: a.action, count: a._count._all }))
        .sort((a, b) => b.count - a.count),
      entities: byEntity
        .map((e) => ({ entity: e.entity, count: e._count._all }))
        .sort((a, b) => b.count - a.count),
    };
  }
}
