/**
 * Set the address a dealer's new Drive folders are shared with.
 *
 * `TenantSettings.driveShareWith` used to be the deployment-wide env var
 * GOOGLE_DRIVE_SHARE_WITH. It is per-dealer now: sharing one dealer's claim
 * folders with another dealer's HR admin would hand them write access to
 * receipts that are not theirs — see services/storage/drive.service.ts.
 *
 * The tenancy backfill recorded `driveParentFolderId` but not this field, so a
 * deployment that cut over before that was fixed has it NULL, and newly created
 * employee folders stop appearing in that HR admin's "Shared with me". Uploads
 * and the app are unaffected; only the convenience sharing stops. This script
 * is how you fill it in.
 *
 *   # report what each dealer has now — reads nothing else, changes nothing
 *   railway run --service backend npx tsx scripts/set-drive-sharing.ts
 *
 *   # preview, then apply, for ONE named dealer
 *   railway run --service backend npx tsx scripts/set-drive-sharing.ts \
 *     --slug dharani --email hr@dharani.example --dry-run
 *   railway run --service backend npx tsx scripts/set-drive-sharing.ts \
 *     --slug dharani --email hr@dharani.example
 *
 * A dealer must always be named. An unscoped UPDATE would give every dealer the
 * same address, which is precisely the leak this field exists to prevent.
 */
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

function arg(flag: string): string | undefined {
  const i = process.argv.indexOf(flag);
  return i > -1 ? process.argv[i + 1] : undefined;
}
const slug = arg('--slug');
const email = arg('--email');
const dryRun = process.argv.includes('--dry-run');

const show = (v: string | null) => (v == null || v === '' ? '(none)' : v);

/** Report every dealer's current Drive settings. No writes. */
async function report() {
  const tenants = await prisma.tenant.findMany({ orderBy: { createdAt: 'asc' } });
  if (tenants.length === 0) {
    console.log('No dealers yet — has the tenancy backfill run?');
    return;
  }
  console.log(`\n${tenants.length} dealer(s):\n`);
  for (const t of tenants) {
    const s = await prisma.tenantSettings.findFirst({ where: { tenantId: t.id } });
    console.log(`  ${t.slug}  (${t.name})`);
    console.log(`    parent folder : ${show(s?.driveParentFolderId ?? null)}`);
    console.log(`    shared with   : ${show(s?.driveShareWith ?? null)}`);
    if (!s) console.log('    ⚠ no settings row — this dealer is using platform defaults');
    console.log('');
  }
  console.log('To set one:  --slug <dealer> --email <address>  (add --dry-run first)\n');
}

async function main() {
  if (!slug && !email) return report();

  if (!slug || !email) {
    throw new Error('Both --slug and --email are required to make a change (run with no flags to just report)');
  }
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) {
    throw new Error(`--email does not look like an address: "${email}"`);
  }

  const tenant = await prisma.tenant.findUnique({ where: { slug } });
  if (!tenant) {
    const all = await prisma.tenant.findMany({ select: { slug: true } });
    throw new Error(`No dealer with slug "${slug}". Known: ${all.map((t) => t.slug).join(', ') || '(none)'}`);
  }

  const current = await prisma.tenantSettings.findFirst({ where: { tenantId: tenant.id } });
  if (!current) {
    throw new Error(
      `${slug} has no settings row yet. Open the dealer's Settings screen and save once, then re-run.`,
    );
  }

  console.log(`\n${tenant.name} (${slug})`);
  console.log(`  shared with : ${show(current.driveShareWith)}  ->  ${email}`);

  if (dryRun) {
    console.log('\n--dry-run: nothing written. Re-run without it to apply.\n');
    return;
  }

  // Scoped to this one dealer by its unique tenantId, never a bare UPDATE.
  await prisma.tenantSettings.update({
    where: { tenantId: tenant.id },
    data: { driveShareWith: email },
  });
  console.log('\n✓ Saved. Folders created from now on are shared with that address.');
  console.log('  Folders that already exist are unchanged — share those in Drive if needed.\n');
}

main()
  .catch((err) => {
    console.error(`\n✗ ${err instanceof Error ? err.message : String(err)}\n`);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
