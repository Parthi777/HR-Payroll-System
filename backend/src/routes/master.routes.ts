import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { requireRole } from '../middleware/auth.js';
import { AppError } from '../utils/AppError.js';
import { clearCachedPolicy, requireTenantId } from '../context/tenant-context.js';
import { defaultPolicy } from '../services/settings/tenant-settings.service.js';
import { recordAudit } from '../services/audit/audit.service.js';

const branchSchema = z.object({
  name: z.string().min(1),
  address: z.string().min(1),
  geofenceLat: z.number(),
  geofenceLng: z.number(),
  geofenceRadius: z.number().default(100),
  strictMode: z.boolean().default(false),
});

/**
 * A public holiday, as a calendar date rather than an instant.
 *
 * The date is taken apart and rebuilt as local midnight instead of being
 * coerced by Zod. `dayKey()` — what the payroll engine, the muster grid and
 * every report use to line a row up against a day — reads a Date with
 * getFullYear/getMonth/getDate, i.e. in the server's own timezone. Coercing
 * "2026-08-15" would give UTC midnight, which is the 14th anywhere behind UTC,
 * and the holiday would land on the wrong day. Building it the same way the
 * payroll loop builds its days (`new Date(y, m - 1, d)`) makes the two match by
 * construction in any timezone.
 */
const holidaySchema = z.object({
  name: z.string().min(1).max(80),
  date: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, 'Date must be YYYY-MM-DD')
    .transform((v) => {
      const [y, m, d] = v.split('-').map(Number);
      const date = new Date(y, m - 1, d);
      if (date.getFullYear() !== y || date.getMonth() !== m - 1 || date.getDate() !== d) {
        throw new AppError(`${v} is not a real date`, 400);
      }
      return date;
    }),
});

/** "2026-08-15" from a stored holiday — the same calendar day the grid shows. */
function holidayOut(h: { id: string; name: string; date: Date }) {
  const p = (n: number) => String(n).padStart(2, '0');
  return {
    id: h.id,
    name: h.name,
    date: `${h.date.getFullYear()}-${p(h.date.getMonth() + 1)}-${p(h.date.getDate())}`,
  };
}

/**
 * A dealer's own settings. The company block is what prints on payslips; the
 * policy block used to be deployment-wide environment variables and is now
 * each dealer's to set — a dealer in another state needs its own timezone and
 * pay day. Everything is optional, so a client may send only what it edits.
 */
const companySchema = z.object({
  name: z.string().optional(),
  address: z.string().optional(),
  phone: z.string().optional(),
  email: z.string().optional(),
  gstin: z.string().optional(),

  // Shown to every employee in the phone app, so the number has to be one a
  // person actually answers.
  hrContactName: z.string().max(80).optional(),
  hrContactPhone: z.string().max(20).optional(),

  // NOTE: `timezone` is stored on TenantSettings and set at provisioning, but
  // is deliberately NOT editable yet — nothing reads it. The company timezone
  // is still deployment-wide (utils/time.ts), and threading it touches every
  // date calculation in payroll. Exposing a control that silently does nothing
  // would be worse than not offering it; see docs/SETTINGS.md.
  employeeCodePrefix: z.string().min(1).max(12).optional(),
  halfDayWindowStart: z.string().regex(/^\d{2}:\d{2}$/).optional(),
  halfDayWindowEnd: z.string().regex(/^\d{2}:\d{2}$/).optional(),
  lateRequiresApproval: z.boolean().optional(),
  openPunchLookbackDays: z.number().int().min(0).max(90).optional(),
  // The latest check-out an employee may type on a manual punch. Past this hour
  // a self-reported departure is not taken on trust and HR has to record it.
  manualPunchLatest: z.string().regex(/^\d{2}:\d{2}$/).optional(),

  // Punch reminders. One switch for all four, plus the hour of the evening
  // sweep — the three around the shift start are keyed to each roster and have
  // nothing for a dealer to choose.
  punchRemindersOn: z.boolean().optional(),
  punchOutReminderAt: z.string().regex(/^\d{2}:\d{2}$/).optional(),

  // The basis a new employee inherits when their own is not set.
  defaultPayrollBasis: z.enum(['MONTHLY', 'PRESENT_DAYS']).optional(),
  monthDivisor: z.number().int().min(28).max(31).optional(),
  clPerYear: z.number().int().min(0).max(60).optional(),
  otHoursPerDay: z.number().int().min(1).max(24).optional(),
  payrollLateShiftAt: z.number().int().min(0).max(31).optional(),
  payrollPayDay: z.number().int().min(1).max(28).optional(),
  payrollPayDayLate: z.number().int().min(1).max(28).optional(),

  // Face threshold is a security control, so it has a floor: below ~70 the
  // match stops meaning anything and attendance would accept the wrong person.
  faceMatchThreshold: z.number().int().min(70).max(100).optional(),
});

