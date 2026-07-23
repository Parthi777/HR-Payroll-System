import type { FastifyInstance } from 'fastify';
import { promises as fs } from 'fs';
import path from 'path';
import { z } from 'zod';
import bcrypt from 'bcrypt';
import { requireRole } from '../middleware/auth.js';
import { AppError } from '../utils/AppError.js';
import { enrollFace, removeFace, verifyFace, isFaceMatchEnabled } from '../services/ai/face.service.js';
import { env } from '../config/env.js';
import { isS3Enabled, uploadImage } from '../services/storage/storage.service.js';
import { normalizePhone } from '../utils/phone.js';

// Employee code series prefix (e.g. DHARANI001). Override with EMPLOYEE_CODE_PREFIX.
const CODE_PREFIX = process.env.EMPLOYEE_CODE_PREFIX ?? 'DHARANI';
const CODE_PAD = 3;

/** Next free code in the series — max existing number + 1, zero-padded. */
async function nextEmployeeCode(prisma: FastifyInstance['prisma']): Promise<string> {
  const rows = await prisma.employee.findMany({
    where: { employeeCode: { startsWith: CODE_PREFIX } },
    select: { employeeCode: true },
  });
  const max = rows.reduce((m, r) => {
    const n = parseInt(r.employeeCode.slice(CODE_PREFIX.length), 10);
    return Number.isFinite(n) && n > m ? n : m;
  }, 0);
  return `${CODE_PREFIX}${String(max + 1).padStart(CODE_PAD, '0')}`;
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
function safeEmployee<T extends { passwordHash?: string | null; passwordPlain?: string | null }>(e: T) {
  const { passwordHash: _h, passwordPlain: _p, ...rest } = e;
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

const randomPassword = () => Math.random().toString(36).slice(2, 8);

export async function employeeRoutes(app: FastifyInstance) {
  app.addHook('preHandler', requireRole('SUPER_ADMIN', 'HR_MANAGER', 'BRANCH_MANAGER'));

  app.get('/', async () => {
    const employees = await app.prisma.employee.findMany({ include: { branch: true } });
    return { employees: employees.map(safeEmployee) };
  });

  // Suggests the next code for the Add-Employee form (auto-series).
  app.get('/next-code', async () => ({ nextCode: await nextEmployeeCode(app.prisma) }));

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
    const employeeCode = rest.employeeCode?.trim() || (await nextEmployeeCode(app.prisma));
    rest.employeeCode = employeeCode;

    // Friendly duplicate checks — show the existing ID series and next free number.
    const codeDup = await app.prisma.employee.findUnique({ where: { employeeCode: rest.employeeCode } });
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
    const phoneDup = await app.prisma.employee.findUnique({ where: { phone: rest.phone } });
    if (phoneDup) {
      throw new AppError(`Phone ${rest.phone} is already registered to ${phoneDup.name} (${phoneDup.employeeCode})`, 409);
    }

    const data = { ...rest, employeeCode, ...(password ? { passwordHash: await bcrypt.hash(password, 10), passwordPlain: password } : {}) };
    const employee = await app.prisma.employee.create({ data });
    return { employee: safeEmployee(employee) };
  });

  // Credentials sheet — code / name / phone / app password. SUPER_ADMIN only.
  app.get('/credentials', { preHandler: requireRole('SUPER_ADMIN') }, async () => {
    const employees = await app.prisma.employee.findMany({
      where: { status: 'ACTIVE' },
      select: { employeeCode: true, name: true, phone: true, passwordPlain: true, branch: { select: { name: true } } },
      orderBy: { employeeCode: 'asc' },
    });
    return {
      employees: employees.map((e) => ({
        employeeCode: e.employeeCode,
        name: e.name,
        phone: e.phone,
        branch: e.branch?.name ?? '',
        password: e.passwordPlain ?? '(set before this feature — reset to reveal)',
      })),
    };
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
        if (await app.prisma.employee.findUnique({ where: { phone } })) throw new Error(`phone ${phone} already exists`);

        const password = (iPwd >= 0 && cells[iPwd]?.trim()) || randomPassword();
        const employeeCode = await nextEmployeeCode(app.prisma);
        await app.prisma.employee.create({
          data: {
            employeeCode, name, phone,
            email: iEmail >= 0 ? cells[iEmail]?.trim() || null : null,
            branchId: branch.id, departmentId: dept.id, designationId: desig.id, shiftId: shift.id,
            joiningDate: new Date(), salary,
            passwordHash: await bcrypt.hash(password, 10), passwordPlain: password,
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
    const data = { ...rest, ...(password ? { passwordHash: await bcrypt.hash(password, 10), passwordPlain: password } : {}) };
    const employee = await app.prisma.employee.update({ where: { id }, data });
    return { employee: safeEmployee(employee) };
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
    const dup = await verifyFace(buffer, id);
    if (dup.enabled && dup.matchedEmployeeId && dup.matchedEmployeeId !== id && dup.score >= env.FACE_MATCH_THRESHOLD) {
      const other = await app.prisma.employee.findUnique({
        where: { id: dup.matchedEmployeeId },
        select: { name: true, employeeCode: true },
      });
      throw new AppError(
        `This photo matches ${other ? `${other.name} (${other.employeeCode})` : 'another employee'} who is already enrolled (${dup.score}% match). Use the correct person's photo.`,
        409,
      );
    }

    const { faceId } = await enrollFace(buffer, id);

    // Re-enrollment: drop the previous face so the collection doesn't accumulate
    // stale templates. Best-effort — the new face is already indexed.
    if (existing.faceTemplateId && existing.faceTemplateId !== faceId) {
      try {
        await removeFace(existing.faceTemplateId);
      } catch (err) {
        req.log.warn({ err, faceId: existing.faceTemplateId }, 'Failed to remove old face template');
      }
    }

    // Keep the enrolled photo — it doubles as the employee's profile picture (/me/photo).
    let faceTemplateUrl: string;
    if (isS3Enabled()) {
      faceTemplateUrl = await uploadImage(buffer, `faces/${id}-${Date.now()}.jpg`);
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
}
