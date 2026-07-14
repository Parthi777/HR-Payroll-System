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

  const replyText = [input.employeeNote?.trim(), photo || pdf ? '(attachment updated)' : null]
    .filter(Boolean)
    .join(' ');
  if (replyText) {
    await prisma.claimMessage.create({
      data: {
        claimId,
        senderRole: 'EMPLOYEE',
        senderId: employeeId,
        senderName: claim.employee.name,
        message: replyText,
      },
    });
  }
  return prisma.claim.update({ where: { id: claimId }, data });
}

/**
 * Employee replies to the approver's clarification question in-thread (text only,
 * no need to re-attach files). Puts the claim back in front of the approver.
 */
export async function replyToClaim(
  prisma: PrismaClient,
  employeeId: string,
  claimId: string,
  message: string,
) {
  const claim = await prisma.claim.findUnique({ where: { id: claimId }, include: { employee: true } });
  if (!claim || claim.employeeId !== employeeId) throw AppError.notFound('Claim');
  if (claim.status !== 'NEEDS_CLARIFICATION') {
    throw new AppError('You can reply only when clarification was requested', 409);
  }
  if (!message.trim()) throw new AppError('Reply message is required', 400);

  await prisma.claimMessage.create({
    data: {
      claimId,
      senderRole: 'EMPLOYEE',
      senderId: employeeId,
      senderName: claim.employee.name,
      message: message.trim(),
    },
  });
  return prisma.claim.update({
    where: { id: claimId },
    data: { status: 'PENDING', employeeNote: message.trim() },
  });
}

const claimInclude = {
  employee: { select: { name: true, employeeCode: true, branch: { select: { name: true } } } },
  messages: { orderBy: { createdAt: 'asc' as const } },
};

/** Attach reviewerName / paidByName (AdminUser has no Prisma relation to Claim). */
async function withAdminNames<T extends { reviewedBy: string | null; paidBy: string | null }>(
  prisma: PrismaClient,
  claims: T[],
) {
  const ids = [...new Set(claims.flatMap((c) => [c.reviewedBy, c.paidBy]).filter((x): x is string => !!x))];
  if (ids.length === 0) return claims.map((c) => ({ ...c, reviewerName: null, paidByName: null }));
  const admins = await prisma.adminUser.findMany({ where: { id: { in: ids } }, select: { id: true, name: true } });
  const names = new Map(admins.map((a) => [a.id, a.name]));
  return claims.map((c) => ({
    ...c,
    reviewerName: c.reviewedBy ? (names.get(c.reviewedBy) ?? null) : null,
    paidByName: c.paidBy ? (names.get(c.paidBy) ?? null) : null,
  }));
}

export async function listMyClaims(prisma: PrismaClient, employeeId: string) {
  const claims = await prisma.claim.findMany({
    where: { employeeId },
    orderBy: { createdAt: 'desc' },
    include: claimInclude,
  });
  return withAdminNames(prisma, claims);
}

/** Admin listing. `branchId` (from the admin's JWT) restricts to that branch's employees. */
export async function listClaims(prisma: PrismaClient, status?: string, branchId?: string) {
  const claims = await prisma.claim.findMany({
    where: {
      ...(status ? { status } : {}),
      ...(branchId ? { employee: { branchId } } : {}),
    },
    orderBy: { createdAt: 'desc' },
    include: claimInclude,
  });
  return withAdminNames(prisma, claims);
}

/** One claim with employee, thread and admin names; enforces owner/branch access. */
export async function getClaim(
  prisma: PrismaClient,
  claimId: string,
  viewer: { role: string; sub: string; branchId?: string },
) {
  const claim = await prisma.claim.findUnique({
    where: { id: claimId },
    include: { ...claimInclude, employee: { select: { name: true, employeeCode: true, branchId: true, branch: { select: { name: true } } } } },
  });
  if (!claim) throw AppError.notFound('Claim');
  if (viewer.role === 'EMPLOYEE' && claim.employeeId !== viewer.sub) throw new AppError('Forbidden', 403);
  if (viewer.role !== 'EMPLOYEE' && viewer.branchId && claim.employee.branchId !== viewer.branchId) {
    throw new AppError('This claim belongs to another branch', 403);
  }
  const [enriched] = await withAdminNames(prisma, [claim]);
  return enriched;
}

