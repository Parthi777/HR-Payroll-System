import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { promises as fs } from 'fs';
import path from 'path';
import { authenticate, requireRole } from '../middleware/auth.js';
import { AppError } from '../utils/AppError.js';
import { notifyAdmins, approverIds, cashierIds } from '../services/notification.service.js';
import { pushToEmployee } from '../services/push.service.js';
import {
  createClaim,
  resubmitClaim,
  replyToClaim,
  listMyClaims,
  listClaims,
  getClaim,
  actOnClaim,
  payClaim,
  claimStats,
} from '../services/claim/claim.service.js';
import { generateClaimVoucherPdf } from '../services/claim/claim-voucher-pdf.service.js';
import { getDriveFileStream } from '../services/storage/drive.service.js';
import { getSignedSelfieUrl } from '../services/storage/storage.service.js';

interface ParsedClaim {
  fields: Record<string, string>;
  photo?: { buffer: Buffer; mime: string };
  pdf?: { buffer: Buffer; mime: string };
}

/** Parse a claim multipart body: scalar fields + a photo and/or a PDF file. */
async function parseClaimParts(req: FastifyRequest): Promise<ParsedClaim> {
  const fields: Record<string, string> = {};
  let photo: ParsedClaim['photo'];
  let pdf: ParsedClaim['pdf'];
  for await (const part of req.parts()) {
    if (part.type === 'file') {
      const buffer = await part.toBuffer();
      const mime = part.mimetype;
      if (part.fieldname === 'pdf' || mime === 'application/pdf') pdf = { buffer, mime };
      else photo = { buffer, mime };
    } else {
      fields[part.fieldname] = String(part.value);
    }
  }
  return { fields, photo, pdf };
}

