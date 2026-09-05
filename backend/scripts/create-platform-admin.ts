/**
 * Create the platform administrator — the account that onboards dealers.
 *
 * This is the one login that exists before any dealer does, so it is created
 * from the command line rather than through the API: there is no one to
 * authorise it yet. Everything after this happens in the platform console.
 *
 *   npx tsx scripts/create-platform-admin.ts \
 *     --email you@example.com --name "Your Name" --password '…'
 *
 * Re-running with the same email updates that account's name and password,
 * which is also how you reset it if the password is lost.
 */
import { PrismaClient } from '@prisma/client';
import bcrypt from 'bcrypt';

const prisma = new PrismaClient();

function arg(flag: string): string | undefined {
  const i = process.argv.indexOf(flag);
  return i > -1 ? process.argv[i + 1] : undefined;
}

const email = arg('--email')?.trim().toLowerCase();
const name = arg('--name')?.trim();
const password = arg('--password');

async function main() {
  if (!email || !name || !password) {
    throw new Error('--email, --name and --password are all required');
  }
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) throw new Error(`"${email}" is not an email address`);
  // This account can create, rename and suspend every dealer on the platform.
  if (password.length < 12) throw new Error('Password must be at least 12 characters');

  const passwordHash = await bcrypt.hash(password, 12);
  const existing = await prisma.platformUser.findUnique({ where: { email } });

  const staff = await prisma.platformUser.upsert({
    where: { email },
    update: { name, passwordHash, isActive: true },
    create: { email, name, passwordHash },
    select: { id: true, email: true, name: true },
  });

  console.log(`\n✓ Platform administrator ${existing ? 'updated' : 'created'}`);
  console.log(`  ${staff.name} <${staff.email}>`);
  console.log('\nSign in at POST /api/platform/auth/login, then create your first dealer:');
  console.log('  POST /api/platform/tenants  { slug, name, admin: { name, email, password } }\n');

  const tenants = await prisma.tenant.count();
  if (tenants === 0) console.log('No dealers exist yet.\n');
}

main()
  .catch((e) => {
    console.error(`\n✗ ${e instanceof Error ? e.message : e}\n`);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
