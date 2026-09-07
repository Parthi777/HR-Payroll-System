/**
 * Reading a dealer's own activity log.
 *
 * The server stores what happened as a constant and a blob of JSON, because
 * that is what survives a rename and what a test can assert on. Turning that
 * into English is this file's job — the same split as the platform console's
 * `platform-activity.ts`, one level down.
 *
 * Time formatting is imported from there rather than copied: "Today" and "3h
 * ago" must read identically on both surfaces, and two copies would drift.
 */
export { dayHeading, relativeTime, exactTime } from './platform-activity';

/**
 * What an entry is about, for choosing an icon.
 *
 * Coarse on purpose: someone scanning this page is asking "was money touched",
 * "did someone's access change", not looking for a distinct picture per action.
 */
export type ActivityKind = 'people' | 'access' | 'money' | 'attendance' | 'config' | 'other';

/**
 * Whether the entry gave something or took it away. Pay rises, approvals,
 * deactivations and refusals are what a reader is hunting for, so those are
 * what carry colour.
 */
export type ActivityTone = 'grant' | 'revoke' | 'neutral';

export interface DescribedActivity {
  /** Past tense, with no actor — the row supplies who. */
  title: string;
  /** The specifics: a name, an amount, a before and after. */
  detail: string;
  kind: ActivityKind;
  tone: ActivityTone;
}

interface Shape {
  title: string;
  kind: ActivityKind;
  tone: ActivityTone;
  detail?: (m: Record<string, unknown>) => string;
}

const text = (v: unknown): string => (typeof v === 'string' || typeof v === 'number' ? String(v) : '');
const join = (...parts: string[]): string => parts.filter(Boolean).join(' · ');

/** "Ravi Kumar (EMP007)", or whichever half exists. */
const who = (m: Record<string, unknown>): string => {
  const name = text(m.employee) || text(m.name);
  const code = text(m.employeeCode);
  return code && name ? `${name} (${code})` : name || code;
};

const money = (v: unknown): string =>
  typeof v === 'number' ? `₹${v.toLocaleString('en-IN')}` : text(v);

/** A recorded `{ from, to }` pair, rendered as an arrow. */
function move(value: unknown, format: (v: unknown) => string = text): string {
  if (!value || typeof value !== 'object') return '';
  const pair = value as { from?: unknown; to?: unknown };
  if (pair.from === undefined || pair.to === undefined) return '';
  return `${format(pair.from)} → ${format(pair.to)}`;
}

