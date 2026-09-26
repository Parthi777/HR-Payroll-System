import { createHmac, timingSafeEqual } from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import type { Prisma, PrismaClient } from '@prisma/client';
import { env } from '../../config/env.js';
import { logger } from '../../utils/logger.js';
import { AppError } from '../../utils/AppError.js';
import { requireTenantId, runAsPlatform, runInTenant } from '../../context/tenant-context.js';
import { claimTypeLabel } from '../claim/claim-types.js';
import { COMPANY_TZ } from '../../utils/time.js';
import type { JwtPayload } from '../../middleware/auth.js';

/**
 * The dealer's accounting ERP, as a connected system.
 *
 * Claims are raised and approved here; the money is paid out of the ERP's cash
 * book, which posts the expense and tells us the claim is PAID. Two directions:
 *
 *   out  claim.approved / claim.changed events, signed, from an outbox —
 *        written when the decision is made, delivered at once and retried by a
 *        minute sweep until the ERP acknowledges them;
 *   in   /api/integration/v1: the ERP reads claims, people, attendance and
 *        payroll, and settles claims it has paid.
 *
 * A lost event costs a delay, never a claim: the ERP also pulls approved claims
 * on its own schedule. Nothing here stores a secret. The token is a signed JWT
 * whose version is checked against the client row; the webhook signing secret
 * is derived from the server secret, the client id and that version, so
 * rotating the client replaces both at once.
 */

export const INTEGRATION_TOKEN_DAYS = 3650;
const MAX_ATTEMPTS = 12;

export interface IssuedCredentials {
  readonly token: string;
  readonly webhookSecret: string;
}

/** The secret a client's webhooks are signed with. Deterministic, never stored. */
export function webhookSecret(clientId: string, tokenVersion: number): string {
  return createHmac('sha256', env.JWT_SECRET).update(`integration-webhook:${clientId}:${tokenVersion}`).digest('hex');
}

/** `sha256=<hex>` over `<timestamp>.<body>` — what the ERP recomputes. */
export function signBody(secret: string, timestamp: string, body: string): string {
  return `sha256=${createHmac('sha256', secret).update(`${timestamp}.${body}`).digest('hex')}`;
}

/** Constant-time check of a signature, for the tests and for anyone verifying one. */
export function verifySignature(secret: string, timestamp: string, body: string, signature: string): boolean {
  const expected = Buffer.from(signBody(secret, timestamp, body));
  const given = Buffer.from(signature);
  return expected.length === given.length && timingSafeEqual(expected, given);
}

export function issueCredentials(
  app: FastifyInstance,
  client: { id: string; tenantId: string; tokenVersion: number },
): IssuedCredentials {
  const token = app.jwt.sign(
    {
      sub: client.id,
      role: 'INTEGRATION',
      scope: 'INTEGRATION' as const,
      tenantId: client.tenantId,
      deviceVersion: client.tokenVersion,
    } satisfies JwtPayload,
    { expiresIn: `${INTEGRATION_TOKEN_DAYS}d` },
  );
  return { token, webhookSecret: webhookSecret(client.id, client.tokenVersion) };
}

/** Whether approved claims are paid in the ERP rather than here. */
export async function claimsPaidInErp(prisma: PrismaClient): Promise<boolean> {
  const count = await prisma.integrationClient.count({ where: { isActive: true, paysClaims: true } });
  return count > 0;
}

// ─────────────────────────────────────────────────────────────────────────────
// Payloads
// ─────────────────────────────────────────────────────────────────────────────

const claimSelect = {
  id: true, claimNo: true, voucherNo: true, status: true, type: true, title: true, description: true,
  amount: true, reviewedAt: true, reviewedBy: true, reviewerNote: true, paidAt: true, paidNote: true,
  photoFileId: true, photoUrl: true, documentFileId: true, documentUrl: true, createdAt: true, updatedAt: true,
  employee: { select: { id: true, employeeCode: true, name: true, branchId: true, branch: { select: { name: true } } } },
} satisfies Prisma.ClaimSelect;

type ClaimRow = Prisma.ClaimGetPayload<{ select: typeof claimSelect }>;

