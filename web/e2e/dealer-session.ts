/**
 * Signing a dealer administrator in, the whole way: password, then the second
 * step — setting up the authenticator first if this is the account's first
 * sign-in, as every Master Control account's first sign-in is.
 *
 * Not a shortcut around the form: these drive the real sign-in page (or, for
 * fixtures, the real API) and only read the secret an authenticator app would
 * have scanned, the same way two-step.ts does for the console.
 */
import { execFileSync } from 'node:child_process';
import type { APIRequestContext, Page } from '@playwright/test';
import { expect } from './fixtures';
import { API_URL, E2E_DATABASE_URL } from './config';
import { totp } from './two-step';

interface Dealer {
  slug: string;
  email: string;
  password: string;
}

function psql(sql: string, vars: Record<string, string>): string {
  const args = [E2E_DATABASE_URL, '-qAt', ...Object.entries(vars).flatMap(([k, v]) => ['-v', `${k}=${v}`])];
  return execFileSync('psql', args, { input: sql }).toString().trim();
}

/** The code for right now, for an enrolled account. Clears the replay guard, as currentCode does. */
export function currentAdminCode(slug: string, email: string): string {
  const secret = psql(
    `UPDATE "AdminUser" a SET "totpLastStep" = NULL FROM "Tenant" t
     WHERE a."tenantId" = t.id AND t.slug = :'slug' AND a.email = :'email' RETURNING a."totpSecret";`,
    { slug, email },
  );
  if (!secret) throw new Error(`${email} at ${slug} has not set up two-step verification`);
  return totp(secret);
}

/** The code from the secret currently on the setup screen — what scanning the QR would give. */
export function pendingAdminCode(slug: string, email: string): string {
  const secret = psql(
    `SELECT a."totpPendingSecret" FROM "AdminUser" a JOIN "Tenant" t ON t.id = a."tenantId"
     WHERE t.slug = :'slug' AND a.email = :'email';`,
    { slug, email },
  );
  if (!secret) throw new Error(`${email} at ${slug} has no setup in progress`);
  return totp(secret);
}

/** Through the sign-in page, ending on the dashboard. */
export async function signInToDealer(page: Page, { slug, email, password }: Dealer): Promise<void> {
  await page.goto(`/login?tenant=${slug}`);
  await page.getByPlaceholder('you@company.com').fill(email);
  await page.locator('input[type="password"]').fill(password);
  await page.getByRole('button', { name: /sign in/i }).click();
  await completeTwoStep(page, slug, email);
}

/** After the password: enrol or verify, whichever the page asks for, ending on the dashboard. */
export async function completeTwoStep(page: Page, slug: string, email: string): Promise<void> {
  const verify = page.getByRole('heading', { name: 'Two-step verification' });
  const setup = page.getByRole('heading', { name: 'Set up two-step verification' });
  await expect(verify.or(setup)).toBeVisible();

  if (await setup.isVisible()) {
    await expect(page.getByAltText('QR code for your authenticator app')).toBeVisible();
    await page.getByPlaceholder('123456').fill(pendingAdminCode(slug, email));
    await page.getByRole('button', { name: 'Turn on and sign in' }).click();
    await expect(page.getByRole('heading', { name: 'Two-step verification is on' })).toBeVisible();
    await page.getByLabel('I have saved these codes somewhere safe').check();
    await page.getByRole('button', { name: 'Continue to Master Control' }).click();
  } else {
    await page.getByPlaceholder('123456').fill(currentAdminCode(slug, email));
    await page.getByRole('button', { name: 'Verify' }).click();
  }
  await expect(page).toHaveURL(/\/dashboard/);
}

/** Through the API, for fixtures: a session token. */
export async function dealerToken(request: APIRequestContext, { slug, email, password }: Dealer, ip: string): Promise<string> {
  const headers = { 'x-tenant-slug': slug, 'X-Forwarded-For': ip };
  const post = async <T>(path: string, data: object): Promise<T> => {
    const res = await request.post(`${API_URL}${path}`, { headers, data });
    expect(res.status(), await res.text()).toBe(200);
    return (await res.json()) as T;
  };
  const { step, challenge } = await post<{ step: 'verify' | 'enroll'; challenge: string }>('/auth/admin/login', { email, password });
  if (step === 'enroll') {
    const { secret } = await post<{ secret: string }>('/auth/admin/two-step/setup', { challenge });
    return (await post<{ token: string }>('/auth/admin/two-step/enable', { challenge, code: totp(secret) })).token;
  }
  return (await post<{ token: string }>('/auth/admin/two-step/verify', { challenge, code: currentAdminCode(slug, email) })).token;
}
