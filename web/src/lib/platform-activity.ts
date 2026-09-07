/**
 * Reading the platform activity log.
 *
 * The server stores what happened as a constant and a blob of JSON, because
 * that is what survives a rename and what a test can assert on. Turning that
 * into English is this file's job, and it is one file so the activity page and
 * a dealer's own history can never describe the same event differently.
 */
import { DEALER_ROLES, type AuditEntry } from './platform-api';

const ROLE_LABEL = Object.fromEntries(DEALER_ROLES.map((r) => [r.value, r.label]));

/**
 * What the entry is about, for choosing an icon.
 *
 * Deliberately coarse: readers scan this column for "was a credential touched"
 * and "did a dealer's status change", not for a distinct picture per action.
 */
export type ActivityKind = 'dealer' | 'access' | 'credential' | 'other';

/**
 * Whether something was granted or taken away. Suspending a dealer and
 * deactivating an administrator are the entries someone comes to this page
 * looking for, so they are the ones that carry colour.
 */
export type ActivityTone = 'grant' | 'revoke' | 'neutral';

export interface DescribedActivity {
  /** Past tense, no actor and no dealer name — the row supplies both. */
  title: string;
  /** The specifics: an email, a role, a rename. Empty when there are none. */
  detail: string;
  kind: ActivityKind;
  tone: ActivityTone;
  /** Actions on a dealer, versus actions on the console's own team. */
  scope: 'dealer' | 'platform';
}

interface Shape {
  title: string;
  kind: ActivityKind;
  tone: ActivityTone;
  detail?: (m: Record<string, unknown>) => string;
}

const text = (v: unknown): string => (typeof v === 'string' || typeof v === 'number' ? String(v) : '');
const join = (...parts: string[]): string => parts.filter(Boolean).join(' · ');

const SHAPES: Record<string, Shape> = {
  TENANT_CREATED: {
    title: 'Dealer onboarded',
    kind: 'dealer',
    tone: 'grant',
    detail: (m) => join(text(m.slug), text(m.adminEmail) && `first login ${text(m.adminEmail)}`),
  },
  TENANT_RENAMED: {
    title: 'Dealer renamed',
    kind: 'dealer',
    tone: 'neutral',
    detail: (m) => (m.from && m.to ? `${text(m.from)} → ${text(m.to)}` : ''),
  },
  TENANT_SUSPENDED: {
    title: 'Dealer suspended',
    kind: 'dealer',
    tone: 'revoke',
    detail: () => 'everyone signed out, sign-in blocked',
  },
  TENANT_RESUMED: {
    title: 'Dealer resumed',
    kind: 'dealer',
    tone: 'grant',
    detail: () => 'sign-in restored',
  },
  TENANT_ADMIN_CREATED: {
    title: 'Dealer login issued',
    kind: 'access',
    tone: 'grant',
    detail: (m) => join(text(m.email), ROLE_LABEL[text(m.role)] ?? text(m.role)),
  },
  PLATFORM_USER_CREATED: {
    title: 'Console administrator added',
    kind: 'access',
    tone: 'grant',
    detail: (m) => text(m.email),
  },
  PLATFORM_USER_DEACTIVATED: {
    title: 'Console administrator deactivated',
    kind: 'access',
    tone: 'revoke',
    detail: (m) => text(m.email),
  },
  PLATFORM_USER_REACTIVATED: {
    title: 'Console administrator reactivated',
    kind: 'access',
    tone: 'grant',
    detail: (m) => text(m.email),
  },
  PLATFORM_USER_PASSWORD_RESET: {
    title: 'Console password reset',
    kind: 'credential',
    tone: 'revoke',
    detail: (m) => join(text(m.email), 'their old password stopped working'),
  },
  PLATFORM_PASSWORD_CHANGED: {
    title: 'Changed their own password',
    kind: 'credential',
    tone: 'neutral',
  },
};

/**
 * "TENANT_ADMIN_CREATED" → "Admin created".
 *
 * Only reached by an action this build has never heard of — a server deployed
 * ahead of the console. Showing a readable guess beats showing a constant, and
 * beats hiding the entry, which would make the log look like it missed one.
 */
function fallbackTitle(action: string): string {
  const words = action.replace(/^(TENANT|PLATFORM)_/, '').replace(/_/g, ' ').toLowerCase();
  return words.charAt(0).toUpperCase() + words.slice(1);
}

/** Metadata is JSON; show its values, never its field names. */
function fallbackDetail(metadata: Record<string, unknown>): string {
  return join(...Object.values(metadata).map(text));
}

export function describeActivity(entry: Pick<AuditEntry, 'action' | 'metadata'>): DescribedActivity {
  let metadata: Record<string, unknown> = {};
  try {
    if (entry.metadata) metadata = JSON.parse(entry.metadata) as Record<string, unknown>;
  } catch {
    // A row we cannot parse still happened; it renders without its specifics.
  }

  const shape = SHAPES[entry.action];
  const scope = entry.action.startsWith('TENANT_') ? 'dealer' : 'platform';

  if (!shape) {
    return {
      title: fallbackTitle(entry.action),
      detail: fallbackDetail(metadata),
      kind: 'other',
      tone: 'neutral',
      scope,
    };
  }

  return {
    title: shape.title,
    detail: shape.detail?.(metadata) ?? '',
    kind: shape.kind,
    tone: shape.tone,
    scope,
  };
}

/** The label for an action in the filter dropdown. */
export function actionLabel(action: string): string {
  return SHAPES[action]?.title ?? fallbackTitle(action);
}

// ── Time, as a person reads it ──

const DAY_FORMAT: Intl.DateTimeFormatOptions = { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' };

/** "Today" / "Yesterday" / "Wed, 3 Sep 2026" — the heading a run of entries sits under. */
export function dayHeading(iso: string): string {
  const at = new Date(iso);
  const midnight = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
  const days = Math.round((midnight(new Date()) - midnight(at)) / 86_400_000);
  if (days === 0) return 'Today';
  if (days === 1) return 'Yesterday';
  return at.toLocaleDateString('en-IN', DAY_FORMAT);
}

/** A short "how long ago", for the right-hand column. Exact time goes in the tooltip. */
export function relativeTime(iso: string): string {
  const seconds = Math.round((Date.now() - new Date(iso).getTime()) / 1000);
  if (seconds < 60) return 'just now';
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.round(hours / 24);
  if (days < 30) return `${days}d ago`;
  return new Date(iso).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' });
}

/** The full timestamp, for a tooltip or a detail line. */
export function exactTime(iso: string): string {
  return new Date(iso).toLocaleString('en-IN', {
    day: 'numeric', month: 'short', year: 'numeric', hour: 'numeric', minute: '2-digit',
  });
}
