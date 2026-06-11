/**
 * Verify the end-to-end check-in landed correctly: reads today's attendance row
 * for an employee from the DB and confirms the stored selfie actually exists in
 * S3 (HeadObject on the checkInSelfie key).
 *
 * Usage: npx tsx scripts/verify-attendance.ts <employeeCode>   (default EMP001)
 */
import 'dotenv/config';
import { PrismaClient } from '@prisma/client';
import { S3Client, HeadObjectCommand } from '@aws-sdk/client-s3';

const code = process.argv[2] ?? 'EMP001';
const prisma = new PrismaClient();

function startOfToday() {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return d;
}

async function main() {
  const emp = await prisma.employee.findUnique({ where: { employeeCode: code } });
  if (!emp) throw new Error(`No employee ${code}`);

  const att = await prisma.attendance.findUnique({
    where: { employeeId_date: { employeeId: emp.id, date: startOfToday() } },
  });
  if (!att) throw new Error(`No attendance row for ${code} today`);

  console.log(`\nAttendance row (DB) for ${code} — ${emp.name}:`);
  console.log({
    status: att.status,
    checkIn: att.checkIn,
    geofenceStatus: att.geofenceStatus,
    faceMatchScore: att.faceMatchScore,
    isFlagged: att.isFlagged,
    flagReason: att.flagReason,
    checkInSelfie: att.checkInSelfie,
  });

  const key = att.checkInSelfie;
  if (!key) {
    console.log('\n✗ No checkInSelfie stored.');
    process.exit(1);
  }
  if (key.startsWith('/uploads/')) {
    console.log('\n• Selfie stored on LOCAL DISK (S3 not used for this check-in).');
    return;
  }

  const s3 = new S3Client({
    region: process.env.AWS_REGION ?? 'ap-south-1',
    credentials: {
      accessKeyId: process.env.AWS_ACCESS_KEY_ID as string,
      secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY as string,
    },
  });
  const head = await s3.send(new HeadObjectCommand({ Bucket: process.env.AWS_S3_BUCKET, Key: key }));
  console.log(
    `\n\x1b[32m✓\x1b[0m S3 object exists: s3://${process.env.AWS_S3_BUCKET}/${key}` +
      `  (${head.ContentLength} bytes, ${head.ContentType})`,
  );
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
