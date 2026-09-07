/**
 * The dealer-facing app, far enough in to know the two surfaces are separate.
 *
 * A platform administrator's credentials must not open a dealer's workspace —
 * the server enforces that, and this is the check that the browser cannot get
 * around it either.
 */
import { expect, test } from './fixtures';
import { BUSY_DEALER, PLATFORM } from './seed';

test.use({ storageState: { cookies: [], origins: [] } });

test('a dealer administrator signs in to their own workspace', async ({ page }) => {
  await page.goto(`/login?tenant=${BUSY_DEALER.slug}`);

  await page.getByPlaceholder('you@company.com').fill(`owner@${BUSY_DEALER.slug}.test`);
  await page.locator('input[type="password"]').fill('dealer-owner-password');
  await page.getByRole('button', { name: /sign in/i }).click();

  await expect(page).toHaveURL(/\/dashboard/);
});

test('a platform sign-in does not open a dealer workspace', async ({ page }) => {
  await page.goto(`/login?tenant=${BUSY_DEALER.slug}`);

  await page.getByPlaceholder('you@company.com').fill(PLATFORM.email);
  await page.locator('input[type="password"]').fill(PLATFORM.password);
  await page.getByRole('button', { name: /sign in/i }).click();

  await expect(page).not.toHaveURL(/\/dashboard/);
  await expect(page.getByText(/invalid|not found|incorrect/i).first()).toBeVisible();
});
