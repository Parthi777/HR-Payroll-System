/** Typed fetch wrapper for the backend API. */
import { clearSession, tenantSlug } from './tenant';

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3001/api';

/**
 * Headers every request carries.
 *
 * One API host serves every dealer, so the workspace travels in a header rather
 * than the URL. Omitted when unknown — the backend resolves the only tenant in
 * a single-dealer deployment, which is what keeps this working before
 * subdomains are configured.
 */
function sessionHeaders(): Record<string, string> {
  if (typeof window === 'undefined') return {};
  const headers: Record<string, string> = {};
  const token = localStorage.getItem('token');
  if (token) headers.Authorization = `Bearer ${token}`;
  const slug = tenantSlug();
  if (slug) headers['X-Tenant-Slug'] = slug;
  return headers;
}

export class ApiError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}

/**
 * A dealer session the server no longer accepts — expired, disabled, or from
 * before two-step verification was required. Inside Master Control that means
 * signing in again, not a screen full of errors. Not on the sign-in page itself
 * (a wrong password or code is a 401 too), the console or the kiosk, which have
 * sessions of their own.
 */
function endRejectedSession(status: number): void {
  if (status !== 401 || typeof window === 'undefined' || !localStorage.getItem('token')) return;
  if (/^\/(login|platform|kiosk)(\/|$)/.test(window.location.pathname)) return;
  clearSession();
  window.location.assign('/login');
}

export async function api<T>(path: string, options: RequestInit = {}): Promise<T> {
  const res = await fetch(`${API_URL}${path}`, {
    ...options,
    headers: {
      // Only claim JSON when we actually send a body — Fastify rejects
      // an empty body with a JSON content-type (e.g. bodyless PATCH).
      ...(options.body != null ? { 'Content-Type': 'application/json' } : {}),
      ...sessionHeaders(),
      ...options.headers,
    },
  });

  if (!res.ok) {
    endRejectedSession(res.status);
    const body = await res.json().catch(() => ({}));
    throw new ApiError(res.status, body.message ?? res.statusText);
  }

  return res.json() as Promise<T>;
}

/** Multipart upload (e.g. face enrollment). Lets the browser set the boundary. */
export async function apiUpload<T>(path: string, formData: FormData): Promise<T> {
  const res = await fetch(`${API_URL}${path}`, {
    method: 'POST',
    headers: sessionHeaders(),
    body: formData,
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new ApiError(res.status, body.message ?? res.statusText);
  }
  return res.json() as Promise<T>;
}

/** Fetch a file (with auth) and trigger a browser download. */
export async function apiDownload(path: string, filename: string): Promise<void> {
  const res = await fetch(`${API_URL}${path}`, { headers: sessionHeaders() });
  if (!res.ok) throw new ApiError(res.status, res.statusText);
  const blob = await res.blob();
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

/** Fetch a file (with auth) and return an object URL for inline viewing / opening in a tab. */
export async function apiBlobUrl(path: string): Promise<string> {
  const res = await fetch(`${API_URL}${path}`, { headers: sessionHeaders() });
  if (!res.ok) throw new ApiError(res.status, res.statusText);
  return URL.createObjectURL(await res.blob());
}

/** SWR fetcher. */
export const fetcher = <T>(path: string) => api<T>(path);
