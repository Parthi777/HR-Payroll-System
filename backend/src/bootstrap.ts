import type { PrismaClient } from '@prisma/client';
import { logger } from './utils/logger.js';

/**
 * Boot-time readiness check.
 *
 * This used to seed a company on any empty database — an admin, a branch, a
 * shift and a demo employee. Under multi-tenancy that is the wrong shape: there
 * is no "the company" any more, and an AdminUser without a tenant cannot exist
 * (tenantId is required, and every query is tenant-scoped). Provisioning now
 * belongs to the platform console, which creates the tenant, its settings, its
 * first admin and its default org data as one unit.
 *
 * So this no longer writes anything. It only reports whether the deployment has
 * been provisioned, which is the useful thing to see in the boot logs.
 *
 * Note it queries Tenant, a global model — a tenant-scoped model could not be
 * read here at all, because there is no request and therefore no tenant context.
 */
export async function ensureSeedData(prisma: PrismaClient): Promise<void> {
  const [tenants, platformAdmins] = await Promise.all([
    prisma.tenant.count(),
    prisma.platformUser.count(),
  ]);

  if (platformAdmins === 0) {
    logger.warn(
      'No platform administrator exists. Create one with: ' +
        'npx tsx scripts/create-platform-admin.ts --email … --name … --password …',
    );
  }

  if (tenants === 0) {
    logger.warn(
      'No tenants are provisioned — the API will accept no logins. ' +
        'Create the first tenant from the platform console, or with scripts/create-tenant.ts',
    );
    return;
  }

  const active = await prisma.tenant.count({ where: { status: 'ACTIVE' } });
  logger.info({ tenants, active }, 'Tenants provisioned');
}
