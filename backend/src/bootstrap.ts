import type { PrismaClient } from '@prisma/client';
import bcrypt from 'bcrypt';
import { logger } from './utils/logger.js';

/**
 * Idempotent first-run seed: creates the admin + a demo employee ONLY when the
 * database has no admins yet. Runs on every boot but is a no-op once seeded, so
 * a fresh deploy (e.g. Railway) has a working login with zero manual steps and
 * never wipes existing data on restart. Full sample data lives in prisma/seed.ts.
 */
export async function ensureSeedData(prisma: PrismaClient): Promise<void> {
  const adminCount = await prisma.adminUser.count();
  if (adminCount > 0) return;

  logger.info('Empty database detected — creating initial admin + demo employee');

  const passwordHash = await bcrypt.hash('admin123', 10);
  await prisma.adminUser.create({
    data: { name: 'Super Admin', email: 'admin@hrpayroll.local', passwordHash, role: 'SUPER_ADMIN' },
  });

  const branch = await prisma.branch.create({
    data: {
      name: 'Bhavani Branch',
      address: 'Bhavani, Tamil Nadu',
      geofenceLat: 11.4452,
      geofenceLng: 77.6822,
      geofenceRadius: 100,
      strictMode: false, // soft mode so check-in works from any GPS during demos
    },
  });
  const dept = await prisma.department.create({ data: { name: 'Sales' } });
  const desig = await prisma.designation.create({ data: { name: 'Sales Executive' } });
  const shift = await prisma.shift.create({
    data: { name: 'General Shift', startTime: '09:00', endTime: '18:00', gracePeriod: 15 },
  });
  await prisma.employee.create({
    data: {
      employeeCode: 'EMP001',
      name: 'Ravi Kumar',
      phone: '+919000000001',
      branchId: branch.id,
      departmentId: dept.id,
      designationId: desig.id,
      shiftId: shift.id,
      joiningDate: new Date('2025-01-01'),
      salary: 25000,
    },
  });

  logger.info('Seed complete — admin@hrpayroll.local / admin123, employee phone +919000000001');
}
