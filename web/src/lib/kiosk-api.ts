/**
 * The tablet's own client.
 *
 * Its own token key, kept apart from an admin's and an employee's: a kiosk is a
 * device, not a person, and a tablet left on a desk must never be holding
 * somebody's session. The server refuses this token everywhere except the
 * kiosk routes, so the separation is enforced on both sides.
 */
import { ApiError } from './api';

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3001/api';
const TOKEN_KEY = 'kioskToken';

export function kioskToken(): string | null {
  return typeof window === 'undefined' ? null : localStorage.getItem(TOKEN_KEY);
}

export function saveKioskToken(token: string): void {
  localStorage.setItem(TOKEN_KEY, token);
}

export function forgetKiosk(): void {
  localStorage.removeItem(TOKEN_KEY);
}

async function request<T>(path: string, options: RequestInit = {}): Promise<T> {
  const token = kioskToken();
  const res = await fetch(`${API_URL}/kiosk${path}`, {
    ...options,
    headers: {
      ...(options.body != null && !(options.body instanceof FormData) ? { 'Content-Type': 'application/json' } : {}),
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

export const kioskApi = {
  get: <T>(path: string) => request<T>(path),
  post: <T>(path: string, body?: unknown) =>
    request<T>(path, { method: 'POST', ...(body === undefined ? {} : { body: JSON.stringify(body) }) }),
  upload: <T>(path: string, form: FormData) => request<T>(path, { method: 'POST', body: form }),
};

export interface KioskSession {
  device: { id: string; name: string };
  branch: { id: string; name: string };
  liveness: { enabled: boolean; region: string };
}

export interface PairedKiosk extends KioskSession {
  token: string;
  workspace: { slug: string; name: string };
}

export interface EmployeeLookup {
  employee: { id: string; name: string; code: string };
  nextAction: 'IN' | 'OUT';
  checkedInAt: string | null;
}

export interface LivenessStart {
  sessionId: string;
  credentials: {
    accessKeyId: string;
    secretAccessKey: string;
    sessionToken: string;
    expiration: string;
    region: string;
  };
}

export interface PunchResult {
  action: 'IN' | 'OUT';
  employee: { name: string; code: string };
  branch: string;
  status?: string;
  checkIn?: string;
  checkOut?: string;
  workingMinutes?: number;
  liveness: { confidence: number; status: string } | null;
}
