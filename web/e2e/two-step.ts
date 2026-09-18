/**
 * Authenticator codes for the browser tests.
 *
 * A second, independent implementation of TOTP rather than an import of the
 * backend's. The backend's is pinned to the RFC's vectors in its own suite;
 * this one only has to agree with it, and two implementations agreeing is what
 * a real authenticator app and the server have to do.
 */
import { execFileSync } from 'node:child_process';
import { createHmac } from 'node:crypto';
import path from 'node:path';
import { E2E_DATABASE_URL } from './config';

const BACKEND = path.resolve(__dirname, '../../backend');
const BASE32 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';

/** The 6-digit code an authenticator app would show right now for this secret. */
export function totp(secret: string, at = Date.now()): string {
  let bits = '';
  for (const char of secret.replace(/\s/g, '').toUpperCase()) {
    bits += BASE32.indexOf(char).toString(2).padStart(5, '0');
  }
  const key = Buffer.from((bits.match(/.{8}/g) ?? []).map((b) => parseInt(b, 2)));

  const counter = Buffer.alloc(8);
  counter.writeBigUInt64BE(BigInt(Math.floor(at / 30_000)));
  const hmac = createHmac('sha1', key).update(counter).digest();
  const offset = hmac[hmac.length - 1] & 0xf;
  return String((hmac.readUInt32BE(offset) & 0x7fffffff) % 1_000_000).padStart(6, '0');
}

/**
 * The current code for an account that has already enrolled.
 *
 * Reads the secret from the database and clears the replay guard. The suite
 * signs the same account in several times a minute — the seed, the shared
 * session, the sign-in tests — which one person with one phone never does, and
 * which the server rightly refuses. The guard has its own backend tests.
 */
export function currentCode(email: string, databaseUrl = E2E_DATABASE_URL): string {
  const secret = execFileSync('psql', [databaseUrl, '-qAt', '-v', `email=${email}`], {
    input: `UPDATE "PlatformUser" SET "totpLastStep" = NULL WHERE email = :'email' RETURNING "totpSecret";`,
  }).toString().trim();
  if (!secret) throw new Error(`${email} has not set up two-step verification`);
  return totp(secret);
}

/** A console account that has never signed in, made the way an operator makes one. */
export function createPlatformAccount(account: { email: string; name: string; password: string }): void {
  execFileSync('npx', [
    'tsx', 'scripts/create-platform-admin.ts',
    '--email', account.email, '--name', account.name, '--password', account.password,
  ], { cwd: BACKEND, stdio: 'pipe', env: { ...process.env, DATABASE_URL: E2E_DATABASE_URL } });
}
