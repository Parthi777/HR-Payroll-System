/**
 * Dev helper: reset an employee to a clean attendance/enrollment slate so the
 * check-in flow can be re-tested. Deletes today's attendance row and removes the
 * employee's currently-enrolled Rekognition face (if any).
 *
 * Usage: npx tsx scripts/reset-today.ts <employeeCode>   (default EMP001)
 */
import 'dotenv/config';
import { PrismaClient } from '@prisma/client';
import { removeFace, isFaceMatchEnabled } from '../src/services/ai/face.service.js';

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

  const del = await prisma.attendance.deleteMany({ where: { employeeId: emp.id, date: startOfToday() } });
  console.log(`Deleted ${del.count} attendance row(s) for ${code} today.`);

  if (emp.faceTemplateId && isFaceMatchEnabled()) {
    await removeFace(emp.faceTemplateId);
    await prisma.employee.update({ where: { id: emp.id }, data: { faceTemplateId: null } });
    console.log(`Removed enrolled face ${emp.faceTemplateId} and cleared faceTemplateId.`);
  } else {
    console.log('No enrolled face to remove.');
  }
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