/** Admin action: APPROVED | REJECTED | NEEDS_CLARIFICATION (note required for the latter two). */
export async function actOnClaim(
  prisma: PrismaClient,
  adminId: string,
  claimId: string,
  status: 'APPROVED' | 'REJECTED' | 'NEEDS_CLARIFICATION',
  note?: string,
  adminBranchId?: string,
) {
  const claim = await prisma.claim.findUnique({ where: { id: claimId }, include: { employee: true } });
  if (!claim) throw AppError.notFound('Claim');
  if (adminBranchId && claim.employee.branchId !== adminBranchId) {
    throw new AppError('This claim belongs to another branch', 403);
  }
  if (status !== 'APPROVED' && !note?.trim()) {
    throw new AppError('A note is required to reject or request clarification', 400);
  }

  const admin = await prisma.adminUser.findUnique({ where: { id: adminId }, select: { name: true } });
  if (note?.trim()) {
    await prisma.claimMessage.create({
      data: {
        claimId,
        senderRole: 'ADMIN',
        senderId: adminId,
        senderName: admin?.name ?? 'Admin',
        message: note.trim(),
      },
    });
  }

  const updated = await prisma.claim.update({
    where: { id: claimId },
    data: { status, reviewedBy: adminId, reviewedAt: new Date(), reviewerNote: note ?? null },
  });

  const msg =
    status === 'APPROVED'
      ? `✅ *Claim Approved*\n${claim.title} — ₹${claim.amount}\nApproved by: ${admin?.name ?? 'Admin'}\nDownload your claim voucher PDF from the app.`
      : status === 'REJECTED'
        ? `❌ *Claim Rejected*\n${claim.title}\nReason: ${note}`
        : `❓ *Claim — Clarification Needed*\n${claim.title}\n${note}\nPlease reply or resubmit in the app.`;
  await dispatchWhatsApp(prisma, {
    phone: claim.employee.phone,
    employeeId: claim.employeeId,
    trigger: `CLAIM_${status}`,
    message: msg,
  });

  return updated;
}

/**
 * Cashier disbursement: after checking the employee's printed voucher against the
 * application details, mark the approved claim as PAID.
 */
export async function payClaim(
  prisma: PrismaClient,
  adminId: string,
  claimId: string,
  note?: string,
  adminBranchId?: string,
) {
  const claim = await prisma.claim.findUnique({ where: { id: claimId }, include: { employee: true } });
  if (!claim) throw AppError.notFound('Claim');
  if (adminBranchId && claim.employee.branchId !== adminBranchId) {
    throw new AppError('This claim belongs to another branch', 403);
  }
  if (claim.status !== 'APPROVED') {
    throw new AppError('Only approved claims can be marked as paid', 409);
  }

  const updated = await prisma.claim.update({
    where: { id: claimId },
    data: { status: 'PAID', paidBy: adminId, paidAt: new Date(), paidNote: note?.trim() || null },
  });

  await dispatchWhatsApp(prisma, {
    phone: claim.employee.phone,
    employeeId: claim.employeeId,
    trigger: 'CLAIM_PAID',
    message: `💵 *Claim Paid*\n${claim.title} — ₹${claim.amount}\nAmount has been disbursed by the cashier.`,
  });

  return updated;
}

export async function claimStats(prisma: PrismaClient, branchId?: string) {
  const all = await prisma.claim.findMany({
    where: branchId ? { employee: { branchId } } : undefined,
    select: { status: true, type: true, amount: true },
  });
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
    paid: by('PAID').length,
    totalClaimedAmount: sum(all),
    totalApprovedAmount: sum(by('APPROVED')) + sum(by('PAID')),
    totalPaidAmount: sum(by('PAID')),
    byType,
  };
}
