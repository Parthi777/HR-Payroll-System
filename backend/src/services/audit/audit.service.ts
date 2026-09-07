/**
 * The dealer-side audit trail: who did what, inside one workspace.
 *
 * The platform console has had its own log since it existed, because platform
 * staff act on customers. This is the same idea one level down — a dealer's
 * own administrators approving leave, overriding a punch, running payroll or
 * changing a salary. CLAUDE.md has promised "every admin action logged with
 * userId, action, timestamp, IP" from the start; until now the table existed
 * and nothing wrote to it.
 *
 * Rows are tenant-owned, so reading them is scoped by the same extension that
 * scopes everything else (context/tenant-scope.ts) — one dealer can never read
 * another's trail, and the read endpoint needs no filter of its own.
 *
 * Two rules govern what goes in:
 *
 * 1. Record what happened, after it happened. Every call site sits after the
 *    write it describes, so a rejected or failed action leaves no row claiming
 *    it succeeded.
 * 2. Never record a credential. Metadata is written by hand at each call site
 *    rather than by spreading the request body, precisely so a password cannot
 *    arrive here by being added to a form later. `redactedMetadata` is the
 *    backstop if that rule is ever broken by accident.
 */
import type { FastifyRequest } from 'fastify';
import { requireTenantId } from '../../context/tenant-context.js';

/**
 * Every action the dealer-side log can record.
 *
 * A closed union rather than free strings: the reader groups and filters by
 * these, and a typo would silently create a category of one that nobody
 * notices. Adding a case here and to `web/src/lib/activity-labels.ts` is what
 * it takes to log something new.
 */
export type AuditAction =
  // People
  | 'EMPLOYEE_CREATED'
  | 'EMPLOYEE_UPDATED'
  | 'EMPLOYEE_DEACTIVATED'
  | 'EMPLOYEE_PASSWORD_RESET'
  | 'EMPLOYEE_IMPORTED'
  | 'EMPLOYEE_FACE_ENROLLED'
  | 'EMPLOYEE_FACE_DELETED'
  // Admin accounts
  | 'ADMIN_CREATED'
  | 'ADMIN_UPDATED'
  // Attendance
  | 'ATTENDANCE_APPROVED'
  | 'ATTENDANCE_REJECTED'
  | 'ATTENDANCE_MANUAL_PUNCH'
  // Leave
  | 'LEAVE_APPROVED'
  | 'LEAVE_REJECTED'
  | 'LEAVE_BALANCE_UPDATED'
  // Money
  | 'PAYROLL_RUN'
  | 'CLAIM_APPROVED'
  | 'CLAIM_REJECTED'
  | 'CLAIM_CLARIFICATION_REQUESTED'
  | 'CLAIM_PAID'
  // Configuration
  | 'GEOFENCE_UPDATED'
  | 'SHIFT_CREATED'
  | 'SHIFT_UPDATED'
  | 'SHIFT_DELETED'
  | 'SHIFT_ASSIGNED'
  | 'COMPANY_UPDATED'
  | 'BRANCH_CREATED'
  | 'BRANCH_UPDATED'
  | 'BRANCH_DELETED'
  | 'DEPARTMENT_CREATED'
  | 'DEPARTMENT_UPDATED'
  | 'DEPARTMENT_DELETED'
  | 'DESIGNATION_CREATED'
  | 'DESIGNATION_UPDATED'
  | 'DESIGNATION_DELETED';

/** The kind of thing acted on. Used to filter the log by area. */
export type AuditEntity =
  | 'Employee'
  | 'AdminUser'
  | 'Attendance'
  | 'Leave'
  | 'Payroll'
  | 'Claim'
  | 'Branch'
  | 'Shift'
  | 'Department'
  | 'Designation'
  | 'Company';

interface AuditDetail {
  /** The row acted on, where there is a single one. */
  entityId?: string | null;
  /**
   * Anything that makes the line readable a year later — a name, a month, the
   * old and new value of what changed. Written by hand; see the header.
   */
  metadata?: Record<string, unknown>;
}

/**
 * Field names that must never reach the log, whatever a call site passes.
 *
 * The call sites do not spread request bodies, so nothing should ever match.
 * This exists because "should" is not a control: one future call site that
 * spreads a form containing `password` would otherwise write credentials into
 * a table built to be read by people.
 */
const NEVER_LOG = /^(password|passwordHash|newPassword|token|secret|otp|pin)$/i;

/**
 * One `{ field: { from, to } }` entry, or nothing when the value did not move.
 *
 * Recording only what actually changed keeps a line about a single demotion,
 * or a single salary revision, from being buried in the four fields that were
 * resubmitted unchanged — an edit form sends the whole row whether or not the
 * user touched a given input.
 */
export function changed<T>(field: string, from: T, to: T): Record<string, { from: T; to: T }> {
  return Object.is(from, to) ? {} : { [field]: { from, to } };
}

export function redactedMetadata(metadata: Record<string, unknown>): Record<string, unknown> {
  const safe: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(metadata)) {
    safe[key] = NEVER_LOG.test(key) ? '[redacted]' : value;
  }
  return safe;
}

/**
 * Record one administrative action.
 *
 * Failure to write is logged and swallowed, matching the platform helper: the
 * approval the administrator just made is real, and throwing here would undo a
 * completed action to protect a description of it. The tradeoff is deliberate
 * and worth naming — it means the log is best-effort, not a guarantee, so it
 * belongs in an investigation rather than in a control that must not be
 * bypassed.
 *
 * Employee self-service — applying for leave, submitting a claim, checking in —
 * is not recorded: `AuditLog.adminId` is a foreign key to AdminUser, and the
 * trail answers "which administrator did this", not "what happened today".
 */
export async function recordAudit(
  req: FastifyRequest,
  action: AuditAction,
  entity: AuditEntity,
  detail: AuditDetail = {},
): Promise<void> {
  try {
    const actor = req.user;
    if (!actor?.sub || actor.role === 'EMPLOYEE') {
      // Nothing to hang the row on. An employee acting on their own record is
      // not an administrative action, and the FK would reject the write.
      return;
    }

    await req.server.prisma.auditLog.create({
      data: {
        tenantId: requireTenantId(),
        adminId: actor.sub,
        action,
        entity,
        entityId: detail.entityId ?? null,
        metadata: detail.metadata ? JSON.stringify(redactedMetadata(detail.metadata)) : null,
        ipAddress: req.ip,
      },
    });
  } catch (err) {
    req.log.error({ err, action, entity }, 'failed to write audit log');
  }
}
