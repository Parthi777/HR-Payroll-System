/**
 * Re-enroll every employee's Rekognition face from the selfies in backend/uploads/
 * (filenames are `<employeeId>-<timestamp>.jpg`). For each employee with a photo:
 * removes any previously-enrolled (possibly bad) face, enrolls the newest photo,
 * and updates faceTemplateId. Employees without a photo are reported and skipped.
 *
 * Usage: npx tsx scripts/reenroll-all.ts
 */
import 'dotenv/config';
import { promises as fs } from 'fs';
import path from 'path';
import { PrismaClient } from '@prisma/client';
import { enrollFace, removeFace, isFaceMatchEnabled } from '../src/services/ai/face.service.js';

const prisma = new PrismaClient();
const UPLOAD_DIR = path.resolve(process.cwd(), 'uploads');

async function newestPhotoFor(employeeId: string): Promise<string | null> {
  let files: string[];
  try {
    files = await fs.readdir(UPLOAD_DIR);
  } catch {
    return null;
  }
  const mine = files
    .filter((f) => f.startsWith(`${employeeId}-`) && /\.(jpe?g|png)$/i.test(f))
    .sort(); // timestamp suffix sorts chronologically
  return mine.length ? path.join(UPLOAD_DIR, mine[mine.length - 1]) : null;
}

async function main() {
  if (!isFaceMatchEnabled()) throw new Error('AWS Rekognition not configured — set AWS keys in backend/.env');

  const employees = await prisma.employee.findMany({ orderBy: { employeeCode: 'asc' } });
  console.log(`\nRe-enrolling ${employees.length} employee(s) from ${UPLOAD_DIR}\n`);

  for (const emp of employees) {
    const photo = await newestPhotoFor(emp.id);
    if (!photo) {
      console.log(`  • ${emp.employeeCode} ${emp.name} — no photo in uploads/, skipped`);
      continue;
    }
    try {
      if (emp.faceTemplateId) await removeFace(emp.faceTemplateId);
      const buf = await fs.readFile(photo);
      const { faceId } = await enrollFace(buf, emp.id);
      await prisma.employee.update({ where: { id: emp.id }, data: { faceTemplateId: faceId } });
      console.log(`  \x1b[32m✓\x1b[0m ${emp.employeeCode} ${emp.name} — enrolled ${path.basename(photo)} (faceId ${faceId.slice(0, 8)}…)`);
    } catch (e) {
      console.log(`  \x1b[31m✗\x1b[0m ${emp.employeeCode} ${emp.name} — ${(e as { message?: string }).message}`);
    }
  }
  console.log('');
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