export interface ClaimPayload {
  readonly id: string;
  readonly claimNo: number | null;
  readonly voucherNo: number | null;
  readonly status: string;
  readonly type: string;
  readonly typeLabel: string;
  readonly title: string;
  readonly description: string | null;
  readonly amount: number;
  readonly employee: { id: string; code: string; name: string; branchId: string; branchName: string };
  readonly decidedAt: string | null;
  readonly decidedBy: string | null;
  readonly note: string | null;
  readonly paidAt: string | null;
  readonly hasPhoto: boolean;
  readonly hasDocument: boolean;
  readonly createdAt: string;
  readonly updatedAt: string;
}

async function toClaimPayloads(prisma: PrismaClient, rows: ClaimRow[]): Promise<ClaimPayload[]> {
  const adminIds = [...new Set(rows.map((r) => r.reviewedBy).filter((v): v is string => Boolean(v)))];
  const admins = adminIds.length
    ? await prisma.adminUser.findMany({ where: { id: { in: adminIds } }, select: { id: true, name: true } })
    : [];
  const names = new Map(admins.map((a) => [a.id, a.name]));
  return rows.map((c) => ({
    id: c.id,
    claimNo: c.claimNo,
    voucherNo: c.voucherNo,
    status: c.status,
    type: c.type,
    typeLabel: claimTypeLabel(c.type),
    title: c.title,
    description: c.description,
    amount: c.amount,
    employee: {
      id: c.employee.id, code: c.employee.employeeCode, name: c.employee.name,
      branchId: c.employee.branchId, branchName: c.employee.branch.name,
    },
    decidedAt: c.reviewedAt?.toISOString() ?? null,
    decidedBy: c.reviewedBy ? names.get(c.reviewedBy) ?? null : null,
    note: c.reviewerNote,
    paidAt: c.paidAt?.toISOString() ?? null,
    hasPhoto: Boolean(c.photoFileId || c.photoUrl),
    hasDocument: Boolean(c.documentFileId || c.documentUrl),
    createdAt: c.createdAt.toISOString(),
    updatedAt: c.updatedAt.toISOString(),
  }));
}

export async function listClaimsForIntegration(
  prisma: PrismaClient,
  filter: { status?: string[]; since?: Date; limit: number },
): Promise<ClaimPayload[]> {
  const rows = await prisma.claim.findMany({
    where: {
      ...(filter.status?.length ? { status: { in: filter.status } } : {}),
      ...(filter.since ? { updatedAt: { gt: filter.since } } : {}),
    },
    orderBy: { updatedAt: 'asc' },
    take: filter.limit,
    select: claimSelect,
  });
  return toClaimPayloads(prisma, rows);
}

export async function claimPayload(prisma: PrismaClient, claimId: string): Promise<ClaimPayload> {
  const row = await prisma.claim.findUnique({ where: { id: claimId }, select: claimSelect });
  if (!row) throw AppError.notFound('Claim');
  return (await toClaimPayloads(prisma, [row]))[0]!;
}

// ─────────────────────────────────────────────────────────────────────────────
// Outbox
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Announce a claim decision to every connected system with a webhook. Called
 * after the decision is saved; delivery is started without waiting for it, so
 * an ERP that is slow or down never holds up the approver.
 */
export async function emitClaimEvent(
  prisma: PrismaClient,
  claimId: string,
  type: 'claim.approved' | 'claim.changed',
): Promise<void> {
  try {
    const clients = await prisma.integrationClient.findMany({
      where: { isActive: true, webhookUrl: { not: null } },
      select: { id: true },
    });
    if (clients.length === 0) return;
    const payload = await claimPayload(prisma, claimId);
    const tenantId = requireTenantId();
    await prisma.integrationEvent.createMany({
      data: clients.map((c) => ({
        tenantId, clientId: c.id, type, entityId: claimId, payload: payload as unknown as Prisma.InputJsonValue,
      })),
    });
    void deliverDue(prisma).catch((err) => logger.warn({ err }, 'integration delivery failed'));
  } catch (err) {
    // The decision stands whatever happens here; the ERP's pull will find it.
    logger.warn({ err, claimId, type }, 'could not queue integration event');
  }
}

