import type { FastifyReply, FastifyRequest } from 'fastify';
import type { PrismaClient } from '@prisma/client';
import { AppError } from '../utils/AppError.js';
import { enterContext } from '../context/tenant-context.js';
import { resolveTenant, tenantSlugFromRequest } from '../context/tenant-resolve.js';

export type JwtRole =
  | 'EMPLOYEE'
  | 'SUPER_ADMIN'
  | 'HR_MANAGER'
  | 'BRANCH_MANAGER'
  | 'PAYROLL_ADMIN'
  | 'CASHIER';

export interface JwtPayload {
  sub: string; // employeeId or adminId
  role: JwtRole;
  /** The tenant this token was issued for. Required on every tenant token. */
  tenantId: string;
  branchId?: string;
  /**
   * Access and refresh tokens share one signing secret, so they are told apart
   * by this claim — without it, an access token is itself accepted at
   * /refresh-token. Absent on tokens issued before this was introduced.
   */
  typ?: 'access' | 'refresh';
}

declare module '@fastify/jwt' {
  interface FastifyJWT {
    payload: JwtPayload;
    user: JwtPayload;
  }
}

/**
 * Verify the JWT, establish the tenant context, and confirm the caller still
 * exists and is still active.
 *
 * The token is a *hint*; the database row is the authority. Role and branchId
 * are taken from the row, never from the token, so a token issued before a
 * demotion or a branch reassignment cannot keep the old privileges — and
 * deactivating an account takes effect on the next request rather than
 * whenever the token happens to expire.
 *
 * The subject lookup runs inside the tenant context, so it is itself scoped:
 * a token naming tenant A can only ever resolve a subject belonging to tenant
 * A. That is why no unscoped bypass is needed here.
 */
export async function authenticate(request: FastifyRequest, _reply: FastifyReply) {
  try {
    await request.jwtVerify();
  } catch {
    throw AppError.unauthorized('Missing or invalid token');
  }

  const payload = request.user;
  if (!payload.tenantId) {
    // Pre-tenancy token. Nothing can be scoped from it, so it must not be honoured.
    throw AppError.unauthorized('Session is out of date — please sign in again');
  }

  const prisma = request.server.prisma;

  // Reject a token replayed against a different tenant's URL, and refuse a
  // suspended tenant once, here, rather than as empty screens further in.
  const slug = tenantSlugFromRequest(request);
  if (slug) {
    const named = await resolveTenant(prisma, slug);
    if (named.id !== payload.tenantId) {
      throw AppError.unauthorized('This session belongs to a different workspace');
    }
  } else {
    const tenant = await prisma.tenant.findUnique({
      where: { id: payload.tenantId },
      select: { status: true, name: true },
    });
    if (!tenant) throw AppError.unauthorized('Workspace no longer exists');
    if (tenant.status !== 'ACTIVE') {
      throw new AppError(`The ${tenant.name} workspace is suspended — please contact support.`, 403);
    }
  }

  enterContext({
    kind: 'TENANT',
    tenantId: payload.tenantId,
    subjectId: payload.sub,
    role: payload.role,
    branchId: payload.branchId,
  });

  // Now scoped: this can only find a subject inside the token's own tenant.
  const subject =
    payload.role === 'EMPLOYEE'
      ? await prisma.employee.findUnique({
          where: { id: payload.sub },
          select: { status: true, branchId: true },
        })
      : await prisma.adminUser.findUnique({
          where: { id: payload.sub },
          select: { isActive: true, role: true, branchId: true },
        });

  if (!subject) throw AppError.unauthorized('Account no longer exists');
  if ('status' in subject && subject.status !== 'ACTIVE') {
    throw AppError.unauthorized('Account disabled — contact HR');
  }
  if ('isActive' in subject && !subject.isActive) {
    throw AppError.unauthorized('Account disabled');
  }

  // The row wins over the token for anything authorization depends on.
  const role = ('role' in subject ? (subject.role as JwtRole) : 'EMPLOYEE') ?? payload.role;
  const branchId = subject.branchId ?? undefined;
  request.user = { ...payload, role, branchId };
  enterContext({
    kind: 'TENANT',
    tenantId: payload.tenantId,
    subjectId: payload.sub,
    role,
    branchId,
  });
}

/** Role-based access control. SUPER_ADMIN > HR_MANAGER > BRANCH_MANAGER > PAYROLL_ADMIN. */
export function requireRole(...roles: JwtRole[]) {
  return async (request: FastifyRequest, _reply: FastifyReply) => {
    await authenticate(request, _reply);
    if (!roles.includes(request.user.role)) {
      throw AppError.forbidden('Insufficient permissions');
    }
  };
}

/**
 * Object-level guard for actions taken *on* an employee (approving their punch,
 * deciding their leave, raising a punch for them).
 *
 * Company-wide roles pass. A BRANCH_MANAGER may only act on their own reports —
 * or, when their account is pinned to a branch, on that branch. This mirrors the
 * scoping the pending-approval *listings* already apply (attendance.routes.ts
 * `/admin/attendance/approvals`, leave.routes.ts `/admin/leaves/pending`), which
 * the decision endpoints were missing: a branch manager could approve any punch
 * in the company by id, and ids are handed out by `/admin/attendance/live`.
 */
export async function assertManages(
  prisma: PrismaClient,
  user: JwtPayload,
  employeeId: string,
): Promise<void> {
  if (user.role === 'SUPER_ADMIN' || user.role === 'HR_MANAGER') return;

  const employee = await prisma.employee.findUnique({
    where: { id: employeeId },
    select: { reportingManagerId: true, branchId: true },
  });
  if (!employee) throw AppError.notFound('Employee');

  if (employee.reportingManagerId === user.sub) return;
  if (user.branchId && employee.branchId === user.branchId) return;

  throw AppError.forbidden('This employee is not in your team');
}

/** Models whose ids may arrive in a request body and must be ownership-checked. */
type OwnedModel = 'branch' | 'department' | 'designation' | 'shift' | 'employee' | 'claim' | 'attendance' | 'leave';

/**
 * Confirm an id supplied by the caller belongs to the caller's tenant.
 *
 * The tenant-scoping extension covers ids the server chose, but not ids that
 * arrive in a request body — `createEmployeeSchema` accepts `branchId`,
 * `departmentId`, `designationId`, `shiftId` and `reportingManagerId`, and the
 * admin manual-punch accepts `employeeId`. Without this, a caller could attach
 * their new employee to another tenant's branch.
 *
 * The lookup itself needs no tenant filter: the extension adds one, so an id
 * from another tenant simply does not resolve. That also means the caller
 * cannot tell "not yours" from "does not exist", which is the right answer.
 */
export async function assertOwned(
  prisma: PrismaClient,
  model: OwnedModel,
  id: string | null | undefined,
): Promise<void> {
  if (!id) return; // optional foreign keys are the caller's business
  const delegate = prisma[model] as { findUnique(args: unknown): Promise<unknown> };
  const found = await delegate.findUnique({ where: { id }, select: { id: true } });
  if (!found) throw AppError.notFound(`${model[0].toUpperCase()}${model.slice(1)}`);
}
