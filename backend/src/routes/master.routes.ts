import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { requireRole } from '../middleware/auth.js';
import { AppError } from '../utils/AppError.js';
import { requireTenantId } from '../context/tenant-context.js';
import { defaultPolicy } from '../services/settings/tenant-settings.service.js';

const branchSchema = z.object({
  name: z.string().min(1),
  address: z.string().min(1),
  geofenceLat: z.number(),
  geofenceLng: z.number(),
  geofenceRadius: z.number().default(100),
  strictMode: z.boolean().default(false),
});

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

  monthDivisor: z.number().int().min(28).max(31).optional(),
  clPerYear: z.number().int().min(0).max(60).optional(),
  otHoursPerDay: z.number().int().min(1).max(24).optional(),
  payrollLateShiftAt: z.number().int().min(0).max(31).optional(),
  payrollLateWithholdOver: z.number().int().min(0).max(31).optional(),
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
        monthDivisor: d.payroll.monthDivisor,
        clPerYear: d.payroll.clPerYear,
        otHoursPerDay: d.payroll.otHoursPerDay,
        payrollLateShiftAt: d.payroll.lateShiftAt,
        payrollLateWithholdOver: d.payroll.lateWithholdOver,
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
    return { company };
  });

  // Branches
  app.get('/admin/branches', async () => ({
    branches: await app.prisma.branch.findMany({ orderBy: { name: 'asc' } }),
  }));
  app.post('/admin/branches', async (req) => {
    const data = branchSchema.parse(req.body);
    return { branch: await app.prisma.branch.create({ data: { ...data, tenantId: requireTenantId() } }) };
  });
  app.put('/admin/branches/:id', async (req) => {
    const { id } = req.params as { id: string };
    const data = branchSchema.partial().parse(req.body);
    return { branch: await app.prisma.branch.update({ where: { id }, data }) };
  });
  app.delete('/admin/branches/:id', async (req) => {
    const { id } = req.params as { id: string };
    const staff = await app.prisma.employee.count({ where: { branchId: id } });
    if (staff > 0) {
      throw new AppError(`Cannot delete — ${staff} employee(s) are assigned to this branch. Reassign them first.`, 409);
    }
    await app.prisma.geofenceViolation.deleteMany({ where: { branchId: id } });
    await app.prisma.branch.delete({ where: { id } });
    return { id, deleted: true };
  });

  // Departments
  app.get('/admin/departments', async () => ({
    departments: await app.prisma.department.findMany({ orderBy: { name: 'asc' } }),
  }));
  app.post('/admin/departments', async (req) => {
    const { name } = z.object({ name: z.string().min(1) }).parse(req.body);
    return { department: await app.prisma.department.create({ data: { name, tenantId: requireTenantId() } }) };
  });
  app.put('/admin/departments/:id', async (req) => {
    const { id } = req.params as { id: string };
    const { name } = z.object({ name: z.string().min(1) }).parse(req.body);
    return { department: await app.prisma.department.update({ where: { id }, data: { name } }) };
  });
  app.delete('/admin/departments/:id', async (req) => {
    const { id } = req.params as { id: string };
    const staff = await app.prisma.employee.count({ where: { departmentId: id } });
    if (staff > 0) {
      throw new AppError(`Cannot delete — ${staff} employee(s) are in this department. Reassign them first.`, 409);
    }
    await app.prisma.department.delete({ where: { id } });
    return { id, deleted: true };
  });

  // Designations
  app.get('/admin/designations', async () => ({
    designations: await app.prisma.designation.findMany({ orderBy: { name: 'asc' } }),
  }));
  app.post('/admin/designations', async (req) => {
    const { name } = z.object({ name: z.string().min(1) }).parse(req.body);
    return { designation: await app.prisma.designation.create({ data: { name, tenantId: requireTenantId() } }) };
  });
  app.put('/admin/designations/:id', async (req) => {
    const { id } = req.params as { id: string };
    const { name } = z.object({ name: z.string().min(1) }).parse(req.body);
    return { designation: await app.prisma.designation.update({ where: { id }, data: { name } }) };
  });
  app.delete('/admin/designations/:id', async (req) => {
    const { id } = req.params as { id: string };
    const staff = await app.prisma.employee.count({ where: { designationId: id } });
    if (staff > 0) {
      throw new AppError(`Cannot delete — ${staff} employee(s) hold this designation. Reassign them first.`, 409);
    }
    await app.prisma.designation.delete({ where: { id } });
    return { id, deleted: true };
  });
}
