/**
 * Two-step verification for the platform console.
 *
 * The console account creates, suspends and reads across every dealer, so a
 * password alone must never be enough to open it — a reused or phished
 * password would otherwise hand over every customer at once. Sign-in is two
 * requests: the password earns a short-lived challenge, and only the challenge
 * plus a code from the person's authenticator app earns a console session.
 *
 * Enrolment is not optional. An account with no secret yet (every account that
 * existed before this, and every one a colleague creates) is walked through
 * enrolment by its next sign-in instead of being let in without it.
 *
 * Three things stop a code being guessed or reused:
 *   - a code is refused for any 30-second step at or before the last one
 *     accepted, so a code seen over someone's shoulder is already spent;
 *   - five wrong codes lock the second step for fifteen minutes, per account,
 *     because the per-IP rate limit alone does nothing against many addresses;
 *   - recovery codes are stored only as hashes, and each works once.
 */
import { createHash, randomInt } from 'node:crypto';
import type { PrismaClient, PlatformUser } from '@prisma/client';
import { AppError } from '../../utils/AppError.js';
import { generateSecret, matchStep, otpauthUri } from './totp.js';

/** How the account is labelled in the authenticator app. */
export const TWO_STEP_ISSUER = 'HR Payroll Platform';

export type ChallengePurpose = 'verify' | 'enroll';

/**
 * How long each challenge lives. Enrolment gets longer: installing an
 * authenticator app and scanning a code takes a few minutes the first time.
 */
export const CHALLENGE_TTL: Record<ChallengePurpose, string> = { verify: '5m', enroll: '15m' };

const MAX_FAILURES = 5;
const LOCK_MINUTES = 15;
const RECOVERY_CODE_COUNT = 10;

/** No I, L, O, 0 or 1 — these get read off paper and typed back in. */
const RECOVERY_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
const RECOVERY_LENGTH = 10;

function hashRecoveryCode(normalised: string): string {
  return createHash('sha256').update(normalised).digest('hex');
}

/** Upper-cased with separators stripped, or null if it cannot be a recovery code. */
function normaliseRecoveryCode(input: string): string | null {
  const clean = input.toUpperCase().replace(/[\s-]/g, '');
  if (clean.length !== RECOVERY_LENGTH) return null;
  return [...clean].every((c) => RECOVERY_ALPHABET.includes(c)) ? clean : null;
}

/**
 * A fresh set of recovery codes: the plain codes to show once, and the hashes
 * to store. SHA-256 rather than bcrypt is enough here — each code carries about
 * 50 bits of randomness, which no offline search gets through.
 */
export function generateRecoveryCodes(): { codes: string[]; stored: string } {
  const codes: string[] = [];
  for (let n = 0; n < RECOVERY_CODE_COUNT; n++) {
    let raw = '';
    for (let i = 0; i < RECOVERY_LENGTH; i++) raw += RECOVERY_ALPHABET[randomInt(RECOVERY_ALPHABET.length)];
    codes.push(`${raw.slice(0, 5)}-${raw.slice(5)}`);
  }
  return { codes, stored: JSON.stringify(codes.map((c) => hashRecoveryCode(normaliseRecoveryCode(c)!))) };
}

export function recoveryCodesLeft(staff: Pick<PlatformUser, 'recoveryCodes'>): number {
  return staff.recoveryCodes ? (JSON.parse(staff.recoveryCodes) as string[]).length : 0;
}

/** Refuse outright while the account is locked from too many wrong codes. */
export function assertNotLocked(staff: Pick<PlatformUser, 'mfaLockedUntil'>, now = new Date()): void {
  if (staff.mfaLockedUntil && staff.mfaLockedUntil > now) {
    const minutes = Math.ceil((staff.mfaLockedUntil.getTime() - now.getTime()) / 60_000);
    throw new AppError(
      `Too many wrong codes. Try again in ${minutes} minute${minutes === 1 ? '' : 's'}.`,
      429,
    );
  }
}

/**
 * Count a wrong code and lock the account once the count reaches the limit.
 * Returns whether this failure is the one that locked it, so the caller can
 * record the lock in the activity log.
 */
export async function recordFailure(prisma: PrismaClient, staff: Pick<PlatformUser, 'id'>): Promise<{ locked: boolean }> {
  const updated = await prisma.platformUser.update({
    where: { id: staff.id },
    data: { mfaFailures: { increment: 1 } },
    select: { mfaFailures: true },
  });
  if (updated.mfaFailures < MAX_FAILURES) return { locked: false };

  await prisma.platformUser.update({
    where: { id: staff.id },
    data: { mfaFailures: 0, mfaLockedUntil: new Date(Date.now() + LOCK_MINUTES * 60_000) },
  });
  return { locked: true };
}

