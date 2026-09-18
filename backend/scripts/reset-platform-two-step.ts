/**
 * Clear a platform administrator's two-step verification from the command line.
 *
 * The last resort, for when the phone is gone, the recovery codes are gone, and
 * there is no other administrator to reset it from the console (Team → Reset
 * two-step). Needs the production database URL, which is the point: whoever
 * can run this could already change anything, so it opens no new door.
 *
 *   DATABASE_URL=<railway DATABASE_PUBLIC_URL> \
 *     npx tsx scripts/reset-platform-two-step.ts --email you@example.com
 *
 * The account's next sign-in walks through enrolment again. Do that straight
 * away: until it is done, the password alone is what stands between anyone
 * holding it and setting up their own authenticator on the account.
 */
import { PrismaClient } from '@prisma/client';
import { TWO_STEP_CLEARED } from '../src/services/platform/two-step.service.js';

const prisma = new PrismaClient();

function arg(flag: string): string | undefined {
  const i = process.argv.indexOf(flag);
  return i > -1 ? process.argv[i + 1] : undefined;
}

async function main() {
  const email = arg('--email')?.trim().toLowerCase();
  if (!email) throw new Error('--email is required');

  const staff = await prisma.platformUser.findUnique({ where: { email } });
  if (!staff) throw new Error(`No platform account for ${email}`);

  await prisma.platformUser.update({ where: { id: staff.id }, data: TWO_STEP_CLEARED });
  // Recorded against the account itself: there is no signed-in actor here.
  await prisma.platformAuditLog.create({
    data: {
      platformUserId: staff.id,
      action: 'PLATFORM_USER_TWO_STEP_RESET',
      targetId: staff.id,
      metadata: JSON.stringify({ email, via: 'scripts/reset-platform-two-step.ts' }),
    },
  });

  console.log(`\n✓ Two-step verification cleared for ${staff.name} <${staff.email}>`);
  console.log('  Sign in to the console now — the next sign-in sets up a new authenticator.\n');
}

main()
  .catch((e) => {
    console.error(`\n✗ ${e instanceof Error ? e.message : e}\n`);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
