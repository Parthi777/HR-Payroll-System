import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { requireIntegration, requireRole } from '../middleware/auth.js';
import { AppError } from '../utils/AppError.js';
import { requireTenantId } from '../context/tenant-context.js';
import { recordAudit } from '../services/audit/audit.service.js';
import { payClaim } from '../services/claim/claim.service.js';
import { serveClaimFile } from './claim.routes.js';
import {
  attendanceForIntegration,
  claimPayload,
  deliverDue,
  issueCredentials,
  listBranchesForIntegration,
  listClaimsForIntegration,
  listEmployeesForIntegration,
  payrollForIntegration,
  postEvent,
  webhookSecret,
} from '../services/integration/integration.service.js';

/**
 * The dealer's accounting ERP, connected (see services/integration).
 *
 *   /admin/integrations      Master Control: connect, rotate, switch off, log
 *   /integration/v1/...      the ERP itself, with its integration token only
 */

const webhookUrl = z
  .string()
  .trim()
  .url()
  .refine((u) => u.startsWith('https://') || /^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?\//.test(u), {
    message: 'The webhook address must use https',
  });

const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);

export async function integrationRoutes(app: FastifyInstance) {
  const owner = requireRole('SUPER_ADMIN');

  // ── Master Control ──────────────────────────────────────────────────────
  app.get('/admin/integrations', { preHandler: owner }, async () => {
    const [clients, events] = await Promise.all([
      app.prisma.integrationClient.findMany({
        orderBy: { createdAt: 'asc' },
        select: {
          id: true, name: true, webhookUrl: true, paysClaims: true, isActive: true, lastUsedAt: true, createdAt: true,
        },
      }),
      app.prisma.integrationEvent.findMany({
        orderBy: { createdAt: 'desc' },
        take: 50,
        select: { id: true, type: true, entityId: true, status: true, attempts: true, lastError: true, createdAt: true, deliveredAt: true },
      }),
    ]);
    return { clients, events };
  });

  app.post('/admin/integrations', { preHandler: owner }, async (req) => {
    const body = z
      .object({ name: z.string().trim().min(2).max(60), webhookUrl: webhookUrl.optional(), paysClaims: z.boolean().default(true) })
      .parse(req.body);
    const client = await app.prisma.integrationClient.create({
      data: {
        tenantId: requireTenantId(), name: body.name, webhookUrl: body.webhookUrl ?? null,
        paysClaims: body.paysClaims, createdById: req.user.sub,
      },
    });
    await recordAudit(req, 'INTEGRATION_CREATED', 'Integration', { entityId: client.id, metadata: { name: body.name } });
    // Shown once. Neither is stored in a form that can be read back.
    return { client, ...issueCredentials(app, client) };
  });

  app.patch('/admin/integrations/:id', { preHandler: owner }, async (req) => {
    const { id } = req.params as { id: string };
    const body = z
      .object({ webhookUrl: webhookUrl.nullable().optional(), paysClaims: z.boolean().optional(), isActive: z.boolean().optional() })
      .parse(req.body);
    const client = await app.prisma.integrationClient.update({ where: { id }, data: body });
    await recordAudit(req, 'INTEGRATION_UPDATED', 'Integration', { entityId: id, metadata: body });
    return { client };
  });

  app.post('/admin/integrations/:id/rotate', { preHandler: owner }, async (req) => {
    const { id } = req.params as { id: string };
    const client = await app.prisma.integrationClient.update({ where: { id }, data: { tokenVersion: { increment: 1 } } });
    await recordAudit(req, 'INTEGRATION_ROTATED', 'Integration', { entityId: id });
    return { client, ...issueCredentials(app, client) };
  });

  app.post('/admin/integrations/:id/ping', { preHandler: owner }, async (req) => {
    const { id } = req.params as { id: string };
    const client = await app.prisma.integrationClient.findUnique({ where: { id } });
    if (!client) throw AppError.notFound('Connection');
    if (!client.webhookUrl) throw new AppError('Set a webhook address first', 400);
    const result = await postEvent(client.webhookUrl, webhookSecret(client.id, client.tokenVersion), {
      id: `ping-${Date.now()}`, type: 'ping', createdAt: new Date().toISOString(), data: {},
    });
    return result;
  });

  app.post('/admin/integrations/deliver', { preHandler: owner }, async () => ({ delivered: await deliverDue(app.prisma) }));

  // ── The ERP ─────────────────────────────────────────────────────────────
  const erp = { preHandler: requireIntegration, config: { rateLimit: { max: 300, timeWindow: '1 minute' } } };

  app.get('/integration/v1/whoami', erp, async (req) => {
    const tenant = await app.prisma.tenant.findUnique({ where: { id: req.user.tenantId! }, select: { slug: true, name: true } });
    const client = await app.prisma.integrationClient.findUnique({ where: { id: req.user.sub }, select: { name: true, paysClaims: true } });
    return { workspace: tenant, connection: client };
  });

  app.get('/integration/v1/branches', erp, async () => ({ branches: await listBranchesForIntegration(app.prisma) }));

  app.get('/integration/v1/employees', erp, async (req) => {
    const q = z.object({ since: z.string().datetime({ offset: true }).optional() }).parse(req.query);
    return { employees: await listEmployeesForIntegration(app.prisma, q.since ? new Date(q.since) : undefined) };
  });

  app.get('/integration/v1/claims', erp, async (req) => {
    const q = z
      .object({
        status: z.string().optional(),
        since: z.string().datetime({ offset: true }).optional(),
        limit: z.coerce.number().int().min(1).max(500).default(200),
      })
      .parse(req.query);
    const claims = await listClaimsForIntegration(app.prisma, {
      status: q.status ? q.status.split(',').map((s) => s.trim().toUpperCase()) : undefined,
      since: q.since ? new Date(q.since) : undefined,
      limit: q.limit,
    });
    return { claims };
  });

  app.get('/integration/v1/claims/:id', erp, async (req) => {
    const { id } = req.params as { id: string };
    return { claim: await claimPayload(app.prisma, id) };
  });

  app.get('/integration/v1/claims/:id/file', erp, async (req, reply) => {
    const { id } = req.params as { id: string };
    const { which } = z.object({ which: z.enum(['photo', 'pdf']).default('photo') }).parse(req.query);
    const claim = await app.prisma.claim.findUnique({
      where: { id },
      select: { photoFileId: true, photoUrl: true, documentFileId: true, documentUrl: true },
    });
    if (!claim) throw AppError.notFound('Claim');
    return which === 'pdf'
      ? serveClaimFile(req, reply, claim.documentFileId, claim.documentUrl)
      : serveClaimFile(req, reply, claim.photoFileId, claim.photoUrl);
  });

  // The ERP paid the claim from its cash or bank book.
  app.post('/integration/v1/claims/:id/paid', erp, async (req) => {
    const { id } = req.params as { id: string };
    const body = z
      .object({
        erpVoucherNo: z.string().trim().min(1).max(40),
        paidAt: z.string().datetime({ offset: true }).optional(),
        note: z.string().trim().max(200).optional(),
      })
      .parse(req.body);
    const claim = await payClaim(app.prisma, req.user.sub, id, body.note, undefined, {
      voucherNo: body.erpVoucherNo,
      paidAt: body.paidAt ? new Date(body.paidAt) : undefined,
    });
    await app.prisma.notification.deleteMany({ where: { claimId: id } });
    await recordAudit(req, 'CLAIM_PAID', 'Claim', {
      entityId: id,
      metadata: { claimNo: claim.claimNo, voucherNo: claim.voucherNo, amount: claim.amount, erpVoucherNo: body.erpVoucherNo },
    });
    return { claim: await claimPayload(app.prisma, id) };
  });

  app.get('/integration/v1/attendance', erp, async (req) => {
    const q = z.object({ from: isoDate, to: isoDate }).parse(req.query);
    const from = new Date(`${q.from}T00:00:00Z`);
    const to = new Date(`${q.to}T23:59:59Z`);
    if (to < from) throw new AppError('`to` is before `from`', 400);
    if (to.getTime() - from.getTime() > 93 * 86_400_000) throw new AppError('Ask for at most three months at a time', 400);
    return attendanceForIntegration(app.prisma, from, to);
  });

  app.get('/integration/v1/payroll/:year/:month', erp, async (req) => {
    const p = z.object({ year: z.coerce.number().int().min(2020).max(2100), month: z.coerce.number().int().min(1).max(12) }).parse(req.params);
    return payrollForIntegration(app.prisma, p.year, p.month);
  });
}
