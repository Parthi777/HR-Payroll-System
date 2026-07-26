/**
 * One-time claim migration. Safe to re-run — every step is idempotent.
 *
 *  1. Maps legacy claim types onto the expense-head list
 *     (TRAVEL/ACCOMMODATION -> Travel Expenses, FOOD/MEDICAL -> Staff Welfare).
 *  2. Backfills Claim.claimNo   — every claim, oldest first, from 001.
 *  3. Backfills Claim.voucherNo — approved/paid claims only, in the order they
 *     were approved, from 001.
 *
 * Run after `prisma db push`:  npx tsx scripts/migrate-claims.ts
 * Add --dry-run to print what would change without writing.
 */
import { PrismaClient } from '@prisma/client';
import { LEGACY_CLAIM_TYPE_MAP, isValidClaimType } from '../src/services/claim/claim-types.js';

const prisma = new PrismaClient();
const DRY_RUN = process.argv.includes('--dry-run');

const log = (...args: unknown[]) => console.log(DRY_RUN ? '[dry-run]' : '[migrate]', ...args);

async function migrateTypes(): Promise<void> {
  const claims = await prisma.claim.findMany({ select: { id: true, type: true } });
  const stale = claims.filter((c) => !isValidClaimType(c.type));
  if (stale.length === 0) {
    log('claim types: nothing to migrate');
    return;
  }

  const counts = new Map<string, number>();
  for (const c of stale) {
    // Anything without an explicit legacy mapping lands on OTHER rather than
    // being left as an unrecognised code.
    const next = LEGACY_CLAIM_TYPE_MAP[c.type] ?? 'OTHER';
    counts.set(`${c.type} -> ${next}`, (counts.get(`${c.type} -> ${next}`) ?? 0) + 1);
    if (!DRY_RUN) {
      await prisma.claim.update({ where: { id: c.id }, data: { type: next } });
    }
  }
  for (const [mapping, n] of counts) log(`claim types: ${mapping}  (${n})`);
}

async function backfillClaimNumbers(): Promise<void> {
  const missing = await prisma.claim.findMany({
    where: { claimNo: null },
    orderBy: { createdAt: 'asc' },
    select: { id: true },
  });
  if (missing.length === 0) {
    log('claimNo: nothing to backfill');
    return;
  }
  const highest = await prisma.claim.findFirst({
    where: { claimNo: { not: null } },
    orderBy: { claimNo: 'desc' },
    select: { claimNo: true },
  });
  let next = (highest?.claimNo ?? 0) + 1;
  for (const c of missing) {
    if (!DRY_RUN) await prisma.claim.update({ where: { id: c.id }, data: { claimNo: next } });
    next++;
  }
  log(`claimNo: assigned ${missing.length} (up to ${String(next - 1).padStart(3, '0')})`);
}

async function backfillVoucherNumbers(): Promise<void> {
  // Only approved / paid claims carry a voucher number, in approval order.
  const missing = await prisma.claim.findMany({
    where: { voucherNo: null, status: { in: ['APPROVED', 'PAID'] } },
    orderBy: [{ reviewedAt: 'asc' }, { createdAt: 'asc' }],
    select: { id: true },
  });
  if (missing.length === 0) {
    log('voucherNo: nothing to backfill');
    return;
  }
  const highest = await prisma.claim.findFirst({
    where: { voucherNo: { not: null } },
    orderBy: { voucherNo: 'desc' },
    select: { voucherNo: true },
  });
  let next = (highest?.voucherNo ?? 0) + 1;
  for (const c of missing) {
    if (!DRY_RUN) await prisma.claim.update({ where: { id: c.id }, data: { voucherNo: next } });
    next++;
  }
  log(`voucherNo: assigned ${missing.length} (up to ${String(next - 1).padStart(3, '0')})`);
}

async function main() {
  await migrateTypes();
  await backfillClaimNumbers();
  await backfillVoucherNumbers();
  log('done');
}

main()
  .catch((err) => {
    console.error('[migrate] failed:', err);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