const SHAPES: Record<string, Shape> = {
  // People
  EMPLOYEE_CREATED: {
    title: 'Employee added',
    kind: 'people',
    tone: 'grant',
    detail: (m) => join(who(m), m.salary ? `${money(m.salary)}/month` : ''),
  },
  EMPLOYEE_UPDATED: {
    title: 'Employee details changed',
    kind: 'people',
    tone: 'neutral',
    detail: (m) =>
      join(
        who(m),
        move(m.salary, money) && `salary ${move(m.salary, money)}`,
        move(m.status) && `status ${move(m.status)}`,
        m.passwordReset ? 'app password reset' : '',
      ),
  },
  EMPLOYEE_DEACTIVATED: {
    title: 'Employee deactivated',
    kind: 'people',
    tone: 'revoke',
    detail: (m) => join(who(m), 'excluded from reports and payroll'),
  },
  EMPLOYEE_PASSWORD_RESET: {
    title: 'Employee app password reset',
    kind: 'access',
    tone: 'revoke',
    detail: (m) => join(who(m), 'their old password stopped working'),
  },
  EMPLOYEE_IMPORTED: {
    title: 'Employees bulk imported',
    kind: 'people',
    tone: 'grant',
    detail: (m) => join(`${text(m.imported)} added`, Number(m.failed) > 0 ? `${text(m.failed)} rejected` : ''),
  },
  EMPLOYEE_FACE_ENROLLED: {
    title: 'Face enrolled',
    kind: 'access',
    tone: 'grant',
    detail: (m) => join(who(m), m.replacedPrevious ? 'replaced the previous photo' : ''),
  },
  EMPLOYEE_FACE_DELETED: {
    title: 'Face template deleted',
    kind: 'access',
    tone: 'revoke',
    detail: (m) => join(who(m), 'attendance blocked until re-enrolled'),
  },

  // Admin accounts
  ADMIN_CREATED: {
    title: 'Administrator added',
    kind: 'access',
    tone: 'grant',
    detail: (m) => join(text(m.email), text(m.role)),
  },
  ADMIN_UPDATED: {
    title: 'Administrator changed',
    kind: 'access',
    tone: 'neutral',
    detail: (m) =>
      join(
        text(m.account),
        move(m.role) && `role ${move(m.role)}`,
        move(m.active) && (m.active as { to?: unknown }).to === false ? 'disabled' : '',
        m.passwordReset ? 'password reset' : '',
      ),
  },

  // Attendance
  ATTENDANCE_OVERRIDDEN: {
    title: 'Attendance corrected by hand',
    kind: 'attendance',
    tone: 'neutral',
    detail: (m) =>
      join(
        who(m),
        text(m.date),
        move(m.checkIn) && `in ${move(m.checkIn)}`,
        move(m.checkOut) && `out ${move(m.checkOut)}`,
        move(m.status) && `${move(m.status)}`,
        text(m.reason),
      ),
  },
  ATTENDANCE_APPROVED: {
    title: 'Attendance approved',
    kind: 'attendance',
    tone: 'grant',
    detail: (m) => join(who(m), text(m.date), 'the day is paid'),
  },
  ATTENDANCE_REJECTED: {
    title: 'Attendance refused',
    kind: 'attendance',
    tone: 'revoke',
    detail: (m) => join(who(m), text(m.date), text(m.markedAs) && `marked ${text(m.markedAs).toLowerCase()}`),
  },
  ATTENDANCE_MANUAL_PUNCH: {
    title: 'Punch entered by hand',
    kind: 'attendance',
    tone: 'neutral',
    detail: (m) =>
      join(who(m), text(m.date), join(text(m.checkIn), text(m.checkOut)), text(m.reason)),
  },

  // Leave
  LEAVE_APPROVED: {
    title: 'Leave approved',
    kind: 'attendance',
    tone: 'grant',
    detail: (m) => join(who(m), text(m.type), `${text(m.from)}–${text(m.to)}`, `${text(m.days)} day(s)`),
  },
  LEAVE_REJECTED: {
    title: 'Leave rejected',
    kind: 'attendance',
    tone: 'revoke',
    detail: (m) => join(who(m), text(m.type), `${text(m.from)}–${text(m.to)}`, text(m.note)),
  },
  LEAVE_BALANCE_UPDATED: {
    title: 'Leave balance set',
    kind: 'attendance',
    tone: 'grant',
    detail: (m) => join(who(m), `${text(m.type)} ${text(m.total)} days`, text(m.year)),
  },

  // Money
  PAYROLL_RUN: {
    title: 'Payroll run',
    kind: 'money',
    tone: 'neutral',
    detail: (m) => join(`${text(m.month)}/${text(m.year)}`, `${text(m.employees)} employees`, money(m.totalNet)),
  },
  CLAIM_APPROVED: {
    title: 'Claim approved',
    kind: 'money',
    tone: 'grant',
    detail: (m) => join(who(m), text(m.title), money(m.amount), text(m.voucherNo) && `voucher ${text(m.voucherNo)}`),
  },
  CLAIM_REJECTED: {
    title: 'Claim rejected',
    kind: 'money',
    tone: 'revoke',
    detail: (m) => join(text(m.title), money(m.amount), text(m.note)),
  },
  CLAIM_CLARIFICATION_REQUESTED: {
    title: 'Claim sent back for clarification',
    kind: 'money',
    tone: 'neutral',
    detail: (m) => join(text(m.title), money(m.amount), text(m.note)),
  },
  CLAIM_PAID: {
    title: 'Claim paid out',
    kind: 'money',
    tone: 'grant',
    detail: (m) => join(text(m.title), money(m.amount), text(m.voucherNo) && `voucher ${text(m.voucherNo)}`),
  },

  // Configuration
  GEOFENCE_UPDATED: {
    title: 'Geofence changed',
    kind: 'config',
    tone: 'neutral',
    detail: (m) =>
      join(
        text(m.branch),
        move(m.radiusMetres, (v) => `${text(v)}m`) && `radius ${move(m.radiusMetres, (v) => `${text(v)}m`)}`,
        move(m.strictMode) ? 'strict mode changed' : '',
        m.lat || m.lng ? 'centre moved' : '',
      ),
  },
  COMPANY_UPDATED: { title: 'Company settings changed', kind: 'config', tone: 'neutral' },
  SHIFT_CREATED: {
    title: 'Shift created',
    kind: 'config',
    tone: 'neutral',
    detail: (m) => join(text(m.name), text(m.hours)),
  },
  SHIFT_UPDATED: { title: 'Shift changed', kind: 'config', tone: 'neutral', detail: (m) => text(m.name) },
  SHIFT_DELETED: { title: 'Shift deleted', kind: 'config', tone: 'revoke', detail: (m) => text(m.name) },
  SHIFT_ASSIGNED: {
    title: 'Shift assigned',
    kind: 'config',
    tone: 'neutral',
    detail: (m) => join(text(m.shift), `${text(m.employeeCount)} employee(s)`),
  },
  BRANCH_CREATED: { title: 'Branch added', kind: 'config', tone: 'grant', detail: (m) => text(m.name) },
  BRANCH_UPDATED: { title: 'Branch changed', kind: 'config', tone: 'neutral', detail: (m) => text(m.name) },
  BRANCH_DELETED: { title: 'Branch deleted', kind: 'config', tone: 'revoke', detail: (m) => text(m.name) },
  DEPARTMENT_CREATED: { title: 'Department added', kind: 'config', tone: 'grant', detail: (m) => text(m.name) },
  DEPARTMENT_UPDATED: {
    title: 'Department renamed',
    kind: 'config',
    tone: 'neutral',
    detail: (m) => (m.renamedFrom ? `${text(m.renamedFrom)} → ${text(m.name)}` : text(m.name)),
  },
  DEPARTMENT_DELETED: { title: 'Department deleted', kind: 'config', tone: 'revoke', detail: (m) => text(m.name) },
  DESIGNATION_CREATED: { title: 'Designation added', kind: 'config', tone: 'grant', detail: (m) => text(m.name) },
  DESIGNATION_UPDATED: {
    title: 'Designation renamed',
    kind: 'config',
    tone: 'neutral',
    detail: (m) => (m.renamedFrom ? `${text(m.renamedFrom)} → ${text(m.name)}` : text(m.name)),
  },
  DESIGNATION_DELETED: { title: 'Designation deleted', kind: 'config', tone: 'revoke', detail: (m) => text(m.name) },
};

