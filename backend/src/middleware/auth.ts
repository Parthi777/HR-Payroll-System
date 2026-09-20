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
  | 'CASHIER'
  /**
   * Platform staff, above tenancy. Deliberately not accepted by any
   * `requireRole(...)` call, so a platform token cannot reach a tenant's data
   * through a tenant route — the platform API is its own surface.
   */
  | 'PLATFORM_ADMIN';

export interface JwtPayload {
  sub: string; // employeeId, adminId, or platformUserId
  role: JwtRole;
  /**
   * The tenant this token was issued for. Present on every tenant token and
   * absent on platform tokens — `authenticate()` rejects a tenant request
   * without it, and `requirePlatform()` rejects a platform request with it.
   */
  tenantId?: string;
  /**
   * Which API surface the token is for. Absent is treated as TENANT.
   *
   * PLATFORM_CHALLENGE is the half-way token between a correct platform
   * password and a correct second-step code. It opens no route at all; the
   * only thing it is good for is being handed back to the two-step endpoints.
   */
  scope?: 'TENANT' | 'PLATFORM' | 'PLATFORM_CHALLENGE' | 'KIOSK';
  /** On a challenge: whether the holder is confirming a code or enrolling. */
  purpose?: 'verify' | 'enroll';
  /**
   * On a kiosk token: the branch the tablet was paired to, and the device row's
   * token version. The version is compared with the row on every request, so
   * revoking a lost tablet takes effect immediately rather than in six months.
   */
  deviceVersion?: number;
  /**
   * On a platform token: the second step was passed. Tokens issued before
   * two-step verification existed lack it, and are refused — so deploying it
   * ends every password-only session rather than letting them run for 8 hours.
   */
  twoStep?: true;
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

  /**
   * The second signer, registered in server.ts with `namespace: 'refresh'` so
   * refresh tokens carry their own secret. The plugin creates
   * `fastify.jwt[namespace]` at runtime but cannot type a name it only learns
   * at registration, so it is declared here.
   */
  interface JWT {
    refresh: import('@fastify/jwt').JWT;
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
  if (payload.scope === 'PLATFORM' || payload.scope === 'PLATFORM_CHALLENGE') {
    // A platform token carries no tenant, so nothing here could be scoped by it.
    throw AppError.forbidden('Platform sign-in cannot be used on tenant endpoints');
  }
  if (payload.scope === 'KIOSK') {
    // A kiosk is a shared tablet, not a person. It may punch on the kiosk
    // routes and reach nothing else — no payroll, no employee records, no
    // reports — however long its token lives.
    throw AppError.forbidden('A kiosk device cannot be used to sign in');
  }
  if (!payload.tenantId) {
    // Pre-tenancy token. Nothing can be scoped from it, so it must not be honoured.
    throw AppError.unauthorized('Session is out of date — please sign in again');
  }
  const tenantId = payload.tenantId;

  const prisma = request.server.prisma;

  // Reject a token replayed against a different tenant's URL, and refuse a
  // suspended tenant once, here, rather than as empty screens further in.
  const slug = tenantSlugFromRequest(request);
  if (slug) {
    const named = await resolveTenant(prisma, slug);
    if (named.id !== tenantId) {
      throw AppError.unauthorized('This session belongs to a different workspace');
    }
  } else {
    const tenant = await prisma.tenant.findUnique({
      where: { id: tenantId },
      select: { status: true, name: true },
    });
    if (!tenant) throw AppError.unauthorized('Workspace no longer exists');
    if (tenant.status !== 'ACTIVE') {
      throw new AppError(`The ${tenant.name} workspace is suspended — please contact support.`, 403);
    }
  }

  enterContext({
    kind: 'TENANT',
    tenantId,
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
    tenantId,
    subjectId: payload.sub,
    role,
    branchId,
  });
}

/**
 * Guard for the platform API — the surface where dealers are onboarded.
 *
 * Deliberately a separate function from `authenticate()`, not a role inside it:
 * platform staff are not members of any tenant, so there is no tenant context to
 * establish and no tenant data they can reach by accident. The context is
 * PLATFORM, which the Prisma extension lets through unscoped — which is exactly
 * why nothing but this narrow route group may run under it.
 */
export async function requirePlatform(request: FastifyRequest, _reply: FastifyReply) {
  try {
    await request.jwtVerify();
  } catch {
    throw AppError.unauthorized('Missing or invalid token');
  }

  const payload = request.user;
  if (payload.scope !== 'PLATFORM') {
    throw AppError.forbidden('This endpoint requires a platform sign-in');
  }
  if (payload.twoStep !== true) {
    throw AppError.unauthorized('Please sign in again — the console now needs two-step verification');
  }

  // The row is the authority here too: revoking a platform account takes effect
  // on the next request rather than whenever the token expires.
  const staff = await request.server.prisma.platformUser.findUnique({
    where: { id: payload.sub },
    select: { isActive: true },
  });
  if (!staff) throw AppError.unauthorized('Account no longer exists');
  if (!staff.isActive) throw AppError.unauthorized('Account disabled');

  enterContext({ kind: 'PLATFORM', subjectId: payload.sub });
}

/**
 * Guard for the branch kiosk — a paired tablet, acting for whoever is standing
 * in front of it.
 *
 * Its own scope rather than a role, for the same reason the platform API has
 * one: the kiosk is not a person with permissions, it is a device with exactly
 * one job. The row is read on every request, so deactivating a tablet or
 * bumping its version in Master Control cuts it off at once — which matters
 * more here than anywhere else, because the token deliberately lives for
 * months.
 */
export async function requireKiosk(request: FastifyRequest, _reply: FastifyReply) {
  try {
    await request.jwtVerify();
  } catch {
    throw AppError.unauthorized('This tablet is not paired');
  }

  const payload = request.user;
  if (payload.scope !== 'KIOSK' || !payload.tenantId || !payload.branchId) {
    throw AppError.forbidden('This endpoint is for a paired kiosk');
  }

  const prisma = request.server.prisma;
  const tenant = await prisma.tenant.findUnique({
    where: { id: payload.tenantId },
    select: { status: true, name: true },
  });
  if (!tenant) throw AppError.unauthorized('Workspace no longer exists');
  if (tenant.status !== 'ACTIVE') {
    throw new AppError(`The ${tenant.name} workspace is suspended — please contact support.`, 403);
  }

  enterContext({
    kind: 'TENANT',
    tenantId: payload.tenantId,
    subjectId: payload.sub,
    role: 'EMPLOYEE',
    branchId: payload.branchId,
  });

  const device = await prisma.kioskDevice.findUnique({
    where: { id: payload.sub },
    select: { isActive: true, tokenVersion: true, branchId: true, name: true },
  });
  if (!device) throw AppError.unauthorized('This tablet is no longer registered');
  if (!device.isActive) throw AppError.unauthorized('This tablet has been switched off by an administrator');
  if (device.tokenVersion !== payload.deviceVersion) {
    throw AppError.unauthorized('This tablet needs pairing again');
  }
  // The row wins over the token, the same way it does for a person's account.
  request.user = { ...payload, branchId: device.branchId };
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