/** Stream a stored claim file (Drive proxy / S3 redirect / local), enforcing access. */
async function serveClaimFile(
  req: FastifyRequest,
  reply: FastifyReply,
  fileId: string | null,
  url: string | null,
) {
  if (fileId) {
    const { stream, mimeType } = await getDriveFileStream(fileId);
    return reply.type(mimeType).send(stream);
  }
  if (url) {
    if (url.startsWith('/uploads/')) {
      const abs = path.resolve(process.cwd(), url.replace(/^\//, ''));
      const buf = await fs.readFile(abs);
      const mime = url.endsWith('.pdf') ? 'application/pdf' : 'image/jpeg';
      return reply.type(mime).send(buf);
    }
    return reply.redirect(await getSignedSelfieUrl(url)); // S3 key → signed URL
  }
  throw AppError.notFound('File');
}

export async function claimRoutes(app: FastifyInstance) {
  // ── Employee ──
  app.post('/claims', { preHandler: authenticate }, async (req) => {
    const { fields, photo, pdf } = await parseClaimParts(req);
    const amount = parseFloat(fields.amount);
    if (!fields.type || !fields.title || !(amount > 0)) {
      throw new AppError('type, title and a positive amount are required', 400);
    }
    const claim = await createClaim(
      app.prisma,
      req.user.sub,
      { type: fields.type, title: fields.title, amount, description: fields.description },
      photo,
      pdf,
    );
    // Notify the employee's approver(s) — reporting manager, or branch admins.
    const emp = await app.prisma.employee.findUnique({
      where: { id: req.user.sub },
      select: { name: true, branchId: true, reportingManagerId: true },
    });
    if (emp) {
      await notifyAdmins(app.prisma, await approverIds(app.prisma, emp), {
        type: 'CLAIM_SUBMITTED',
        title: 'New claim to approve',
        body: `${emp.name}: ${fields.title} — Rs.${amount.toLocaleString('en-IN')}`,
        claimId: claim.id,
      });
    }
    return { claim };
  });

  app.get('/claims/my-claims', { preHandler: authenticate }, async (req) => {
    const claims = await listMyClaims(app.prisma, req.user.sub);
    return { claims };
  });

  app.post('/claims/:id/resubmit', { preHandler: authenticate }, async (req) => {
    const { id } = req.params as { id: string };
    const { fields, photo, pdf } = await parseClaimParts(req);
    const claim = await resubmitClaim(
      app.prisma,
      req.user.sub,
      id,
      { description: fields.description, employeeNote: fields.employeeNote },
      photo,
      pdf,
    );
    const emp = await app.prisma.employee.findUnique({
      where: { id: req.user.sub },
      select: { name: true, branchId: true, reportingManagerId: true },
    });
    if (emp) {
      await notifyAdmins(app.prisma, await approverIds(app.prisma, emp), {
        type: 'CLAIM_SUBMITTED',
        title: 'Claim resubmitted for approval',
        body: `${emp.name}: ${claim.title} — Rs.${claim.amount.toLocaleString('en-IN')}`,
        claimId: claim.id,
      });
    }
    return { claim };
  });

  // Employee replies in the clarification thread (text only; back to PENDING).
  app.post('/claims/:id/reply', { preHandler: authenticate }, async (req) => {
    const { id } = req.params as { id: string };
    const { message } = (req.body as { message?: string }) ?? {};
    const claim = await replyToClaim(app.prisma, req.user.sub, id, message ?? '');
    return { claim };
  });

  // Full claim detail (employee: own claims; admin: branch-scoped) incl. message thread.
  app.get('/claims/:id', { preHandler: authenticate }, async (req) => {
    const { id } = req.params as { id: string };
    const claim = await getClaim(app.prisma, id, req.user);
    return { claim };
  });

  // Printable A5 voucher (half A4). Owner or any admin (branch-scoped) may download.
  app.get('/claims/:id/voucher', { preHandler: authenticate }, async (req, reply) => {
    const { id } = req.params as { id: string };
    const claim = await getClaim(app.prisma, id, req.user);
    const pdf = await generateClaimVoucherPdf(claim);
    return reply
      .type('application/pdf')
      .header('Content-Disposition', `inline; filename="claim-voucher-${claim.id.slice(-8)}.pdf"`)
      .send(pdf);
  });

  // Photo/PDF: owner or any admin (branch-scoped) may view.
  app.get('/claims/:id/file', { preHandler: authenticate }, async (req, reply) => {
    const { id } = req.params as { id: string };
    const { which } = req.query as { which?: string };
    const claim = await app.prisma.claim.findUnique({ where: { id }, include: { employee: { select: { branchId: true } } } });
    if (!claim) throw AppError.notFound('Claim');
    if (req.user.role === 'EMPLOYEE' && claim.employeeId !== req.user.sub) {
      throw new AppError('Forbidden', 403);
    }
    if (req.user.role !== 'EMPLOYEE' && req.user.branchId && claim.employee.branchId !== req.user.branchId) {
      throw new AppError('This claim belongs to another branch', 403);
    }
    return which === 'pdf'
      ? serveClaimFile(req, reply, claim.documentFileId, claim.documentUrl)
      : serveClaimFile(req, reply, claim.photoFileId, claim.photoUrl);
  });

  // ── Admin ──
  // Viewing: all admin roles incl. the cashier. Approval decisions: managers only.
  // Disbursement (mark paid): cashier / payroll admin / super admin.
  // An admin with a branchId on their account only sees that branch's claims.
  const viewGuard = requireRole('SUPER_ADMIN', 'HR_MANAGER', 'BRANCH_MANAGER', 'PAYROLL_ADMIN', 'CASHIER');
  const approveGuard = requireRole('SUPER_ADMIN', 'HR_MANAGER', 'BRANCH_MANAGER', 'PAYROLL_ADMIN');
  const payGuard = requireRole('SUPER_ADMIN', 'PAYROLL_ADMIN', 'CASHIER');

  app.get('/admin/claims', { preHandler: viewGuard }, async (req) => {
    const { status } = req.query as { status?: string };
    const claims = await listClaims(app.prisma, status, req.user.branchId);
    return { claims };
  });

  app.get('/admin/claims/stats', { preHandler: viewGuard }, async (req) => {
    return claimStats(app.prisma, req.user.branchId);
  });

  app.patch('/admin/claims/:id/approve', { preHandler: approveGuard }, async (req) => {
    const { id } = req.params as { id: string };
    const claim = await actOnClaim(app.prisma, req.user.sub, id, 'APPROVED', undefined, req.user.branchId);
    // Decision made → clear the "to approve" notification for every approver.
    await app.prisma.notification.deleteMany({ where: { claimId: id, type: 'CLAIM_SUBMITTED' } });
    await pushToEmployee(app.prisma, claim.employeeId, 'Claim approved \u2713', `${claim.title} \u2014 Rs.${claim.amount.toLocaleString('en-IN')} approved. Cash counter will pay it out.`);
    // Approved → the branch's cashier(s) take over: check + pay.
    const emp = await app.prisma.employee.findUnique({
      where: { id: claim.employeeId },
      select: { name: true, branchId: true },
    });
    if (emp) {
      await notifyAdmins(app.prisma, await cashierIds(app.prisma, emp.branchId), {
        type: 'CLAIM_APPROVED',
        title: 'Approved claim ready to pay',
        body: `${emp.name}: ${claim.title} — Rs.${claim.amount.toLocaleString('en-IN')}`,
        claimId: claim.id,
      });
    }
    return { claim };
  });

  app.patch('/admin/claims/:id/reject', { preHandler: approveGuard }, async (req) => {
    const { id } = req.params as { id: string };
    const { note } = (req.body as { note?: string }) ?? {};
    const claim = await actOnClaim(app.prisma, req.user.sub, id, 'REJECTED', note, req.user.branchId);
    await app.prisma.notification.deleteMany({ where: { claimId: id, type: 'CLAIM_SUBMITTED' } });
    await pushToEmployee(app.prisma, claim.employeeId, 'Claim rejected', `${claim.title}${note ? ` \u2014 ${note}` : ''}`);
    return { claim };
  });

  app.patch('/admin/claims/:id/clarify', { preHandler: approveGuard }, async (req) => {
    const { id } = req.params as { id: string };
    const { note } = (req.body as { note?: string }) ?? {};
    const claim = await actOnClaim(app.prisma, req.user.sub, id, 'NEEDS_CLARIFICATION', note, req.user.branchId);
    await app.prisma.notification.deleteMany({ where: { claimId: id, type: 'CLAIM_SUBMITTED' } });
    await pushToEmployee(app.prisma, claim.employeeId, 'Clarification needed on your claim', `${claim.title}${note ? ` \u2014 ${note}` : ''}. Open My Claims to reply.`);
    return { claim };
  });

  app.patch('/admin/claims/:id/pay', { preHandler: payGuard }, async (req) => {
    const { id } = req.params as { id: string };
    const { note } = (req.body as { note?: string }) ?? {};
    const claim = await payClaim(app.prisma, req.user.sub, id, note, req.user.branchId);
    // Paid → nothing left to act on; clear all remaining notifications for this claim.
    await app.prisma.notification.deleteMany({ where: { claimId: id } });
    await pushToEmployee(app.prisma, claim.employeeId, 'Claim paid \u2713', `${claim.title} \u2014 Rs.${claim.amount.toLocaleString('en-IN')} paid. Collect/verify with the cashier.`);
    return { claim };
  });
}
