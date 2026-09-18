/**
 * Time-based one-time passwords (RFC 6238) — what an authenticator app shows.
 *
 * Written against node:crypto rather than pulled in as a dependency: the whole
 * algorithm is an HMAC and a truncation, and this is the one piece of the
 * console's sign-in where knowing exactly what runs matters more than saving
 * forty lines. `tests/totp.test.ts` checks it against the RFC's own vectors.
 *
 * Parameters are the ones every authenticator app assumes when a QR code does
 * not say otherwise: SHA-1, 6 digits, 30-second steps.
 */
import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';

const STEP_SECONDS = 30;
const DIGITS = 6;
const BASE32 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';

export function base32Encode(bytes: Buffer): string {
  let bits = 0;
  let value = 0;
  let out = '';
  for (const byte of bytes) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      out += BASE32[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) out += BASE32[(value << (5 - bits)) & 31];
  return out;
}

export function base32Decode(text: string): Buffer {
  const clean = text.replace(/[\s=-]/g, '').toUpperCase();
  let bits = 0;
  let value = 0;
  const out: number[] = [];
  for (const char of clean) {
    const index = BASE32.indexOf(char);
    if (index === -1) throw new Error('Not a base32 secret');
    value = (value << 5) | index;
    bits += 5;
    if (bits >= 8) {
      out.push((value >>> (bits - 8)) & 255);
      bits -= 8;
    }
  }
  return Buffer.from(out);
}

/** A new 160-bit secret, the length RFC 4226 recommends for SHA-1. */
export function generateSecret(): string {
  return base32Encode(randomBytes(20));
}

/** The 30-second step a moment falls in. */
export function stepAt(timeMs: number): number {
  return Math.floor(timeMs / 1000 / STEP_SECONDS);
}

/** The code for one step (HOTP, RFC 4226, with the step as the counter). */
export function codeForStep(secret: string, step: number, digits = DIGITS): string {
  const counter = Buffer.alloc(8);
  counter.writeBigUInt64BE(BigInt(step));
  const hmac = createHmac('sha1', base32Decode(secret)).update(counter).digest();
  const offset = hmac[hmac.length - 1] & 0xf;
  const binary = hmac.readUInt32BE(offset) & 0x7fffffff;
  return String(binary % 10 ** digits).padStart(digits, '0');
}

/**
 * The step a submitted code belongs to, or null if it matches none.
 *
 * Accepts the previous and next step as well as the current one — phone clocks
 * drift, and a code typed in the last second of its window arrives in the next.
 * The caller must still refuse a step it has already accepted; this function
 * has no memory and so cannot stop a replay on its own.
 */
export function matchStep(secret: string, code: string, nowMs = Date.now()): number | null {
  if (!/^\d{6}$/.test(code)) return null;
  const now = stepAt(nowMs);
  let matched: number | null = null;
  // Every candidate is compared, not just until the first hit, so the time
  // taken does not reveal which window a guess fell in.
  for (const step of [now - 1, now, now + 1]) {
    if (timingSafeEqual(Buffer.from(codeForStep(secret, step)), Buffer.from(code))) matched = step;
  }
  return matched;
}

/** The otpauth:// URI an authenticator app reads from a QR code. */
export function otpauthUri(secret: string, account: string, issuer: string): string {
  const label = encodeURIComponent(`${issuer}:${account}`);
  const params = new URLSearchParams({
    secret,
    issuer,
    algorithm: 'SHA1',
    digits: String(DIGITS),
    period: String(STEP_SECONDS),
  });
  return `otpauth://totp/${label}?${params.toString()}`;
}
