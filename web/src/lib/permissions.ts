/**
 * Which roles may see which screens.
 *
 * This is **presentation only**. Every route it guards is enforced again on the
 * server by `requireRole(...)`, and that is what actually protects the data — a
 * browser can always call the API directly. The value here is that a cashier is
 * not shown a Payroll tab that will only 403 at them.
 *
 * The lists mirror the backend guards; when one changes, change both.
 */

export type AdminRole =
  | 'SUPER_ADMIN'
  | 'HR_MANAGER'
  | 'BRANCH_MANAGER'
  | 'PAYROLL_ADMIN'
  | 'CASHIER';

export const ALL_ROLES: AdminRole[] = [
  'SUPER_ADMIN',
  'HR_MANAGER',
  'BRANCH_MANAGER',
  'PAYROLL_ADMIN',
  'CASHIER',
];

/** Route → roles allowed to open it, matching the backend's route guards. */
export const ROUTE_ROLES: Record<string, AdminRole[]> = {
  '/dashboard': ['SUPER_ADMIN', 'HR_MANAGER', 'BRANCH_MANAGER', 'CASHIER'],
  '/attendance': ['SUPER_ADMIN', 'HR_MANAGER', 'BRANCH_MANAGER'],
  '/employees': ['SUPER_ADMIN', 'HR_MANAGER', 'BRANCH_MANAGER'],
  '/geofence': ['SUPER_ADMIN', 'HR_MANAGER', 'BRANCH_MANAGER'],
  '/shifts': ['SUPER_ADMIN', 'HR_MANAGER'],
  '/leaves': ['SUPER_ADMIN', 'HR_MANAGER', 'BRANCH_MANAGER'],
  '/claims': ALL_ROLES, // the cashier's main screen
  '/payroll': ['SUPER_ADMIN', 'PAYROLL_ADMIN', 'HR_MANAGER'],
  '/whatsapp': ['SUPER_ADMIN', 'HR_MANAGER'],
  '/reports': ['SUPER_ADMIN', 'HR_MANAGER', 'BRANCH_MANAGER', 'PAYROLL_ADMIN'],
  '/access': ['SUPER_ADMIN'],
  '/settings': ['SUPER_ADMIN', 'HR_MANAGER', 'BRANCH_MANAGER'],
};

/** Claims actions, mirroring approveGuard / payGuard on the server. */
export const APPROVE_ROLES: AdminRole[] = ['SUPER_ADMIN', 'HR_MANAGER', 'BRANCH_MANAGER', 'PAYROLL_ADMIN'];
export const PAY_ROLES: AdminRole[] = ['SUPER_ADMIN', 'PAYROLL_ADMIN', 'CASHIER'];

/** The signed-in role, or null when it is unknown. */
export function currentRole(): AdminRole | null {
  if (typeof window === 'undefined') return null;
  const role = localStorage.getItem('adminRole');
  return role && (ALL_ROLES as string[]).includes(role) ? (role as AdminRole) : null;
}

/**
 * Whether the signed-in role may open a path.
 *
 * An unknown role is refused, not allowed. The previous checks read
 * `!role || ROLES.includes(role)`, which failed *open* — clearing the stored
 * role, or arriving with it unset, silently unlocked every action.
 */
export function canAccess(path: string, role: AdminRole | null = currentRole()): boolean {
  const allowed = ROUTE_ROLES[routeKey(path)];
  if (!allowed) return true; // not a gated screen
  return role !== null && allowed.includes(role);
}

export function can(roles: AdminRole[], role: AdminRole | null = currentRole()): boolean {
  return role !== null && roles.includes(role);
}

/** "/employees/123" → "/employees", so sub-paths inherit the parent's rule. */
function routeKey(path: string): string {
  const first = path.split('?')[0].split('/')[1];
  return first ? `/${first}` : path;
}

/** The first screen this role is allowed to see, for redirects after login. */
export function landingFor(role: AdminRole | null): string {
  if (!role) return '/login';
  const order = ['/dashboard', '/claims', '/attendance', '/reports', '/payroll'];
  return order.find((p) => canAccess(p, role)) ?? '/claims';
}
