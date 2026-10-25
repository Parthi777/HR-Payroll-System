/**
 * Live-tracking fixes are kept for GPS_RETENTION_DAYS and then deleted.
 *
 * Two-minute fixes come to ~300 rows per employee per tracked day; nobody asks
 * where someone stood last year, and keeping it would only make a leak worse.
 *
 * Same shape as the reminder scheduler: tenants listed as the platform, then
 * entered one at a time — never one unscoped delete across every dealer.
 * Started from `start()` in server.ts, never from `buildServer()`.
 */
import type { PrismaClient } from '@prisma/client';
import { runAsPlatform, runInTenant } from '../../context/tenant-context.js';
import { env } from '../../config/env.js';
import { logger } from '../../utils/logger.js';

export async function purgeOldTracking(prisma: PrismaClient, now: Date = new Date()): Promise<number> {
  const before = new Date(now.getTime() - env.GPS_RETENTION_DAYS * 86_400_000);
  const tenants = await runAsPlatform('tracking-retention', () =>
    prisma.tenant.findMany({ select: { id: true } }),
  );
  let total = 0;
  for (const tenant of tenants) {
    try {
      const { count } = await runInTenant(
        { tenantId: tenant.id, subjectId: 'tracking-retention', role: 'SUPER_ADMIN' },
        () => prisma.gPSLog.deleteMany({ where: { timestamp: { lt: before } } }),
      );
      total += count;
    } catch (err) {
      logger.warn({ err, tenantId: tenant.id }, 'tracking retention failed for tenant');
    }
  }
  if (total > 0) logger.info({ deleted: total, before }, 'old live-tracking fixes purged');
  return total;
}

export function startTrackingRetention(prisma: PrismaClient): () => void {
  const run = () => void purgeOldTracking(prisma).catch((err) => logger.warn({ err }, 'tracking retention failed'));
  // Not at boot itself: a redeploy should not spend its first seconds deleting.
  const first = setTimeout(run, 5 * 60_000);
  const timer = setInterval(run, 24 * 60 * 60_000);
  first.unref();
  timer.unref();
  return () => {
    clearTimeout(first);
    clearInterval(timer);
  };
}
