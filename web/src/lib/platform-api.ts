/**
 * Client for the platform API — the surface where dealers are onboarded.
 *
 * Kept separate from `lib/api.ts` on purpose. That client attaches a dealer's
 * token and an `X-Tenant-Slug`; this one must send neither, because platform
 * staff belong to no dealer and the server refuses a platform token on any
 * tenant route (and vice versa). Two clients, two token keys, no way to leak
 * one session into the other.
 */
import { ApiError } from './api';

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3001/api';

const TOKEN_KEY = 'platformToken';
const NAME_KEY = 'platformName';

export function platformToken(): string | null {
  return typeof window === 'undefined' ? null : localStorage.getItem(TOKEN_KEY);
}

export function platformName(): string | null {
  return typeof window === 'undefined' ? null : localStorage.getItem(NAME_KEY);
}

export function savePlatformSession(token: string, name: string): void {
  localStorage.setItem(TOKEN_KEY, token);
  localStorage.setItem(NAME_KEY, name);
}

export function clearPlatformSession(): void {
  localStorage.removeItem(TOKEN_KEY);
  localStorage.removeItem(NAME_KEY);
}

async function request<T>(path: string, options: RequestInit = {}): Promise<T> {
  const token = platformToken();
  const res = await fetch(`${API_URL}/platform${path}`, {
    ...options,
    headers: {
      ...(options.body != null ? { 'Content-Type': 'application/json' } : {}),
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...options.headers,
    },
  });

  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new ApiError(res.status, body.message ?? res.statusText);
  }
  return res.json() as Promise<T>;
}

export const platformApi = {
  get: <T>(path: string) => request<T>(path),
  post: <T>(path: string, body: unknown) =>
    request<T>(path, { method: 'POST', body: JSON.stringify(body) }),
  patch: <T>(path: string, body: unknown) =>
    request<T>(path, { method: 'PATCH', body: JSON.stringify(body) }),
};

// ── Shapes the console renders ──

export interface Dealer {
  id: string;
  slug: string;
  name: string;
  status: 'ACTIVE' | 'SUSPENDED';
  createdAt: string;
  employees: number;
  loginUrl: string;
}

export interface DealerAdmin {
  id: string;
  name: string;
  email: string;
  role: string;
  isActive: boolean;
  createdAt: string;
}

export interface CreatedDealer {
  id: string;
  slug: string;
  name: string;
  status: string;
  adminId: string;
  adminEmail: string;
  loginUrl: string;
}

export interface AuditEntry {
  id: string;
  action: string;
  targetTenantId: string | null;
  metadata: string | null;
  ipAddress: string | null;
  timestamp: string;
}

/**
 * A 16-character password generated in the browser.
 *
 * crypto.getRandomValues, not Math.random: these are real credentials for an
 * account that can see every employee's salary.
 */
export function suggestPassword(): string {
  const bytes = new Uint8Array(12);
  crypto.getRandomValues(bytes);
  return btoa(String.fromCharCode(...bytes)).replace(/[+/=]/g, '').slice(0, 16);
}

/** The roles a dealer's own admin accounts can hold, mirroring the server. */
export const DEALER_ROLES = [
  { value: 'SUPER_ADMIN', label: 'Super Admin', hint: 'Everything, including user access' },
  { value: 'HR_MANAGER', label: 'HR Manager', hint: 'Employees, attendance, leave, payroll' },
  { value: 'BRANCH_MANAGER', label: 'Branch Manager', hint: 'Their own branch and reports' },
  { value: 'PAYROLL_ADMIN', label: 'Payroll Admin', hint: 'Payroll runs and payslips' },
  { value: 'CASHIER', label: 'Cashier', hint: 'Claims and disbursement only' },
] as const;

export interface NewDealerAdmin {
  id: string;
  email: string;
  role: string;
}
