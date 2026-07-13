/**
 * Create or update an admin user with a bcrypt-hashed password.
 * Run against production by overriding DATABASE_URL.
 *
 *   DATABASE_URL=postgres://… npx tsx scripts/create-admin.ts \
 *     --email you@example.com --name "Your Name" --role SUPER_ADMIN --password 'Str0ng…'
 *
 *   --deactivate-default   also disables the seeded admin@hrpayroll.local account
 *
 * Roles: SUPER_ADMIN | HR_MANAGER | BRANCH_MANAGER | PAYROLL_ADMIN
 */
import { PrismaClient } from '@prisma/client';
import bcrypt from 'bcrypt';

function arg(flag: string): string | undefined {
  const i = process.argv.indexOf(flag);
  return i > -1 ? process.argv[i + 1] : undefined;
}

const email = arg('--email');
const name = arg('--name');
const role = arg('--role') ?? 'HR_MANAGER';
const password = arg('--password');
const deactivateDefault = process.argv.includes('--deactivate-default');

const ROLES = ['SUPER_ADMIN', 'HR_MANAGER', 'BRANCH_MANAGER', 'PAYROLL_ADMIN'];

const prisma = new PrismaClient();

async function main() {
  if (email || name || password) {
    if (!email || !name || !password) throw new Error('--email, --name and --password are all required');
    if (!ROLES.includes(role)) throw new Error(`--role must be one of ${ROLES.join(', ')}`);
    if (password.length < 12) throw new Error('Password must be at least 12 characters');

    const passwordHash = await bcrypt.hash(password, 12);
    const admin = await prisma.adminUser.upsert({
      where: { email },
      update: { name, role, passwordHash, isActive: true },
      create: { email, name, role, passwordHash },
    });
    console.log(`✓ ${admin.email} — ${admin.role} (${admin.name})`);
  }

  if (deactivateDefault) {
    const res = await prisma.adminUser.updateMany({
      where: { email: 'admin@hrpayroll.local' },
      data: { isActive: false },
    });
    console.log(res.count ? '✓ default admin@hrpayroll.local DEACTIVATED' : '• default admin not found (already removed)');
  }

  const all = await prisma.adminUser.findMany({ select: { email: true, role: true, isActive: true } });
  console.log('\nAdmin accounts now:');
  all.forEach((a) => console.log(`  ${a.isActive ? '🟢' : '⛔'} ${a.email} — ${a.role}`));
}

main()
  .catch((e) => {
    console.error(e.message ?? e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
