/**
 * DESTRUCTIVE: wipe all mock/domain data for a clean go-live start. Keeps ONLY the
 * admin user(s) so you can still log in and so bootstrap's ensureSeedData (which
 * seeds only when there are zero admins) won't re-create demo data on restart.
 * Also empties the Rekognition face collection.
 *
 * Usage: npx tsx scripts/wipe-data.ts
 */
import 'dotenv/config';
import { PrismaClient } from '@prisma/client';
import {
  RekognitionClient,
  ListFacesCommand,
  DeleteFacesCommand,
} from '@aws-sdk/client-rekognition';

const prisma = new PrismaClient();

async function clearRekognition() {
  const { AWS_ACCESS_KEY_ID, AWS_SECRET_ACCESS_KEY } = process.env;
  if (!AWS_ACCESS_KEY_ID || !AWS_SECRET_ACCESS_KEY) {
    console.log('AWS not configured — skipping Rekognition cleanup');
    return;
  }
  const collectionId = process.env.AWS_REKOGNITION_COLLECTION_ID ?? 'hr-payroll-faces';
  const rek = new RekognitionClient({
    region: process.env.AWS_REGION ?? 'ap-south-1',
    credentials: { accessKeyId: AWS_ACCESS_KEY_ID, secretAccessKey: AWS_SECRET_ACCESS_KEY },
  });
  let next: string | undefined;
  let total = 0;
  do {
    const res = await rek.send(
      new ListFacesCommand({ CollectionId: collectionId, MaxResults: 1000, NextToken: next }),
    );
    const ids = (res.Faces ?? []).map((f) => f.FaceId).filter((x): x is string => !!x);
    if (ids.length) {
      await rek.send(new DeleteFacesCommand({ CollectionId: collectionId, FaceIds: ids }));
      total += ids.length;
    }
    next = res.NextToken;
  } while (next);
  console.log(`Removed ${total} enrolled face(s) from Rekognition collection "${collectionId}".`);
}

async function main() {
  await clearRekognition();

  // FK-safe delete order; AdminUser is intentionally preserved.
  const deleted: Record<string, number> = {};
  deleted.gpsLogs = (await prisma.gPSLog.deleteMany()).count;
  deleted.attendance = (await prisma.attendance.deleteMany()).count;
  deleted.leaves = (await prisma.leave.deleteMany()).count;
  deleted.leaveBalances = (await prisma.leaveBalance.deleteMany()).count;
  deleted.payslips = (await prisma.payslip.deleteMany()).count;
  deleted.geofenceViolations = (await prisma.geofenceViolation.deleteMany()).count;
  deleted.whatsappLogs = (await prisma.whatsAppLog.deleteMany()).count;
  deleted.otpCodes = (await prisma.otpCode.deleteMany()).count;
  deleted.auditLogs = (await prisma.auditLog.deleteMany()).count;
  deleted.employees = (await prisma.employee.deleteMany()).count;
  deleted.branches = (await prisma.branch.deleteMany()).count;
  deleted.departments = (await prisma.department.deleteMany()).count;
  deleted.designations = (await prisma.designation.deleteMany()).count;
  deleted.shifts = (await prisma.shift.deleteMany()).count;
  deleted.holidays = (await prisma.holiday.deleteMany()).count;

  const adminsKept = await prisma.adminUser.count();
  console.log('\nDeleted rows:', deleted);
  console.log(`Admin users kept: ${adminsKept}`);
  console.log('\n✓ Clean slate. Log in to the web with your admin and build real org data.');
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
