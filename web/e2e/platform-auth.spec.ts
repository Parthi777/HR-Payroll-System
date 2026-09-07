/**
 * Getting in and out of the platform console, and the wall around it.
 *
 * These run without the shared session — that is the point of them.
 */
import { expect, test } from './fixtures';
import { PLATFORM } from './seed';

test.use({ storageState: { cookies: [], origins: [] } });

test('an unauthenticated visitor is sent to the sign-in page', async ({ page }) => {
  await page.goto('/platform/activity');
  await expect(page).toHaveURL(/\/platform\/login/);
  await expect(page.getByRole('heading', { name: 'Platform Console' })).toBeVisible();

  // The log must not flash up before the redirect.
  await expect(page.getByRole('heading', { name: 'Activity' })).toHaveCount(0);
});

test('a wrong password is refused, without saying which half was wrong', async ({ page }) => {
  await page.goto('/platform/login');
  await page.getByPlaceholder('you@yourcompany.com').fill(PLATFORM.email);
  await page.locator('input[type="password"]').fill('not-the-password');
  await page.getByRole('button', { name: 'Sign In' }).click();

  await expect(page.getByText('Invalid email or password')).toBeVisible();
  await expect(page).toHaveURL(/\/platform\/login/);
});

test('signing in and out', async ({ page }) => {
  await page.goto('/platform/login');
  await page.getByPlaceholder('you@yourcompany.com').fill(PLATFORM.email);
  await page.locator('input[type="password"]').fill(PLATFORM.password);
  await page.getByRole('button', { name: 'Sign In' }).click();

  await expect(page).toHaveURL(/\/platform$/);
  await expect(page.getByRole('link', { name: PLATFORM.name })).toBeVisible();

  await page.getByTitle('Sign out').click();
  await expect(page).toHaveURL(/\/platform\/login/);

  // The session is really gone, not just navigated away from.
  await page.goto('/platform/activity');
  await expect(page).toHaveURL(/\/platform\/login/);
});
