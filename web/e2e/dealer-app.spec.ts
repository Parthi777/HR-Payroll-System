/**
 * The dealer-facing app, far enough in to know the two surfaces are separate.
 *
 * A platform administrator's credentials must not open a dealer's workspace —
 * the server enforces that, and this is the check that the browser cannot get
 * around it either.
 */
import { expect, test } from './fixtures';
import { BUSY_DEALER, PLATFORM, RENAMED_TO } from './seed';
import { completeTwoStep, currentAdminCode, pendingAdminCode, signInToDealer } from './dealer-session';

test.use({ storageState: { cookies: [], origins: [] } });

test('a dealer administrator signs in to their own workspace', async ({ page }) => {
  await signInToDealer(page, { slug: BUSY_DEALER.slug, email: `owner@${BUSY_DEALER.slug}.test`, password: 'dealer-owner-password' });
  // The product's own mark, not a generic icon.
  await expect(page.getByRole('img', { name: 'Kayaazh Payroll' }).first()).toBeVisible();
});

/**
 * Every Master Control account signs in with a code from a phone. The first
 * time, the page sets that up; after that, it asks for the code.
 */
test('a manager sets up two-step on first sign-in, and needs a code after', async ({ page }) => {
  const manager = { slug: BUSY_DEALER.slug, email: `hr@${BUSY_DEALER.slug}.test`, password: 'dealer-second-password' };
  await page.goto(`/login?tenant=${manager.slug}`);
  // No third-party sign-in: accounts are issued by an administrator.
  await expect(page.getByText(/google/i)).toHaveCount(0);
  await page.getByPlaceholder('you@company.com').fill(manager.email);
  await page.locator('input[type="password"]').fill(manager.password);
  await page.getByRole('button', { name: /sign in/i }).click();

  await expect(page.getByRole('heading', { name: 'Set up two-step verification' })).toBeVisible();
  await page.getByPlaceholder('123456').fill(pendingAdminCode(manager.slug, manager.email));
  await page.getByRole('button', { name: 'Turn on and sign in' }).click();
  await expect(page.getByRole('list', { name: 'Recovery codes' }).locator('li')).toHaveCount(10);
  await page.getByLabel('I have saved these codes somewhere safe').check();
  await page.getByRole('button', { name: 'Continue to Master Control' }).click();
  await expect(page).toHaveURL(/\/dashboard/);

  await page.getByTitle('Sign out').click();
  await page.goto(`/login?tenant=${manager.slug}`);
  await page.getByPlaceholder('you@company.com').fill(manager.email);
  await page.locator('input[type="password"]').fill(manager.password);
  await page.getByRole('button', { name: /sign in/i }).click();
  await expect(page.getByRole('heading', { name: 'Two-step verification' })).toBeVisible();
  await page.getByPlaceholder('123456').fill('000000');
  await page.getByRole('button', { name: 'Verify' }).click();
  await expect(page.getByText('That code is not right')).toBeVisible();
  await page.getByPlaceholder('123456').fill(currentAdminCode(manager.slug, manager.email));
  await page.getByRole('button', { name: 'Verify' }).click();
  await expect(page).toHaveURL(/\/dashboard/);
});

/**
 * What a dealer meets on the shared admin address: two dealers exist and the
 * URL names neither, so the page has to ask before it can ask for a password.
 */
test('a shared address asks which workspace, before the password', async ({ page }) => {
  await page.goto('/login');

  await expect(page.getByRole('heading', { name: 'Which workspace?' })).toBeVisible();
  await expect(page.locator('input[type="password"]'), 'the password field came first').toHaveCount(0);

  const address = page.getByPlaceholder('bhavani-motors');
  await address.fill('no-such-dealer');
  await page.getByRole('button', { name: 'Continue' }).click();
  await expect(page.getByText(/No workspace at/)).toBeVisible();

  await address.fill(BUSY_DEALER.slug);
  await page.getByRole('button', { name: 'Continue' }).click();

  // Named, and shown by name before anyone types a password — as the badge,
  // not only as the "Not …?" way back out of it.
  await expect(page.getByText(RENAMED_TO, { exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: `Not ${RENAMED_TO}? Choose another workspace` })).toBeVisible();
  await page.getByPlaceholder('you@company.com').fill(`owner@${BUSY_DEALER.slug}.test`);
  await page.locator('input[type="password"]').fill('dealer-owner-password');
  await page.getByRole('button', { name: /sign in/i }).click();

  await completeTwoStep(page, BUSY_DEALER.slug, `owner@${BUSY_DEALER.slug}.test`);
});

test('a platform sign-in does not open a dealer workspace', async ({ page }) => {
  await page.goto(`/login?tenant=${BUSY_DEALER.slug}`);

  await page.getByPlaceholder('you@company.com').fill(PLATFORM.email);
  await page.locator('input[type="password"]').fill(PLATFORM.password);
  await page.getByRole('button', { name: /sign in/i }).click();

  await expect(page).not.toHaveURL(/\/dashboard/);
  await expect(page.getByText(/invalid|not found|incorrect/i).first()).toBeVisible();
});