/**
 * Accept a code from the authenticator app, at most once per step.
 *
 * The step is claimed with a conditional update rather than read-then-write, so
 * two requests racing with the same code cannot both succeed.
 */
export async function acceptTotp(
  prisma: PrismaClient,
  staff: Pick<PlatformUser, 'id'>,
  secret: string,
  code: string,
): Promise<boolean> {
  const step = matchStep(secret, code.trim());
  if (step === null) return false;
  const { count } = await prisma.platformUser.updateMany({
    where: { id: staff.id, OR: [{ totpLastStep: null }, { totpLastStep: { lt: step } }] },
    data: { totpLastStep: step, mfaFailures: 0, mfaLockedUntil: null },
  });
  return count === 1;
}

/**
 * Spend one recovery code. Returns how many are left, or null if the code is
 * not one of this account's unused codes.
 *
 * Conditional on the stored list being unchanged, so the same code submitted
 * twice at once is spent once.
 */
export async function consumeRecoveryCode(
  prisma: PrismaClient,
  staff: Pick<PlatformUser, 'id' | 'recoveryCodes'>,
  input: string,
): Promise<number | null> {
  const normalised = normaliseRecoveryCode(input);
  if (!normalised || !staff.recoveryCodes) return null;

  const hashes = JSON.parse(staff.recoveryCodes) as string[];
  const hash = hashRecoveryCode(normalised);
  if (!hashes.includes(hash)) return null;

  const remaining = hashes.filter((h) => h !== hash);
  const { count } = await prisma.platformUser.updateMany({
    where: { id: staff.id, recoveryCodes: staff.recoveryCodes },
    data: { recoveryCodes: JSON.stringify(remaining), mfaFailures: 0, mfaLockedUntil: null },
  });
  return count === 1 ? remaining.length : null;
}

/** Whether a submitted value is shaped like an authenticator code rather than a recovery code. */
export function looksLikeTotp(code: string): boolean {
  return /^\d{6}$/.test(code.trim());
}

/**
 * Begin enrolment: a new secret, held as pending until a code from it is
 * confirmed. Calling this again replaces the pending secret, which is what
 * someone who closed the page half way through needs.
 */
export async function startEnrolment(
  prisma: PrismaClient,
  staff: Pick<PlatformUser, 'id' | 'email' | 'totpSecret'>,
): Promise<{ secret: string; otpauthUri: string }> {
  if (staff.totpSecret) throw new AppError('Two-step verification is already set up — sign in again', 409);
  const secret = generateSecret();
  await prisma.platformUser.update({ where: { id: staff.id }, data: { totpPendingSecret: secret } });
  return { secret, otpauthUri: otpauthUri(secret, staff.email, TWO_STEP_ISSUER) };
}

/**
 * Finish enrolment with a code generated from the pending secret. Returns the
 * recovery codes to show once, or null if the code was wrong.
 *
 * The code's step is recorded as used, so the code that confirmed enrolment
 * cannot then also be used to sign in.
 */
export async function completeEnrolment(
  prisma: PrismaClient,
  staff: Pick<PlatformUser, 'id' | 'totpSecret' | 'totpPendingSecret'>,
  code: string,
): Promise<string[] | null> {
  if (staff.totpSecret) throw new AppError('Two-step verification is already set up — sign in again', 409);
  const pending = staff.totpPendingSecret;
  if (!pending) throw new AppError('Start setting up two-step verification first', 400);

  const step = matchStep(pending, code.trim());
  if (step === null) return null;

  const { codes, stored } = generateRecoveryCodes();
  const { count } = await prisma.platformUser.updateMany({
    where: { id: staff.id, totpSecret: null, totpPendingSecret: pending },
    data: {
      totpSecret: pending,
      totpPendingSecret: null,
      totpEnabledAt: new Date(),
      totpLastStep: step,
      recoveryCodes: stored,
      mfaFailures: 0,
      mfaLockedUntil: null,
    },
  });
  if (count !== 1) throw new AppError('Two-step verification changed while you were setting it up — sign in again', 409);
  return codes;
}

/** Everything that makes up an account's second step, cleared. */
export const TWO_STEP_CLEARED = {
  totpSecret: null,
  totpPendingSecret: null,
  totpEnabledAt: null,
  totpLastStep: null,
  recoveryCodes: null,
  mfaFailures: 0,
  mfaLockedUntil: null,
} as const;
