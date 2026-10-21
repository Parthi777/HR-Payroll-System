/**
 * Give an existing platform console account a new password.
 *
 * Unlike create-platform-admin.ts this never creates an account and never
 * touches the name or two-step: it replaces the password, re-enables the
 * account and clears a two-step lockout, nothing else.
 *
 *   railway run --service backend -- npx tsx scripts/reset-platform-password.ts \
 *     --email you@example.com --password '…'
 *
 * (From a laptop, Railway's internal database host is unreachable; the script
 * uses DATABASE_PUBLIC_URL when the environment provides one.)
 */
import { PrismaClient } from '@prisma/client';
import bcrypt from 'bcrypt';

if (process.env.DATABASE_PUBLIC_URL) process.env.DATABASE_URL = process.env.DATABASE_PUBLIC_URL;
const prisma = new PrismaClient();

function arg(flag: string): string | undefined {
  const i = process.argv.indexOf(flag);
  return i > -1 ? process.argv[i + 1] : undefined;
}

const email = arg('--email')?.trim().toLowerCase();
const password = arg('--password');

async function main() {
  if (!email || !password) throw new Error('--email and --password are both required');
  if (password.length < 12) throw new Error('Password must be at least 12 characters');

  const staff = await prisma.platformUser.findUnique({ where: { email }, select: { id: true, name: true, totpEnabledAt: true } });
  if (!staff) {
    const all = await prisma.platformUser.findMany({ select: { email: true } });
    throw new Error(`No console account for ${email}. Accounts: ${all.map((u) => u.email).join(', ') || 'none'}`);
  }

  await prisma.platformUser.update({
    where: { id: staff.id },
    data: { passwordHash: await bcrypt.hash(password, 12), isActive: true, mfaFailures: 0, mfaLockedUntil: null },
  });

  console.log(`\n✓ New password set for ${staff.name} <${email}>`);
  console.log(staff.totpEnabledAt
    ? 'Sign in at /platform/login with it, then the code from your authenticator app.\n'
    : 'Sign in at /platform/login with it; you will set up an authenticator app first.\n');
}

main()
  .catch((e) => {
    console.error(`\n✗ ${e instanceof Error ? e.message : e}\n`);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
