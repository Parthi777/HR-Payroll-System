/**
 * A Master Control session, the way an administrator gets one: password, then
 * a code from their authenticator — enrolling first if they never have.
 *
 * Not a test file (vitest only collects *.test.ts). Shared because almost every
 * database-backed suite signs a dealer administrator in only to test something
 * else, and a password alone no longer yields a token.
 */
import type { FastifyInstance } from 'fastify';
import type { Response } from 'light-my-request';
import { codeForStep, stepAt } from '../../src/services/auth/totp.js';
import { runUnscoped } from '../../src/context/tenant-context.js';

interface Credentials {
  email: string;
  password: string;
  /** The workspace, sent as X-Tenant-Slug. Omit to let the server pick the only one. */
  slug?: string;
}

/**
 * Sign in and return the response that carries the session — or the first
 * failing response, so a suite asserting a refusal (a suspended dealer, a
 * wrong password) sees the status it expects.
 */
export async function adminSignIn(
  app: FastifyInstance,
  { email, password, slug }: Credentials,
  remoteAddress?: () => string,
): Promise<Response> {
  const post = (url: string, payload: object) =>
    app.inject({
      method: 'POST',
      url,
      ...(remoteAddress ? { remoteAddress: remoteAddress() } : {}),
      headers: slug ? { 'x-tenant-slug': slug } : {},
      payload,
    });

  const login = await post('/api/auth/admin/login', { email, password });
  if (login.statusCode !== 200) return login;
  const { step, challenge } = login.json() as { step: 'verify' | 'enroll'; challenge: string };

  if (step === 'enroll') {
    const setup = await post('/api/auth/admin/two-step/setup', { challenge });
    if (setup.statusCode !== 200) return setup;
    const code = codeForStep(setup.json().secret, stepAt(Date.now()));
    return post('/api/auth/admin/two-step/enable', { challenge, code });
  }

  return post('/api/auth/admin/two-step/verify', { challenge, code: await currentAdminCode(app, challenge) });
}

/**
 * The code for right now, for the account a challenge names.
 *
 * Clears the replay guard first: a suite signs one account in several times
 * inside a single 30-second step, which a person with one phone cannot do and
 * the guard therefore (correctly) refuses. The guard itself is pinned by
 * admin-two-step.test.ts, which does not use this.
 */
export async function currentAdminCode(app: FastifyInstance, challenge: string): Promise<string> {
  const { sub } = app.jwt.decode<{ sub: string }>(challenge)!;
  const admin = await runUnscoped('test: read an enrolled secret', () =>
    app.prisma.adminUser.update({ where: { id: sub }, data: { totpLastStep: null }, select: { totpSecret: true } }),
  );
  if (!admin.totpSecret) throw new Error(`admin ${sub} has not enrolled in two-step verification`);
  return codeForStep(admin.totpSecret, stepAt(Date.now()));
}
