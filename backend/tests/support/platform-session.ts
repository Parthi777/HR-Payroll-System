/**
 * A platform console session, the way a person gets one: password, then a
 * code from their authenticator — enrolling first if they never have.
 *
 * Not a test file (vitest only collects *.test.ts). Shared because several
 * suites need a platform token only to create the dealer they then test, and a
 * password alone no longer yields one.
 */
import type { FastifyInstance } from 'fastify';
import { expect } from 'vitest';
import { codeForStep, stepAt } from '../../src/services/platform/totp.js';

/**
 * The code for right now, for an account that is already enrolled.
 *
 * Clears the replay guard first. A suite signs the same account in several
 * times inside one 30-second step, which a real person with one phone cannot
 * do and which the guard therefore (correctly) refuses. The guard itself is
 * pinned by its own tests in platform.test.ts, which do not use this.
 */
export async function currentCode(app: FastifyInstance, email: string): Promise<string> {
  const staff = await app.prisma.platformUser.update({
    where: { email },
    data: { totpLastStep: null },
    select: { totpSecret: true },
  });
  if (!staff.totpSecret) throw new Error(`${email} has not enrolled in two-step verification`);
  return codeForStep(staff.totpSecret, stepAt(Date.now()));
}

export async function platformSignIn(
  app: FastifyInstance,
  credentials: { email: string; password: string },
  remoteAddress: () => string,
): Promise<string> {
  const post = (url: string, payload: object) =>
    app.inject({ method: 'POST', url, remoteAddress: remoteAddress(), payload });

  const login = await post('/api/platform/auth/login', { email: credentials.email, password: credentials.password });
  expect(login.statusCode, `platform sign-in ${credentials.email}: ${login.body}`).toBe(200);
  const { step, challenge } = login.json() as { step: 'verify' | 'enroll'; challenge: string };

  if (step === 'enroll') {
    const setup = await post('/api/platform/auth/two-step/setup', { challenge });
    expect(setup.statusCode, setup.body).toBe(200);
    const code = codeForStep(setup.json().secret, stepAt(Date.now()));
    const enabled = await post('/api/platform/auth/two-step/enable', { challenge, code });
    expect(enabled.statusCode, enabled.body).toBe(200);
    return enabled.json().token;
  }

  const verified = await post('/api/platform/auth/two-step/verify', {
    challenge,
    code: await currentCode(app, credentials.email),
  });
  expect(verified.statusCode, verified.body).toBe(200);
  return verified.json().token;
}
