import { PrismaClient } from '@prisma/client';
import bcrypt from 'bcrypt';

const prisma = new PrismaClient();

function todayAt(hours: number, minutes: number) {
  const d = new Date();
  d.setHours(hours, minutes, 0, 0);
  return d;
}
function startOfToday() {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return d;
}

async function main() {
  // Super admin (web login: admin@hrpayroll.local / admin123)
  const passwordHash = await bcrypt.hash('admin123', 10);
  await prisma.adminUser.upsert({
    where: { email: 'admin@hrpayroll.local' },
    update: {},
    create: { name: 'Super Admin', email: 'admin@hrpayroll.local', passwordHash, role: 'SUPER_ADMIN' },
  });

  // Branches
  const bhavani = await prisma.branch.upsert({
    where: { id: 'seed-branch-1' },
    update: {},
    create: { id: 'seed-branch-1', name: 'Bhavani Branch', address: 'Bhavani, Tamil Nadu', geofenceLat: 11.4452, geofenceLng: 77.6822, geofenceRadius: 100 },
  });
  const erode = await prisma.branch.upsert({
    where: { id: 'seed-branch-2' },
    update: {},
    create: { id: 'seed-branch-2', name: 'Erode Branch', address: 'Erode, Tamil Nadu', geofenceLat: 11.341, geofenceLng: 77.7172, geofenceRadius: 150 },
  });

  // Masters
  const dept = await prisma.department.upsert({ where: { name: 'Sales' }, update: {}, create: { name: 'Sales' } });
  const desig = await prisma.designation.upsert({ where: { name: 'Sales Executive' }, update: {}, create: { name: 'Sales Executive' } });
  const shift = await prisma.shift.upsert({
    where: { id: 'seed-shift-1' },
    update: {},
    create: { id: 'seed-shift-1', name: 'General Shift', startTime: '09:00', endTime: '18:00', gracePeriod: 15 },
  });

  // Employees (phone +919000000001 is the one to log into the Android app with)
  const people = [
    { code: 'EMP001', name: 'Ravi Kumar', phone: '+919000000001', branchId: bhavani.id, status: 'PRESENT', checkIn: todayAt(9, 2), checkOut: null },
    { code: 'EMP002', name: 'Priya S', phone: '+919000000002', branchId: erode.id, status: 'LATE', checkIn: todayAt(9, 48), checkOut: null },
    { code: 'EMP003', name: 'Arjun M', phone: '+919000000003', branchId: bhavani.id, status: 'ABSENT', checkIn: null, checkOut: null },
    { code: 'EMP004', name: 'Divya R', phone: '+919000000004', branchId: erode.id, status: 'PRESENT', checkIn: todayAt(8, 55), checkOut: todayAt(18, 10) },
    { code: 'EMP005', name: 'Karthik V', phone: '+919000000005', branchId: bhavani.id, status: 'ON_LEAVE', checkIn: null, checkOut: null },
  ];

  for (const p of people) {
    const emp = await prisma.employee.upsert({
      where: { employeeCode: p.code },
      update: {},
      create: {
        employeeCode: p.code,
        name: p.name,
        phone: p.phone,
        branchId: p.branchId,
        departmentId: dept.id,
        designationId: desig.id,
        shiftId: shift.id,
        joiningDate: new Date('2025-01-01'),
        salary: 25000,
      },
    });

    // Today's attendance (absent employees get no check-in)
    await prisma.attendance.upsert({
      where: { employeeId_date: { employeeId: emp.id, date: startOfToday() } },
      update: { status: p.status, checkIn: p.checkIn, checkOut: p.checkOut },
      create: {
        employeeId: emp.id,
        date: startOfToday(),
        status: p.status,
        checkIn: p.checkIn,
        checkOut: p.checkOut,
        checkInLat: p.checkIn ? bhavani.geofenceLat : null,
        checkInLng: p.checkIn ? bhavani.geofenceLng : null,
      },
    });
  }

  // A pending leave so the dashboard shows "1 pending approval"
  const ravi = await prisma.employee.findUnique({ where: { employeeCode: 'EMP001' } });
  if (ravi) {
    const existing = await prisma.leave.findFirst({ where: { employeeId: ravi.id, status: 'PENDING' } });
    if (!existing) {
      await prisma.leave.create({
        data: {
          employeeId: ravi.id,
          type: 'CL',
          fromDate: todayAt(0, 0),
          toDate: todayAt(0, 0),
          days: 1,
          reason: 'Family function',
          status: 'PENDING',
        },
      });
    }
  }

  console.log('✅ Seed complete — admin@hrpayroll.local / admin123, employee phone +919000000001');
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
