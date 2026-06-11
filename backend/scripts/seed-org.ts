/**
 * Minimal org prerequisites so employees can be created/tested after a wipe.
 * Creates one branch, department, designation and shift (idempotent-ish) and
 * prints their ids. Not for production — real org data is built via the web UI.
 */
import 'dotenv/config';
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
  const branch =
    (await prisma.branch.findFirst()) ??
    (await prisma.branch.create({
      data: { name: 'Head Office', address: 'TBD', geofenceLat: 11.4452, geofenceLng: 77.6822, geofenceRadius: 150, strictMode: false },
    }));
  const dept =
    (await prisma.department.findFirst()) ??
    (await prisma.department.create({ data: { name: 'General' } }));
  const desig =
    (await prisma.designation.findFirst()) ??
    (await prisma.designation.create({ data: { name: 'Staff' } }));
  const shift =
    (await prisma.shift.findFirst()) ??
    (await prisma.shift.create({ data: { name: 'General Shift', startTime: '09:00', endTime: '18:00', gracePeriod: 15 } }));

  console.log(JSON.stringify({ branchId: branch.id, departmentId: dept.id, designationId: desig.id, shiftId: shift.id }));
}

main().catch((e) => { console.error(e); process.exit(1); }).finally(() => prisma.$disconnect());
