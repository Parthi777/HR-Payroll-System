/**
 * Expense claims: employee submits with a receipt photo + optional PDF, admin
 * approves / rejects / asks for clarification (which bounces it back to the
 * employee to resubmit). Attachments go to Google Drive (one folder per employee)
 * when configured, else S3, else local disk — see drive.service / storage.service.
 */
import type { Employee, Prisma, PrismaClient } from '@prisma/client';
import { promises as fs } from 'fs';
import path from 'path';
import { AppError } from '../../utils/AppError.js';
import { isDriveEnabled, ensureEmployeeFolder, uploadToDrive } from '../storage/drive.service.js';
import { isS3Enabled, uploadImage } from '../storage/storage.service.js';
import { dispatchWhatsApp } from '../whatsapp/whatsapp.service.js';

const UPLOAD_DIR = path.resolve(process.cwd(), 'uploads', 'claims');

export interface ClaimInput {
  type: string;
  title: string;
  amount: number;
  description?: string;
}
export interface FileInput {
  buffer: Buffer;
  mime: string;
}
type StoredFile = { fileId?: string; url?: string };

/** Resolve (and cache) the employee's Drive folder when Drive is the active backend. */
async function resolveFolder(prisma: PrismaClient, employee: Employee): Promise<string | undefined> {
  if (!isDriveEnabled()) return undefined;
  if (employee.driveFolderId) return employee.driveFolderId;
  const folderId = await ensureEmployeeFolder(employee.employeeCode, employee.name);
  await prisma.employee.update({ where: { id: employee.id }, data: { driveFolderId: folderId } });
  return folderId;
}

async function storeFile(
  employee: Employee,
  folderId: string | undefined,
  file: FileInput,
  kind: 'photo' | 'doc',
): Promise<StoredFile> {
  const ext = file.mime === 'application/pdf' ? 'pdf' : 'jpg';
  const filename = `${kind}-${Date.now()}.${ext}`;
  if (isDriveEnabled() && folderId) {
    return { fileId: await uploadToDrive(file.buffer, filename, file.mime, folderId) };
  }
  if (isS3Enabled()) {
    return { url: await uploadImage(file.buffer, `claims/${employee.id}/${filename}`, file.mime) };
  }
  await fs.mkdir(UPLOAD_DIR, { recursive: true });
  const local = `${employee.id}-${filename}`;
  await fs.writeFile(path.join(UPLOAD_DIR, local), file.buffer);
  return { url: `/uploads/claims/${local}` };
}

export async function createClaim(
  prisma: PrismaClient,
  employeeId: string,
  input: ClaimInput,
  photo?: FileInput | null,
  pdf?: FileInput | null,
) {
  const employee = await prisma.employee.findUnique({ where: { id: employeeId } });
  if (!employee) throw AppError.notFound('Employee');

  const folderId = await resolveFolder(prisma, employee);
  const photoRes = photo ? await storeFile(employee, folderId, photo, 'photo') : {};
  const pdfRes = pdf ? await storeFile(employee, folderId, pdf, 'doc') : {};

  return prisma.claim.create({
    data: {
      employeeId,
      type: input.type,
      title: input.title,
      amount: input.amount,
      description: input.description ?? null,
      photoFileId: photoRes.fileId ?? null,
      photoUrl: photoRes.url ?? null,
      documentFileId: pdfRes.fileId ?? null,
      documentUrl: pdfRes.url ?? null,
      status: 'PENDING',
    },
  });
}

/** Employee responds to a clarification request: update files/description, back to PENDING. */
export async function resubmitClaim(
  prisma: PrismaClient,
  employeeId: string,
  claimId: string,
  input: { description?: string; employeeNote?: string },
  photo?: FileInput | null,
  pdf?: FileInput | null,
) {
  const claim = await prisma.claim.findUnique({ where: { id: claimId }, include: { employee: true } });
  if (!claim || claim.employeeId !== employeeId) throw AppError.notFound('Claim');
  if (claim.status !== 'NEEDS_CLARIFICATION') {
    throw new AppError('Only claims awaiting clarification can be resubmitted', 409);
  }

  const folderId = await resolveFolder(prisma, claim.employee);
  const data: Prisma.ClaimUpdateInput = { status: 'PENDING', employeeNote: input.employeeNote ?? claim.employeeNote };
  if (input.description != null) data.description = input.description;
  if (photo) {
    const r = await storeFile(claim.employee, folderId, photo, 'photo');
    data.photoFileId = r.fileId ?? null;
    data.photoUrl = r.url ?? null;
  }
  if (pdf) {
    const r = await storeFile(claim.employee, folderId, pdf, 'doc');
    data.documentFileId = r.fileId ?? null;
    data.documentUrl = r.url ?? null;
  }
  return prisma.claim.update({ where: { id: claimId }, data });
}

export function listMyClaims(prisma: PrismaClient, employeeId: string) {
  return prisma.claim.findMany({ where: { employeeId }, orderBy: { createdAt: 'desc' } });
}

export function listClaims(prisma: PrismaClient, status?: string) {
  return prisma.claim.findMany({
    where: status ? { status } : undefined,
    orderBy: { createdAt: 'desc' },
    include: { employee: { select: { name: true, employeeCode: true } } },
  });
}

/** Admin action: APPROVED | REJECTED | NEEDS_CLARIFICATION (note required for the latter two). */
export async function actOnClaim(
  prisma: PrismaClient,
  adminId: string,
  claimId: string,
  status: 'APPROVED' | 'REJECTED' | 'NEEDS_CLARIFICATION',
  note?: string,
) {
  const claim = await prisma.claim.findUnique({ where: { id: claimId }, include: { employee: true } });
  if (!claim) throw AppError.notFound('Claim');
  if (status !== 'APPROVED' && !note?.trim()) {
    throw new AppError('A note is required to reject or request clarification', 400);
  }

  const updated = await prisma.claim.update({
    where: { id: claimId },
    data: { status, reviewedBy: adminId, reviewerNote: note ?? null },
  });

  const msg =
    status === 'APPROVED'
      ? `✅ *Claim Approved*\n${claim.title} — ₹${claim.amount}`
      : status === 'REJECTED'
        ? `❌ *Claim Rejected*\n${claim.title}\nReason: ${note}`
        : `❓ *Claim — Clarification Needed*\n${claim.title}\n${note}\nPlease update and resubmit in the app.`;
  await dispatchWhatsApp(prisma, {
    phone: claim.employee.phone,
    employeeId: claim.employeeId,
    trigger: `CLAIM_${status}`,
    message: msg,
  });

  return updated;
}

export async function claimStats(prisma: PrismaClient) {
  const all = await prisma.claim.findMany({ select: { status: true, type: true, amount: true } });
  const by = (s: string) => all.filter((c) => c.status === s);
  const sum = (arr: { amount: number }[]) => arr.reduce((t, c) => t + c.amount, 0);
  const byType: Record<string, number> = {};
  for (const c of all) byType[c.type] = (byType[c.type] ?? 0) + 1;
  return {
    total: all.length,
    pending: by('PENDING').length,
    approved: by('APPROVED').length,
    rejected: by('REJECTED').length,
    needsClarification: by('NEEDS_CLARIFICATION').length,
    totalClaimedAmount: sum(all),
    totalApprovedAmount: sum(by('APPROVED')),
    byType,
  };
}