/**
 * "EMPLOYEE_FACE_ENROLLED" → "Employee face enrolled".
 *
 * Only reached by an action this build has never heard of — a server deployed
 * ahead of the console. A readable guess beats showing a constant, and beats
 * hiding the row, which would make the log look like it missed one.
 */
function fallbackTitle(action: string): string {
  const words = action.replace(/_/g, ' ').toLowerCase();
  return words.charAt(0).toUpperCase() + words.slice(1);
}

/** Metadata is JSON; show its values, never its field names. */
function fallbackDetail(metadata: Record<string, unknown>): string {
  return join(...Object.values(metadata).map(text));
}

export function describeActivity(entry: { action: string; metadata: string | null }): DescribedActivity {
  let metadata: Record<string, unknown> = {};
  try {
    if (entry.metadata) metadata = JSON.parse(entry.metadata) as Record<string, unknown>;
  } catch {
    // A row we cannot parse still happened; it renders without its specifics.
  }

  const shape = SHAPES[entry.action];
  if (!shape) {
    return { title: fallbackTitle(entry.action), detail: fallbackDetail(metadata), kind: 'other', tone: 'neutral' };
  }
  return {
    title: shape.title,
    detail: shape.detail?.(metadata) ?? '',
    kind: shape.kind,
    tone: shape.tone,
  };
}

/** The label for an action in the filter dropdown. */
export function actionLabel(action: string): string {
  return SHAPES[action]?.title ?? fallbackTitle(action);
}

/** The label for an entity in the filter dropdown. */
export function entityLabel(entity: string): string {
  return entity === 'AdminUser' ? 'Administrator' : entity;
}
