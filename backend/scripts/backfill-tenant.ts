/**
 * Phase 2 backfill — turn the existing single-company database into tenant #1.
 *
 * Run this ONCE, manually, after the expand migration is deployed and before the
 * contract migration that makes `tenantId` required:
 *
 *   railway run --service backend npx tsx scripts/backfill-tenant.ts \
 *     --slug dharani --name "Dharani Motors" --dry-run
 *   railway run --service backend npx tsx scripts/backfill-tenant.ts \
 *     --slug dharani --name "Dharani Motors"
 *
 * Never wire this into boot. It is deliberately manual, idempotent, and it
 * asserts zero remaining NULLs at the end — that assertion is the gate the
 * contract migration relies on, because a nullable→NOT NULL flip only succeeds
 * when every row is populated.
 */
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

function arg(flag: string): string | undefined {
  const i = process.argv.indexOf(flag);
  return i > -1 ? process.argv[i + 1] : undefined;
}
const slug = arg('--slug');
const name = arg('--name');
const dryRun = process.argv.includes('--dry-run');

/**
 * Every tenant-owned table, in an order that keeps parents ahead of children so
 * a partial run never leaves a child pointing at an untenanted parent.
 * Mirrors the models carrying `tenantId` in schema.prisma — keep in step.
 */
const TABLES = [
  'Branch', 'Department', 'Designation', 'Shift', 'AdminUser', 'Employee',
  'Attendance', 'GPSLog', 'Leave', 'LeaveBalance', 'Payslip', 'Claim',
  'ClaimMessage', 'Notification', 'WhatsAppLog', 'GeofenceViolation',
  'AuditLog', 'CompanySettings', 'Holiday',
] as const;

/** Policy that has lived in process-wide env vars, captured onto the tenant. */
function settingsFromEnv() {
  return {
    timezone: process.env.COMPANY_TZ ?? 'Asia/Kolkata',
    employeeCodePrefix: process.env.EMPLOYEE_CODE_PREFIX ?? 'DHARANI',
    halfDayWindowStart: process.env.HALF_DAY_WINDOW_START ?? '12:30',
    halfDayWindowEnd: process.env.HALF_DAY_WINDOW_END ?? '14:00',
    lateRequiresApproval: process.env.LATE_REQUIRES_APPROVAL !== 'false',
    openPunchLookbackDays: Number(process.env.OPEN_PUNCH_LOOKBACK_DAYS ?? 7),
    payrollLateShiftAt: Number(process.env.PAYROLL_LATE_SHIFT_AT ?? 5),
    payrollLateWithholdOver: Number(process.env.PAYROLL_LATE_WITHHOLD_OVER ?? 8),
    payrollPayDay: Number(process.env.PAYROLL_PAY_DAY ?? 5),
    payrollPayDayLate: Number(process.env.PAYROLL_PAY_DAY_LATE ?? 8),
    faceMatchThreshold: Number(process.env.FACE_MATCH_THRESHOLD ?? 85),
    // Existing external resources are recorded verbatim, NOT derived from the
    // slug — that is what lets tenant #1 keep every S3 object and every
    // enrolled Rekognition face exactly where it already is.
    rekognitionCollectionId: process.env.AWS_REKOGNITION_COLLECTION_ID ?? 'hr-payroll-faces',
    s3Prefix: '',
    driveParentFolderId: process.env.GOOGLE_DRIVE_PARENT_FOLDER_ID ?? null,
  };
}

async function main() {
  if (!slug || !name) {
    throw new Error('--slug and --name are required, e.g. --slug dharani --name "Dharani Motors"');
  }
  if (!/^[a-z0-9][a-z0-9-]{1,30}$/.test(slug)) {
    throw new Error(`--slug must be a DNS label (lowercase letters, digits, hyphens): got "${slug}"`);
  }

  const existing = await prisma.tenant.findFirst();
  if (existing && existing.slug !== slug) {
    throw new Error(
      `A different tenant already exists (${existing.slug}). This script is only for the ` +
        'initial single-company backfill; use the platform console to add further tenants.',
    );
  }

  console.log(`\n${dryRun ? '[DRY RUN] ' : ''}Backfilling existing data as tenant "${slug}"\n`);

  // Row counts first, so a dry run reports exactly what a real run would touch.
  const counts: Record<string, number> = {};
  for (const table of TABLES) {
    const [{ n }] = await prisma.$queryRawUnsafe<{ n: bigint }[]>(
      `SELECT count(*)::bigint AS n FROM "${table}" WHERE "tenantId" IS NULL`,
    );
    counts[table] = Number(n);
  }
  const total = Object.values(counts).reduce((a, b) => a + b, 0);
  for (const table of TABLES) {
    console.log(`  ${table.padEnd(20)} ${String(counts[table]).padStart(7)} row(s) to claim`);
  }
  console.log(`  ${'TOTAL'.padEnd(20)} ${String(total).padStart(7)}\n`);

  if (dryRun) {
    console.log('Dry run — nothing written. Re-run without --dry-run to apply.\n');
    return;
  }

  const tenant =
    existing ??
    (await prisma.tenant.create({ data: { slug, name, status: 'ACTIVE' } }));
  console.log(`Tenant ${tenant.slug} (${tenant.id})`);
  console.log('Settings captured from the current environment:');
  for (const [k, v] of Object.entries(settingsFromEnv())) console.log(`  ${k} = ${JSON.stringify(v)}`);
  console.log('  ^ recorded here for the Phase 7 TenantSettings migration.\n');

  // One transaction: either the whole database becomes tenant #1, or none of it
  // does. A half-claimed database is the one state that would be painful.
  await prisma.$transaction(
    TABLES.map((table) =>
      prisma.$executeRawUnsafe(
        `UPDATE "${table}" SET "tenantId" = $1 WHERE "tenantId" IS NULL`,
        tenant.id,
      ),
    ),
  );

  // The gate. The contract migration flips tenantId to NOT NULL, which only
  // succeeds if this reports zero everywhere.
  let remaining = 0;
  for (const table of TABLES) {
    const [{ n }] = await prisma.$queryRawUnsafe<{ n: bigint }[]>(
      `SELECT count(*)::bigint AS n FROM "${table}" WHERE "tenantId" IS NULL`,
    );
    if (Number(n) > 0) {
      console.error(`  ✗ ${table}: ${n} row(s) still NULL`);
      remaining += Number(n);
    }
  }
  if (remaining > 0) {
    throw new Error(`${remaining} row(s) still have a NULL tenantId — do NOT run the contract migration`);
  }

  console.log(`✓ ${total} row(s) claimed. Zero NULL tenantId remaining — safe to contract.\n`);
}

main()
  .catch((e) => {
    console.error(`\n✗ ${e instanceof Error ? e.message : e}\n`);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