/** Deliver what is due for the current tenant. Returns how many were delivered. */
export async function deliverDue(prisma: PrismaClient, limit = 25): Promise<number> {
  const due = await prisma.integrationEvent.findMany({
    where: { status: 'PENDING', nextAttemptAt: { lte: new Date() } },
    orderBy: { createdAt: 'asc' },
    take: limit,
    include: { client: { select: { webhookUrl: true, isActive: true, tokenVersion: true } } },
  });
  let delivered = 0;
  for (const event of due) {
    if (!event.client.isActive || !event.client.webhookUrl) {
      await prisma.integrationEvent.update({
        where: { id: event.id },
        data: { status: 'FAILED', lastError: 'The connection is switched off or has no webhook address' },
      });
      continue;
    }
    const result = await postEvent(event.client.webhookUrl, webhookSecret(event.clientId, event.client.tokenVersion), {
      id: event.id, type: event.type, createdAt: event.createdAt.toISOString(), data: event.payload,
    });
    const attempts = event.attempts + 1;
    if (result.ok) {
      delivered += 1;
      await prisma.integrationEvent.update({
        where: { id: event.id },
        data: { status: 'DELIVERED', attempts, deliveredAt: new Date(), lastError: null },
      });
    } else {
      const backoffMinutes = Math.min(2 ** attempts, 360);
      await prisma.integrationEvent.update({
        where: { id: event.id },
        data: {
          attempts,
          lastError: result.error.slice(0, 500),
          status: attempts >= MAX_ATTEMPTS ? 'FAILED' : 'PENDING',
          nextAttemptAt: new Date(Date.now() + backoffMinutes * 60_000),
        },
      });
    }
  }
  return delivered;
}

export async function postEvent(
  url: string,
  secret: string,
  body: unknown,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const text = JSON.stringify(body);
  const timestamp = String(Math.floor(Date.now() / 1000));
  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-hr-timestamp': timestamp,
        'x-hr-signature': signBody(secret, timestamp, text),
        'x-hr-event-id': (body as { id?: string }).id ?? '',
      },
      body: text,
      signal: AbortSignal.timeout(10_000),
    });
    if (response.ok) return { ok: true };
    return { ok: false, error: `HTTP ${response.status}: ${(await response.text()).slice(0, 300)}` };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}

/**
 * Retry undelivered events once a minute, tenant by tenant — the same shape as
 * the punch-reminder sweep, so no unscoped read is needed.
 */
export function startIntegrationScheduler(prisma: PrismaClient): () => void {
  let running = false;
  const tick = async () => {
    if (running) return;
    running = true;
    try {
      const tenants = await runAsPlatform('integration-scheduler', () =>
        prisma.tenant.findMany({ where: { status: 'ACTIVE' }, select: { id: true } }),
      );
      for (const tenant of tenants) {
        try {
          await runInTenant(
            { tenantId: tenant.id, subjectId: 'integration-scheduler', role: 'SUPER_ADMIN' },
            () => deliverDue(prisma),
          );
        } catch (err) {
          logger.warn({ err, tenantId: tenant.id }, 'integration sweep failed for tenant');
        }
      }
    } catch (err) {
      logger.warn({ err }, 'integration sweep failed');
    } finally {
      running = false;
    }
  };
  const timer = setInterval(tick, 60_000);
  timer.unref();
  return () => clearInterval(timer);
}

// ─────────────────────────────────────────────────────────────────────────────
// Exports for the ERP: people, attendance, payroll
// ─────────────────────────────────────────────────────────────────────────────

export async function listEmployeesForIntegration(prisma: PrismaClient, since?: Date) {
  const rows = await prisma.employee.findMany({
    where: since ? { updatedAt: { gt: since } } : {},
    orderBy: { updatedAt: 'asc' },
    select: {
      id: true, employeeCode: true, name: true, phone: true, email: true, status: true, joiningDate: true,
      branchId: true, branch: { select: { name: true } },
      department: { select: { name: true } }, designation: { select: { name: true } }, updatedAt: true,
    },
  });
  return rows.map((e) => ({
    id: e.id, code: e.employeeCode, name: e.name, mobile: e.phone, email: e.email, status: e.status,
    joiningDate: e.joiningDate.toISOString().slice(0, 10), branchId: e.branchId, branchName: e.branch.name,
    department: e.department?.name ?? null, designation: e.designation?.name ?? null,
    updatedAt: e.updatedAt.toISOString(),
  }));
}

export async function listBranchesForIntegration(prisma: PrismaClient) {
  const rows = await prisma.branch.findMany({ select: { id: true, name: true }, orderBy: { name: 'asc' } });
  return rows;
}

