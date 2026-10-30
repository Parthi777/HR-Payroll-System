/**
 * Delete every voucher (claim) in one dealer's workspace — for clearing out
 * test vouchers before a dealer goes live. Cannot be undone.
 *
 *   railway run --service Postgres -- sh -c \
 *     'DATABASE_URL="$DATABASE_PUBLIC_URL" npx tsx scripts/clear-claims.ts --dealer dharani'
 *
 * Without --confirm it only counts what would go. With --confirm, in one
 * transaction: the claims, their chat messages (cascade), the bell
 * notifications that point at them, and any ERP sync events for them.
 *
 * Kept on purpose: the audit trail (it records what happened, test or not) and
 * the scanned bills in Google Drive / S3. Numbering restarts at 001 by itself —
 * claim and voucher numbers are allocated as the highest so far + 1.
 *
 * --dealer is the workspace address (slug) or part of the dealer's name.
 */
import { PrismaClient } from '@prisma/client';

if (process.env.DATABASE_PUBLIC_URL) process.env.DATABASE_URL = process.env.DATABASE_PUBLIC_URL;
const prisma = new PrismaClient();

function arg(flag: string): string | undefined {
  const i = process.argv.indexOf(flag);
  return i > -1 ? process.argv[i + 1] : undefined;
}

const dealer = arg('--dealer')?.trim();
const confirm = process.argv.includes('--confirm');

async function main() {
  if (!dealer) throw new Error('--dealer is required');

  const tenants = await prisma.tenant.findMany({
    where: { OR: [{ slug: dealer.toLowerCase() }, { name: { contains: dealer, mode: 'insensitive' } }] },
    select: { id: true, slug: true, name: true },
  });
  if (tenants.length !== 1) {
    const all = await prisma.tenant.findMany({ select: { slug: true, name: true } });
    throw new Error(
      `${tenants.length ? 'More than one' : 'No'} dealer matches "${dealer}". Dealers: ${all.map((t) => `${t.name} (${t.slug})`).join(', ')}`,
    );
  }
  const tenant = tenants[0];
  const tenantId = tenant.id;

  const claims = await prisma.claim.findMany({ where: { tenantId }, select: { id: true, status: true, claimNo: true, voucherNo: true } });
  const ids = claims.map((c) => c.id);
  const byStatus = claims.reduce<Record<string, number>>((n, c) => ({ ...n, [c.status]: (n[c.status] ?? 0) + 1 }), {});
  const [messages, notifications, events] = await Promise.all([
    prisma.claimMessage.count({ where: { tenantId, claimId: { in: ids } } }),
    prisma.notification.count({ where: { tenantId, claimId: { in: ids } } }),
    prisma.integrationEvent.count({ where: { tenantId, entityId: { in: ids } } }),
  ]);
  const highest = (k: 'claimNo' | 'voucherNo') => Math.max(0, ...claims.map((c) => c[k] ?? 0));

  console.log(`${tenant.name} (${tenant.slug})`);
  console.log(`  vouchers:       ${claims.length}  ${JSON.stringify(byStatus)}`);
  console.log(`  numbers in use: claim up to ${highest('claimNo')}, voucher up to ${highest('voucherNo')}`);
  console.log(`  chat messages:  ${messages}`);
  console.log(`  notifications:  ${notifications}`);
  console.log(`  ERP sync events: ${events}`);

  if (!confirm) {
    console.log('\nDry run — nothing deleted. Add --confirm to delete all of the above.');
    return;
  }
  if (claims.length === 0) {
    console.log('\nNothing to delete.');
    return;
  }

  const [ev, no, cl] = await prisma.$transaction([
    prisma.integrationEvent.deleteMany({ where: { tenantId, entityId: { in: ids } } }),
    prisma.notification.deleteMany({ where: { tenantId, claimId: { in: ids } } }),
    // Chat messages go with their claim (onDelete: Cascade).
    prisma.claim.deleteMany({ where: { tenantId, id: { in: ids } } }),
  ]);
  console.log(`\nDeleted ${cl.count} voucher(s), ${no.count} notification(s), ${ev.count} ERP event(s). The next voucher is numbered 001.`);
}

main()
  .catch((e) => {
    console.error(e instanceof Error ? e.message : e);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