/** Master data: branches, departments, designations. Powers the Add-Employee form. */
export async function masterRoutes(app: FastifyInstance) {
  app.addHook('preHandler', requireRole('SUPER_ADMIN', 'HR_MANAGER', 'BRANCH_MANAGER'));

  // This dealer's settings — company profile plus the attendance and payroll
  // policy that used to be deployment-wide env vars. One row per tenant, found
  // by the tenant filter rather than by a fixed id.
  app.get('/admin/company', async () => {
    const company = await app.prisma.tenantSettings.findFirst();
    if (company) return { company };
    // No row yet is normal for a new dealer: report the platform defaults, so
    // the settings screen shows what is actually in force rather than blanks.
    const d = defaultPolicy();
    return {
      company: {
        ...d.company,
        employeeCodePrefix: process.env.EMPLOYEE_CODE_PREFIX ?? 'EMP',
        halfDayWindowStart: d.attendance.halfDayWindowStart,
        halfDayWindowEnd: d.attendance.halfDayWindowEnd,
        lateRequiresApproval: d.attendance.lateRequiresApproval,
        openPunchLookbackDays: d.attendance.openPunchLookbackDays,
        manualPunchLatest: d.attendance.manualPunchLatest,
        punchRemindersOn: d.attendance.punchRemindersOn,
        punchOutReminderAt: d.attendance.punchOutReminderAt,
        defaultPayrollBasis: d.payroll.defaultPayrollBasis,
        monthDivisor: d.payroll.monthDivisor,
        clPerYear: d.payroll.clPerYear,
        otHoursPerDay: d.payroll.otHoursPerDay,
        payrollLateShiftAt: d.payroll.lateShiftAt,
        payrollPayDay: d.payroll.payDay,
        payrollPayDayLate: d.payroll.payDayLate,
        faceMatchThreshold: d.resources.faceMatchThreshold,
        s3Prefix: d.resources.s3Prefix,
        rekognitionCollectionId: d.resources.rekognitionCollectionId,
      },
    };
  });

  app.put('/admin/company', { preHandler: requireRole('SUPER_ADMIN', 'HR_MANAGER') }, async (req) => {
    const data = companySchema.parse(req.body);
    const company = await app.prisma.tenantSettings.upsert({
      where: { tenantId: requireTenantId() },
      update: data,
      create: { ...data, tenantId: requireTenantId() },
    });
    // The per-request memo now holds the pre-write values; drop it so anything
    // later in this request (a PDF header, a re-read) sees what was just saved.
    clearCachedPolicy();
    await recordAudit(req, 'COMPANY_UPDATED', 'Company', {
      entityId: company.tenantId,
      metadata: data,
    });
    return { company };
  });

  // Branches
  app.get('/admin/branches', async () => ({
    branches: await app.prisma.branch.findMany({ orderBy: { name: 'asc' } }),
  }));
  app.post('/admin/branches', async (req) => {
    const data = branchSchema.parse(req.body);
    const branch = await app.prisma.branch.create({ data: { ...data, tenantId: requireTenantId() } });
    await recordAudit(req, 'BRANCH_CREATED', 'Branch', {
      entityId: branch.id,
      metadata: { name: branch.name, address: branch.address, radiusMetres: branch.geofenceRadius },
    });
    return { branch };
  });
  app.put('/admin/branches/:id', async (req) => {
    const { id } = req.params as { id: string };
    const data = branchSchema.partial().parse(req.body);
    const branch = await app.prisma.branch.update({ where: { id }, data });
    await recordAudit(req, 'BRANCH_UPDATED', 'Branch', { entityId: branch.id, metadata: { name: branch.name, ...data } });
    return { branch };
  });
  app.delete('/admin/branches/:id', async (req) => {
    const { id } = req.params as { id: string };
    const staff = await app.prisma.employee.count({ where: { branchId: id } });
    if (staff > 0) {
      throw new AppError(`Cannot delete — ${staff} employee(s) are assigned to this branch. Reassign them first.`, 409);
    }
    // Named before it is gone — afterwards the id resolves to nothing.
    const doomed = await app.prisma.branch.findUnique({ where: { id }, select: { name: true } });
    await app.prisma.geofenceViolation.deleteMany({ where: { branchId: id } });
    await app.prisma.branch.delete({ where: { id } });
    await recordAudit(req, 'BRANCH_DELETED', 'Branch', { entityId: id, metadata: { name: doomed?.name ?? null } });
    return { id, deleted: true };
  });

  // Departments
  app.get('/admin/departments', async () => ({
    departments: await app.prisma.department.findMany({ orderBy: { name: 'asc' } }),
  }));
  app.post('/admin/departments', async (req) => {
    const { name } = z.object({ name: z.string().min(1) }).parse(req.body);
    const department = await app.prisma.department.create({ data: { name, tenantId: requireTenantId() } });
    await recordAudit(req, 'DEPARTMENT_CREATED', 'Department', { entityId: department.id, metadata: { name } });
    return { department };
  });
  app.put('/admin/departments/:id', async (req) => {
    const { id } = req.params as { id: string };
    const { name } = z.object({ name: z.string().min(1) }).parse(req.body);
    const before = await app.prisma.department.findUnique({ where: { id }, select: { name: true } });
    const department = await app.prisma.department.update({ where: { id }, data: { name } });
    await recordAudit(req, 'DEPARTMENT_UPDATED', 'Department', {
      entityId: department.id,
      metadata: { name, ...(before && before.name !== name ? { renamedFrom: before.name } : {}) },
    });
    return { department };
  });
  app.delete('/admin/departments/:id', async (req) => {
    const { id } = req.params as { id: string };
    const staff = await app.prisma.employee.count({ where: { departmentId: id } });
    if (staff > 0) {
      throw new AppError(`Cannot delete — ${staff} employee(s) are in this department. Reassign them first.`, 409);
    }
    const doomed = await app.prisma.department.findUnique({ where: { id }, select: { name: true } });
    await app.prisma.department.delete({ where: { id } });
    await recordAudit(req, 'DEPARTMENT_DELETED', 'Department', { entityId: id, metadata: { name: doomed?.name ?? null } });
    return { id, deleted: true };
  });

  // Designations
  app.get('/admin/designations', async () => ({
    designations: await app.prisma.designation.findMany({ orderBy: { name: 'asc' } }),
  }));
  app.post('/admin/designations', async (req) => {
    const { name } = z.object({ name: z.string().min(1) }).parse(req.body);
    const designation = await app.prisma.designation.create({ data: { name, tenantId: requireTenantId() } });
    await recordAudit(req, 'DESIGNATION_CREATED', 'Designation', { entityId: designation.id, metadata: { name } });
    return { designation };
  });
  app.put('/admin/designations/:id', async (req) => {
    const { id } = req.params as { id: string };
    const { name } = z.object({ name: z.string().min(1) }).parse(req.body);
    const before = await app.prisma.designation.findUnique({ where: { id }, select: { name: true } });
    const designation = await app.prisma.designation.update({ where: { id }, data: { name } });
    await recordAudit(req, 'DESIGNATION_UPDATED', 'Designation', {
      entityId: designation.id,
      metadata: { name, ...(before && before.name !== name ? { renamedFrom: before.name } : {}) },
    });
    return { designation };
  });
  app.delete('/admin/designations/:id', async (req) => {
    const { id } = req.params as { id: string };
    const staff = await app.prisma.employee.count({ where: { designationId: id } });
    if (staff > 0) {
      throw new AppError(`Cannot delete — ${staff} employee(s) hold this designation. Reassign them first.`, 409);
    }
    const doomed = await app.prisma.designation.findUnique({ where: { id }, select: { name: true } });
    await app.prisma.designation.delete({ where: { id } });
    await recordAudit(req, 'DESIGNATION_DELETED', 'Designation', { entityId: id, metadata: { name: doomed?.name ?? null } });
    return { id, deleted: true };
  });

  // Holidays
  //
  // The Holiday table has been read by the payroll engine, the muster grid and
  // every report since they were written, and until now nothing could write to
  // it — so the calendar was permanently empty and a declared holiday was
  // counted as an ordinary working day. Staff who correctly stayed home were
  // marked ABSENT and docked for it. These four routes are what CLAUDE.md has
  // described as "Holiday calendar management" from the start.
  //
  // Writes are SUPER_ADMIN / HR_MANAGER, not the file-wide role set: adding a
  // day here pays everyone for not working, and removing one takes that back.
  // A branch manager can read the calendar but not set it.
  app.get('/admin/holidays', async (req) => {
    const { year } = z.object({ year: z.coerce.number().int().min(2000).max(2100).optional() }).parse(req.query);
    const where = year
      ? { date: { gte: new Date(year, 0, 1), lt: new Date(year + 1, 0, 1) } }
      : {};
    const holidays = await app.prisma.holiday.findMany({ where, orderBy: { date: 'asc' } });
    return { holidays: holidays.map(holidayOut) };
  });

  app.post('/admin/holidays', { preHandler: requireRole('SUPER_ADMIN', 'HR_MANAGER') }, async (req) => {
    const data = holidaySchema.parse(req.body);
    const holiday = await createOrFail(() =>
      app.prisma.holiday.create({ data: { ...data, tenantId: requireTenantId() } }),
    );
    await recordAudit(req, 'HOLIDAY_CREATED', 'Holiday', {
      entityId: holiday.id,
      metadata: holidayOut(holiday),
    });
    return { holiday: holidayOut(holiday) };
  });

  app.put('/admin/holidays/:id', { preHandler: requireRole('SUPER_ADMIN', 'HR_MANAGER') }, async (req) => {
    const { id } = req.params as { id: string };
    const data = holidaySchema.partial().parse(req.body);
    const before = await app.prisma.holiday.findUnique({ where: { id } });
    if (!before) throw AppError.notFound('Holiday');
    const holiday = await createOrFail(() => app.prisma.holiday.update({ where: { id }, data }));
    // `renamedFrom` / `movedFrom` rather than `changed()` here: the flat `name`
    // and `date` are what the activity reader prints, and a {from,to} object
    // under those same keys would overwrite them with something it renders as
    // blank. Departments use the same shape for the same reason.
    const was = holidayOut(before);
    const now = holidayOut(holiday);
    await recordAudit(req, 'HOLIDAY_UPDATED', 'Holiday', {
      entityId: holiday.id,
      metadata: {
        ...now,
        ...(was.name !== now.name ? { renamedFrom: was.name } : {}),
        ...(was.date !== now.date ? { movedFrom: was.date } : {}),
      },
    });
    return { holiday: holidayOut(holiday) };
  });

  app.delete('/admin/holidays/:id', { preHandler: requireRole('SUPER_ADMIN', 'HR_MANAGER') }, async (req) => {
    const { id } = req.params as { id: string };
    // Named before it is gone, so the trail still says which day was removed.
    const doomed = await app.prisma.holiday.findUnique({ where: { id } });
    if (!doomed) throw AppError.notFound('Holiday');
    await app.prisma.holiday.delete({ where: { id } });
    await recordAudit(req, 'HOLIDAY_DELETED', 'Holiday', { entityId: id, metadata: holidayOut(doomed) });
    return { id, deleted: true };
  });
}

/**
 * Turn the unique-constraint violation into the sentence that explains it.
 *
 * `@@unique([tenantId, date])` means one holiday per calendar day per dealer.
 * Raw, that surfaces as Prisma's P2002 and a 500; the person adding Independence
 * Day twice should be told it is already there.
 */
async function createOrFail<T>(write: () => Promise<T>): Promise<T> {
  try {
    return await write();
  } catch (err) {
    if ((err as { code?: string }).code === 'P2002') {
      throw new AppError('A holiday is already set for that date.', 409);
    }
    throw err;
  }
}