const hhmm = (d: Date | null | undefined): string | null => {
  if (!d) return null;
  return new Intl.DateTimeFormat('en-GB', { timeZone: COMPANY_TZ, hour: '2-digit', minute: '2-digit', hour12: false }).format(d);
};
const isoDay = (d: Date): string =>
  new Intl.DateTimeFormat('en-CA', { timeZone: COMPANY_TZ, year: 'numeric', month: '2-digit', day: '2-digit' }).format(d);

/**
 * Attendance in the shape the ERP's attendance mirror reads
 * (`AttendanceRecord` in its attendance-client.ts): one record per person per
 * day, keyed by our employee id. Approved leave with no punch is a LEAVE day.
 */
export interface AttendanceOut {
  employeeRef: string;
  date: string;
  status: 'PRESENT' | 'ABSENT' | 'HALF_DAY' | 'LEAVE' | 'HOLIDAY';
  firstIn: string | null;
  lastOut: string | null;
  workedMinutes?: number;
  leaveCode?: string | null;
  recordRef: string;
  remarks: string | null;
}

export async function attendanceForIntegration(prisma: PrismaClient, from: Date, to: Date): Promise<AttendanceOut[]> {
  const [rows, leaves] = await Promise.all([
    prisma.attendance.findMany({
      where: { date: { gte: from, lte: to } },
      select: { id: true, employeeId: true, date: true, checkIn: true, checkOut: true, status: true, workingMinutes: true },
      orderBy: [{ date: 'asc' }],
    }),
    prisma.leave.findMany({
      where: { status: 'APPROVED', fromDate: { lte: to }, toDate: { gte: from } },
      select: { id: true, employeeId: true, type: true, fromDate: true, toDate: true },
    }),
  ]);
  const map: Record<string, AttendanceOut['status']> = {
    PRESENT: 'PRESENT', LATE: 'PRESENT', HALF_DAY: 'HALF_DAY', ABSENT: 'ABSENT', ON_LEAVE: 'LEAVE', HOLIDAY: 'HOLIDAY',
  };
  const records: AttendanceOut[] = rows.map((a) => ({
    employeeRef: a.employeeId,
    date: isoDay(a.date),
    status: map[a.status] ?? 'PRESENT',
    firstIn: hhmm(a.checkIn),
    lastOut: hhmm(a.checkOut),
    workedMinutes: a.workingMinutes ?? undefined,
    recordRef: a.id,
    remarks: a.status === 'LATE' ? 'Late' : null,
  }));
  const seen = new Set(records.map((r) => `${r.employeeRef}|${r.date}`));
  for (const leave of leaves) {
    for (let d = new Date(Math.max(leave.fromDate.getTime(), from.getTime()));
      d <= leave.toDate && d <= to; d = new Date(d.getTime() + 86_400_000)) {
      const day = isoDay(d);
      if (seen.has(`${leave.employeeId}|${day}`)) continue;
      seen.add(`${leave.employeeId}|${day}`);
      records.push({
        employeeRef: leave.employeeId, date: day, status: 'LEAVE', firstIn: null, lastOut: null,
        leaveCode: leave.type, recordRef: leave.id, remarks: null,
      });
    }
  }
  return records;
}

/** A month's finalised payslips, one line per employee. */
export async function payrollForIntegration(prisma: PrismaClient, year: number, month: number) {
  const slips = await prisma.payslip.findMany({
    where: { year, month },
    select: {
      id: true, status: true, grossSalary: true, pfDeduction: true, esiDeduction: true, ptDeduction: true,
      tdsDeduction: true, otherDeductions: true, netSalary: true, presentDays: true, lopDays: true, updatedAt: true,
      employee: { select: { id: true, employeeCode: true, name: true, branchId: true, branch: { select: { name: true } } } },
    },
    orderBy: { employee: { employeeCode: 'asc' } },
  });
  const finalized = slips.length > 0 && slips.every((s) => s.status === 'FINALIZED');
  return {
    year,
    month,
    finalized,
    lines: slips.map((s) => ({
      payslipId: s.id,
      employee: { id: s.employee.id, code: s.employee.employeeCode, name: s.employee.name, branchId: s.employee.branchId, branchName: s.employee.branch.name },
      gross: s.grossSalary, pf: s.pfDeduction, esi: s.esiDeduction, professionalTax: s.ptDeduction,
      tds: s.tdsDeduction, other: s.otherDeductions, net: s.netSalary, presentDays: s.presentDays, lopDays: s.lopDays,
      status: s.status,
    })),
  };
}
