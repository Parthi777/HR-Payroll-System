import type { FastifyInstance } from 'fastify';
import { promises as fs } from 'fs';
import { randomBytes } from 'crypto';
import path from 'path';
import { z } from 'zod';
import bcrypt from 'bcrypt';
import { requireRole } from '../middleware/auth.js';
import { AppError } from '../utils/AppError.js';
import { enrollFace, removeFace, verifyFace, isFaceMatchEnabled } from '../services/ai/face.service.js';
import { env } from '../config/env.js';
import { isS3Enabled, tenantKey, uploadImage } from '../services/storage/storage.service.js';
import { normalizePhone } from '../utils/phone.js';
import { requireTenantId } from '../context/tenant-context.js';
import { getTenantPolicy } from '../services/settings/tenant-settings.service.js';

const CODE_PAD = 3;

/**
 * Next free code in the series — max existing number + 1, zero-padded.
 *
 * The prefix is the dealer's own (TenantSettings.employeeCodePrefix), so two
 * dealers can both run an "EMP001". The scan is tenant-scoped by the Prisma
 * extension, so "max existing" means max within this dealer.
 */
async function nextEmployeeCode(prisma: FastifyInstance['prisma'], prefix: string): Promise<string> {
  const rows = await prisma.employee.findMany({
    where: { employeeCode: { startsWith: prefix } },
    select: { employeeCode: true },
  });
  const max = rows.reduce((m, r) => {
    const n = parseInt(r.employeeCode.slice(prefix.length), 10);
    return Number.isFinite(n) && n > m ? n : m;
  }, 0);
  return `${prefix}${String(max + 1).padStart(CODE_PAD, '0')}`;
}

/** This dealer's code prefix. */
async function codePrefix(prisma: FastifyInstance['prisma']): Promise<string> {
  const row = await prisma.tenantSettings.findFirst({ select: { employeeCodePrefix: true } });
  return row?.employeeCodePrefix || process.env.EMPLOYEE_CODE_PREFIX || 'EMP';
}

const createEmployeeSchema = z.object({
  employeeCode: z.string().optional(), // auto-generated when omitted
  name: z.string(),
  phone: z.string().min(10),
  email: z.string().email().optional(),
  branchId: z.string(),
  departmentId: z.string(),
  designationId: z.string(),
  shiftId: z.string(),
  joiningDate: z.coerce.date(),
  salary: z.number().positive(),
  reportingManagerId: z.string().nullable().optional(), // AdminUser id — approvals route to this manager
  pfEnabled: z.boolean().optional(), // PF deduction applies (only some employees)
  esiEnabled: z.boolean().optional(),
  password: z.string().min(4).optional(), // employee's app login password (phone + password)
  status: z.enum(['ACTIVE', 'INACTIVE', 'SUSPENDED']).optional(), // app-access control
});

/** Never return the password hash or plaintext to normal list clients. */
function safeEmployee<T extends { passwordHash?: string | null }>(e: T) {
  const { passwordHash: _h, ...rest } = e;
  return rest;
}

/** Minimal CSV parser (handles quoted fields with commas). Returns rows of cells. */
function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = '';
  let inQuotes = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inQuotes) {
      if (c === '"' && text[i + 1] === '"') { cell += '"'; i++; }
      else if (c === '"') inQuotes = false;
      else cell += c;
    } else if (c === '"') inQuotes = true;
    else if (c === ',') { row.push(cell); cell = ''; }
    else if (c === '\n' || c === '\r') {
      if (c === '\r' && text[i + 1] === '\n') i++;
      if (cell !== '' || row.length) { row.push(cell); rows.push(row); row = []; cell = ''; }
    } else cell += c;
  }
  if (cell !== '' || row.length) { row.push(cell); rows.push(row); }
  return rows;
}

// Real login credentials — must not come from Math.random(), whose state is
// recoverable from a handful of observed outputs (one bulk-imported employee
// could derive their colleagues'). 6 bytes → 8 base64url chars, ~48 bits.
const randomPassword = () => randomBytes(6).toString('base64url');

