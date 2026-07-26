/**
 * Running numbers for claims and vouchers.
 *
 * Two independent sequences, both starting at 1 and never reset:
 *   claimNo   — allocated when a claim is received (every claim gets one)
 *   voucherNo — allocated when a claim is APPROVED, so the voucher series has
 *               no gaps for rejected or still-pending claims
 *
 * Both columns are `@unique`, so a concurrent allocation loses the insert with
 * a P2002 rather than silently duplicating a voucher number. We retry on that,
 * which is the right trade-off here: allocations are rare (a handful a day) and
 * this needs no extra counter table to stay correct.
 */
import type { PrismaClient } from '@prisma/client';

/** Zero-padded document number for display and print: 1 -> "001", 1234 -> "1234". */
export const formatDocNo = (n: number | null | undefined): string | null =>
  n == null ? null : String(n).padStart(3, '0');

const MAX_ATTEMPTS = 5;
const isUniqueViolation = (e: unknown) => (e as { code?: string })?.code === 'P2002';

/** Highest number issued so far on `field` (0 when none). */
async function currentMax(prisma: PrismaClient, field: 'claimNo' | 'voucherNo'): Promise<number> {
  const row = await prisma.claim.findFirst({
    where: { [field]: { not: null } },
    orderBy: { [field]: 'desc' },
    select: { [field]: true },
  });
  return (row as Record<string, number | null> | null)?.[field] ?? 0;
}

/**
 * Allocate the next number on `field` and hand it to `apply`, which performs the
 * write that claims it. Retries when another request took the same number first.
 */
export async function withNextNumber<T>(
  prisma: PrismaClient,
  field: 'claimNo' | 'voucherNo',
  apply: (next: number) => Promise<T>,
): Promise<T> {
  let next = (await currentMax(prisma, field)) + 1;
  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
    try {
      return await apply(next);
    } catch (err) {
      if (!isUniqueViolation(err) || attempt === MAX_ATTEMPTS - 1) throw err;
      // Someone else took it — re-read the high-water mark and try again.
      next = Math.max(next + 1, (await currentMax(prisma, field)) + 1);
    }
  }
  throw new Error(`Could not allocate a ${field}`);
}
