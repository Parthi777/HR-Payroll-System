import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { promises as fs } from 'fs';
import path from 'path';
import { authenticate, requireRole } from '../middleware/auth.js';
import { AppError } from '../utils/AppError.js';
import {
  createClaim,
  resubmitClaim,
  listMyClaims,
  listClaims,
  actOnClaim,
  claimStats,
} from '../services/claim/claim.service.js';
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
    return { claim };
  });

  // Photo/PDF: owner or any admin may view.
  app.get('/claims/:id/file', { preHandler: authenticate }, async (req, reply) => {
    const { id } = req.params as { id: string };
    const { which } = req.query as { which?: string };
    const claim = await app.prisma.claim.findUnique({ where: { id } });
    if (!claim) throw AppError.notFound('Claim');
    if (req.user.role === 'EMPLOYEE' && claim.employeeId !== req.user.sub) {
      throw new AppError('Forbidden', 403);
    }
    return which === 'pdf'
      ? serveClaimFile(req, reply, claim.documentFileId, claim.documentUrl)
      : serveClaimFile(req, reply, claim.photoFileId, claim.photoUrl);
  });

  // ── Admin ──
  const adminGuard = requireRole('SUPER_ADMIN', 'HR_MANAGER', 'BRANCH_MANAGER', 'PAYROLL_ADMIN');

  app.get('/admin/claims', { preHandler: adminGuard }, async (req) => {
    const { status } = req.query as { status?: string };
    const claims = await listClaims(app.prisma, status);
    return { claims };
  });

  app.get('/admin/claims/stats', { preHandler: adminGuard }, async () => {
    return claimStats(app.prisma);
  });

  app.patch('/admin/claims/:id/approve', { preHandler: adminGuard }, async (req) => {
    const { id } = req.params as { id: string };
    const claim = await actOnClaim(app.prisma, req.user.sub, id, 'APPROVED');
    return { claim };
  });

  app.patch('/admin/claims/:id/reject', { preHandler: adminGuard }, async (req) => {
    const { id } = req.params as { id: string };
    const { note } = (req.body as { note?: string }) ?? {};
    const claim = await actOnClaim(app.prisma, req.user.sub, id, 'REJECTED', note);
    return { claim };
  });

  app.patch('/admin/claims/:id/clarify', { preHandler: adminGuard }, async (req) => {
    const { id } = req.params as { id: string };
    const { note } = (req.body as { note?: string }) ?? {};
    const claim = await actOnClaim(app.prisma, req.user.sub, id, 'NEEDS_CLARIFICATION', note);
    return { claim };
  });
}