export async function employeeRoutes(app: FastifyInstance) {
  app.addHook('preHandler', requireRole('SUPER_ADMIN', 'HR_MANAGER', 'BRANCH_MANAGER'));

  app.get('/', async () => {
    const employees = await app.prisma.employee.findMany({ include: { branch: true } });
    return { employees: employees.map(safeEmployee) };
  });

  // Suggests the next code for the Add-Employee form (auto-series).
  app.get('/next-code', async () => ({ nextCode: await nextEmployeeCode(app.prisma, await codePrefix(app.prisma)) }));

  // Managers dropdown (Add/Edit Employee) — active admins who can approve requests.
  // Static path registered alongside '/:id'; Fastify matches static segments first.
  app.get('/managers', async () => {
    const managers = await app.prisma.adminUser.findMany({
      where: { isActive: true, role: { in: ['SUPER_ADMIN', 'HR_MANAGER', 'BRANCH_MANAGER'] } },
      select: { id: true, name: true, role: true },
      orderBy: { name: 'asc' },
    });
    return { managers };
  });

  app.post('/', async (req) => {
    const { password, ...rest } = createEmployeeSchema.parse(req.body);
    rest.phone = normalizePhone(rest.phone);

    // Auto-generate the code when the form leaves it blank.
    const employeeCode = rest.employeeCode?.trim() || (await nextEmployeeCode(app.prisma, await codePrefix(app.prisma)));
    rest.employeeCode = employeeCode;

    // Friendly duplicate checks — show the existing ID series and next free number.
    const codeDup = await app.prisma.employee.findFirst({ where: { employeeCode: rest.employeeCode } });
    if (codeDup) {
      const prefix = employeeCode.replace(/\d+$/, '') || employeeCode;
      const series = await app.prisma.employee.findMany({
        where: { employeeCode: { startsWith: prefix } },
        select: { employeeCode: true },
        orderBy: { employeeCode: 'asc' },
      });
      const codes = series.map((s) => s.employeeCode);
      const nums = codes.map((c) => parseInt(c.slice(prefix.length), 10)).filter(Number.isFinite);
      const width = Math.max(...codes.map((c) => c.length - prefix.length), 3);
      const next = `${prefix}${String((nums.length ? Math.max(...nums) : 0) + 1).padStart(width, '0')}`;
      throw new AppError(
        `Employee ID ${rest.employeeCode} already exists. Current series: ${codes.join(', ')}. Next available: ${next}`,
        409,
      );
    }
    const phoneDup = await app.prisma.employee.findFirst({ where: { phone: rest.phone } });
    if (phoneDup) {
      throw new AppError(`Phone ${rest.phone} is already registered to ${phoneDup.name} (${phoneDup.employeeCode})`, 409);
    }

    const data = { ...rest, employeeCode, tenantId: requireTenantId(), ...(password ? { passwordHash: await bcrypt.hash(password, 10) } : {}) };
    const employee = await app.prisma.employee.create({ data });
    return { employee: safeEmployee(employee) };
  });

  // Bulk import from CSV: columns name,phone,salary,branch,department,designation,shift[,email][,password].
  // Missing password is auto-generated; branch/dept/desig/shift resolved by name.
  app.post('/bulk-import', async (req) => {
    const file = await req.file();
    if (!file) throw new AppError('Upload a CSV file', 400);
    const rows = parseCsv((await file.toBuffer()).toString('utf8'));
    if (rows.length < 2) throw new AppError('CSV has no data rows', 400);

    const header = rows[0].map((h) => h.trim().toLowerCase());
    const col = (name: string) => header.indexOf(name);
    const iName = col('name'), iPhone = col('phone'), iSalary = col('salary');
    if (iName < 0 || iPhone < 0 || iSalary < 0) {
      throw new AppError('CSV must have at least: name, phone, salary columns', 400);
    }
    const iEmail = col('email'), iPwd = col('password');
    const iBranch = col('branch'), iDept = col('department'), iDesig = col('designation'), iShift = col('shift');

    const [branches, depts, desigs, shifts] = await Promise.all([
      app.prisma.branch.findMany(), app.prisma.department.findMany(),
      app.prisma.designation.findMany(), app.prisma.shift.findMany(),
    ]);
    const byName = <T extends { name: string }>(list: T[], v: string | undefined) =>
      v ? list.find((x) => x.name.toLowerCase() === v.trim().toLowerCase()) : undefined;

    const prefix = await codePrefix(app.prisma);
    const created: { employeeCode: string; name: string; phone: string; password: string }[] = [];
    const errors: string[] = [];

    for (let r = 1; r < rows.length; r++) {
      const cells = rows[r];
      const name = cells[iName]?.trim();
      if (!name) continue;
      try {
        const phone = normalizePhone(cells[iPhone]?.trim() ?? '');
        const salary = parseFloat(cells[iSalary] ?? '');
        if (!(salary > 0)) throw new Error('invalid salary');
        const branch = byName(branches, iBranch >= 0 ? cells[iBranch] : undefined) ?? branches[0];
        const dept = byName(depts, iDept >= 0 ? cells[iDept] : undefined) ?? depts[0];
        const desig = byName(desigs, iDesig >= 0 ? cells[iDesig] : undefined) ?? desigs[0];
        const shift = byName(shifts, iShift >= 0 ? cells[iShift] : undefined) ?? shifts[0];
        if (!branch || !dept || !desig || !shift) throw new Error('create a branch/department/designation/shift first');
        if (await app.prisma.employee.findFirst({ where: { phone } })) throw new Error(`phone ${phone} already exists`);

        const password = (iPwd >= 0 && cells[iPwd]?.trim()) || randomPassword();
        const employeeCode = await nextEmployeeCode(app.prisma, prefix);
        await app.prisma.employee.create({
          data: {
            tenantId: requireTenantId(),
            employeeCode, name, phone,
            email: iEmail >= 0 ? cells[iEmail]?.trim() || null : null,
            branchId: branch.id, departmentId: dept.id, designationId: desig.id, shiftId: shift.id,
            joiningDate: new Date(), salary,
            passwordHash: await bcrypt.hash(password, 10),
          },
        });
        created.push({ employeeCode, name, phone, password });
      } catch (e) {
        errors.push(`Row ${r + 1} (${name}): ${e instanceof Error ? e.message : 'failed'}`);
      }
    }
    return { imported: created.length, created, errors };
  });

  app.get('/:id', async (req) => {
    const { id } = req.params as { id: string };
    const employee = await app.prisma.employee.findUnique({ where: { id }, include: { branch: true, shift: true } });
    if (!employee) throw AppError.notFound('Employee');
    return { employee: safeEmployee(employee) };
  });

  app.put('/:id', async (req) => {
    const { id } = req.params as { id: string };
    const { password, ...rest } = createEmployeeSchema.partial().parse(req.body);
    if (rest.phone) rest.phone = normalizePhone(rest.phone);
    const data = { ...rest, ...(password ? { passwordHash: await bcrypt.hash(password, 10) } : {}) };
    const employee = await app.prisma.employee.update({ where: { id }, data });
    return { employee: safeEmployee(employee) };
  });

  /**
   * Reset an employee's app password and return the new one, once.
   *
   * This replaces the old credentials export, which could only work because
   * every password was also stored in readable form. Nothing readable is kept
   * now, so a forgotten password is answered by issuing a new one rather than
   * by looking the old one up — the same job, without a database full of
   * usable credentials.
   */
  app.post('/:id/reset-password', async (req) => {
    const { id } = req.params as { id: string };
    const employee = await app.prisma.employee.findUnique({
      where: { id },
      select: { id: true, name: true, employeeCode: true, phone: true },
    });
    if (!employee) throw AppError.notFound('Employee');

    const password = randomPassword();
    await app.prisma.employee.update({
      where: { id },
      data: { passwordHash: await bcrypt.hash(password, 10) },
    });

    // The only time this value exists outside the caller's screen.
    return { employee: { name: employee.name, employeeCode: employee.employeeCode, phone: employee.phone }, password };
  });

  app.delete('/:id', async (req) => {
    const { id } = req.params as { id: string };
    await app.prisma.employee.update({ where: { id }, data: { status: 'INACTIVE' } });
    return { id, deactivated: true };
  });

  app.post('/:id/enroll-face', async (req) => {
    const { id } = req.params as { id: string };
    if (!isFaceMatchEnabled()) throw new AppError('Face recognition is not configured (set AWS keys)', 503);
    const existing = await app.prisma.employee.findUnique({ where: { id }, select: { faceTemplateId: true } });
    if (!existing) throw AppError.notFound('Employee');
    const data = await req.file();
    if (!data) throw new AppError('No image uploaded', 400);
    const buffer = await data.toBuffer();

    // Wrong-photo guard: if this face already belongs to a DIFFERENT enrolled
    // employee, refuse — otherwise one person's photo silently becomes two identities.
    // This dealer's own collection: a face already enrolled at another dealer
    // is irrelevant here, and must not block enrollment.
    const { resources } = await getTenantPolicy(app.prisma);
    const dup = await verifyFace(buffer, id, resources.rekognitionCollectionId, resources.faceMatchThreshold);
    if (dup.enabled && dup.matchedEmployeeId && dup.matchedEmployeeId !== id && dup.score >= resources.faceMatchThreshold) {
      const other = await app.prisma.employee.findUnique({
        where: { id: dup.matchedEmployeeId },
        select: { name: true, employeeCode: true },
      });
      throw new AppError(
        `This photo matches ${other ? `${other.name} (${other.employeeCode})` : 'another employee'} who is already enrolled (${dup.score}% match). Use the correct person's photo.`,
        409,
      );
    }

    const { faceId } = await enrollFace(buffer, id, resources.rekognitionCollectionId);

    // Re-enrollment: drop the previous face so the collection doesn't accumulate
    // stale templates. Best-effort — the new face is already indexed.
    if (existing.faceTemplateId && existing.faceTemplateId !== faceId) {
      try {
        await removeFace(existing.faceTemplateId, resources.rekognitionCollectionId);
      } catch (err) {
        req.log.warn({ err, faceId: existing.faceTemplateId }, 'Failed to remove old face template');
      }
    }

    // Keep the enrolled photo — it doubles as the employee's profile picture (/me/photo).
    let faceTemplateUrl: string;
    if (isS3Enabled()) {
      faceTemplateUrl = await uploadImage(buffer, tenantKey(resources.s3Prefix, `faces/${id}-${Date.now()}.jpg`));
    } else {
      const dir = path.resolve(process.cwd(), 'uploads', 'faces');
      await fs.mkdir(dir, { recursive: true });
      const name = `${id}-${Date.now()}.jpg`;
      await fs.writeFile(path.join(dir, name), buffer);
      faceTemplateUrl = `/uploads/faces/${name}`;
    }

    await app.prisma.employee.update({ where: { id }, data: { faceTemplateId: faceId, faceTemplateUrl } });
    return { id, faceId, enrolled: true };
  });

  // Delete the enrolled face — drops the Rekognition template so the employee
  // can be re-enrolled from scratch (bad photo, changed appearance, off-boarding).
  // Attendance then blocks with "face not enrolled" until a new photo is added.
  app.delete('/:id/face', async (req) => {
    const { id } = req.params as { id: string };
    const employee = await app.prisma.employee.findUnique({
      where: { id },
      select: { faceTemplateId: true, faceTemplateUrl: true, name: true },
    });
    if (!employee) throw AppError.notFound('Employee');
    if (!employee.faceTemplateId && !employee.faceTemplateUrl) {
      throw new AppError(`${employee.name} has no enrolled face to delete`, 409);
    }

    // Best-effort on the AWS side — the local record is cleared either way, so a
    // stale collection entry can never keep granting attendance.
    if (employee.faceTemplateId) {
      try {
        const { resources } = await getTenantPolicy(app.prisma);
        await removeFace(employee.faceTemplateId, resources.rekognitionCollectionId);
      } catch (err) {
        req.log.warn({ err, faceId: employee.faceTemplateId }, 'Failed to remove face template from Rekognition');
      }
    }

    await app.prisma.employee.update({
      where: { id },
      data: { faceTemplateId: null, faceTemplateUrl: null },
    });
    return { id, deleted: true };
  });
}
