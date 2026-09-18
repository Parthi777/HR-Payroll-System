/**
 * Razorpay, in the two places it is actually needed: creating an order, and
 * proving that a payment really happened.
 *
 * Written against the REST API with fetch rather than the SDK — this is two
 * calls and two HMACs, and a payment dependency is a supply-chain risk on the
 * one path that moves money.
 *
 * Unconfigured (no RAZORPAY_KEY_ID / RAZORPAY_KEY_SECRET) every function here
 * reports "not configured" rather than throwing, and the flow falls back to a
 * payment the platform records by hand. That is what makes the whole signup
 * path testable, and usable, before a gateway account exists.
 */
import { createHmac, timingSafeEqual } from 'node:crypto';
import { env } from '../../config/env.js';
import { AppError } from '../../utils/AppError.js';

const API = 'https://api.razorpay.com/v1';

export function razorpayConfigured(): boolean {
  return Boolean(env.RAZORPAY_KEY_ID && env.RAZORPAY_KEY_SECRET);
}

/** The key id is public — it goes into the checkout script in the browser. */
export function razorpayKeyId(): string | null {
  return env.RAZORPAY_KEY_ID ?? null;
}

function authHeader(): string {
  return `Basic ${Buffer.from(`${env.RAZORPAY_KEY_ID}:${env.RAZORPAY_KEY_SECRET}`).toString('base64')}`;
}

export interface RazorpayOrder {
  id: string;
  amount: number;
  currency: string;
  status: string;
}

/**
 * Create an order for an exact amount in paise.
 *
 * `receipt` is our own reference, which is what ties a payment in the Razorpay
 * dashboard back to a workspace without having to trust anything the browser
 * sent.
 */
export async function createOrder(amountPaise: number, receipt: string, notes: Record<string, string>): Promise<RazorpayOrder> {
  if (!razorpayConfigured()) throw new AppError('Online payment is not configured', 503);

  const res = await fetch(`${API}/orders`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: authHeader() },
    body: JSON.stringify({ amount: amountPaise, currency: 'INR', receipt, notes, payment_capture: 1 }),
  });
  if (!res.ok) {
    const detail = await res.text();
    throw new AppError(`Razorpay refused the order (${res.status}): ${detail.slice(0, 200)}`, 502);
  }
  return (await res.json()) as RazorpayOrder;
}

/** Constant-time compare of two hex digests of the same length. */
function sameDigest(a: string, b: string): boolean {
  const left = Buffer.from(a, 'utf8');
  const right = Buffer.from(b, 'utf8');
  return left.length === right.length && timingSafeEqual(left, right);
}

/**
 * The signature Razorpay's checkout hands back in the browser.
 *
 * HMAC-SHA256 of "<order_id>|<payment_id>" with the key secret. Verifying it
 * server-side is what stops a page simply claiming it paid.
 */
export function verifyCheckoutSignature(orderId: string, paymentId: string, signature: string): boolean {
  if (!env.RAZORPAY_KEY_SECRET) return false;
  const expected = createHmac('sha256', env.RAZORPAY_KEY_SECRET).update(`${orderId}|${paymentId}`).digest('hex');
  return sameDigest(expected, signature);
}

/**
 * The signature on a webhook: HMAC-SHA256 of the raw body with the webhook
 * secret, which is a different secret from the key secret.
 *
 * With no secret set this returns false rather than true — an endpoint that
 * cannot tell Razorpay from anyone else must refuse everything, not accept it.
 */
export function verifyWebhookSignature(rawBody: Buffer | string, signature: string | undefined): boolean {
  if (!env.RAZORPAY_WEBHOOK_SECRET || !signature) return false;
  const expected = createHmac('sha256', env.RAZORPAY_WEBHOOK_SECRET).update(rawBody).digest('hex');
  return sameDigest(expected, signature);
}
