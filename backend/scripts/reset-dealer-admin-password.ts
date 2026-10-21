/**
 * Give a dealer's Master Control login a new password, from the command line.
 *
 * For the admin nobody can reset from a screen: the dealer's only Super Admin,
 * locked out — including one who only ever signed in with Google, which no
 * longer exists. (With a console account, Dealers → the dealer → New password
 * does the same.) Never creates an account; replaces the password, re-enables
 * the login and clears a two-step lockout, nothing else.
 *
 *   railway run --service backend -- npx tsx scripts/reset-dealer-admin-password.ts \
 *     --dealer "Dharani TVS" --email you@example.com --password '…'
 *
 * --dealer is the workspace address (slug) or part of the dealer's name.
 * --email may be left out when the dealer has exactly one Super Admin.
 */
import { PrismaClient } from '@prisma/client';
import bcrypt from 'bcrypt';

if (process.env.DATABASE_PUBLIC_URL) process.env.DATABASE_URL = process.env.DATABASE_PUBLIC_URL;
const prisma = new PrismaClient();

function arg(flag: string): string | undefined {
  const i = process.argv.indexOf(flag);
  return i > -1 ? process.argv[i + 1] : undefined;
}

const dealer = arg('--dealer')?.trim();
const email = arg('--email')?.trim().toLowerCase();
const password = arg('--password');

async function main() {
  if (!dealer || !password) throw new Error('--dealer and --password are required');
  if (password.length < 12) throw new Error('Password must be at least 12 characters');

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

  const admins = await prisma.adminUser.findMany({
    where: { tenantId: tenant.id },
    select: { id: true, name: true, email: true, role: true, isActive: true },
  });
  const list = admins.map((a) => `${a.email} (${a.role}${a.isActive ? '' : ', disabled'})`).join(', ') || 'none';
  const supers = admins.filter((a) => a.role === 'SUPER_ADMIN');
  const admin = email ? admins.find((a) => a.email.toLowerCase() === email) : supers.length === 1 ? supers[0] : undefined;
  if (!admin) {
    throw new Error(email
      ? `No login ${email} at ${tenant.name}. Logins: ${list}`
      : `Say which login with --email. Logins at ${tenant.name}: ${list}`);
  }

  await prisma.adminUser.update({
    where: { id: admin.id },
    data: { passwordHash: await bcrypt.hash(password, 12), isActive: true, mfaFailures: 0, mfaLockedUntil: null },
  });

  console.log(`\n✓ New password set for ${admin.name} <${admin.email}> (${admin.role}) at ${tenant.name}`);
  console.log(`  Workspace: ${tenant.slug}`);
  console.log('  Sign in with that email and password, then set up an authenticator app when asked.\n');
}

main()
  .catch((e) => {
    console.error(`\n✗ ${e instanceof Error ? e.message : e}\n`);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
