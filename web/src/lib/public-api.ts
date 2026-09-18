/**
 * The public API client: plans, signup and the payment page.
 *
 * Deliberately not `lib/api.ts`. That one attaches a dealer's session token and
 * workspace header, and none of these routes want either — the people using
 * them do not have an account yet. Nothing here sends a credential.
 */
import { ApiError } from './api';

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3001/api';

async function request<T>(path: string, options: RequestInit = {}): Promise<T> {
  const res = await fetch(`${API_URL}/public${path}`, {
    ...options,
    headers: {
      ...(options.body != null ? { 'Content-Type': 'application/json' } : {}),
      ...options.headers,
    },
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new ApiError(res.status, body.message ?? res.statusText);
  }
  return res.json() as Promise<T>;
}

export const publicApi = {
  get: <T>(path: string) => request<T>(path),
  post: <T>(path: string, body?: unknown) =>
    request<T>(path, { method: 'POST', ...(body === undefined ? {} : { body: JSON.stringify(body) }) }),
};

export interface SignupAccepted {
  reference: string;
  companyName: string;
}

export interface SubscriptionView {
  company: string;
  planCode: string;
  planName: string;
  amountPaise: number;
  status: 'PENDING_PAYMENT' | 'ACTIVE' | 'PAST_DUE' | 'CANCELLED';
  paidAt: string | null;
  periodEnd: string | null;
  workspaceSlug: string;
  /** Whether a card payment can be taken at all, or the platform confirms by hand. */
  onlinePayment: boolean;
  keyId: string | null;
}

export interface RazorpayOrder {
  orderId: string;
  amountPaise: number;
  keyId: string | null;
}

/** "bhavani motors & co" → "bhavani-motors-co", the shape a subdomain has to be. */
export function slugify(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 31);
}

export const WORKSPACE_ADDRESS = /^[a-z0-9][a-z0-9-]{1,30}$/;
