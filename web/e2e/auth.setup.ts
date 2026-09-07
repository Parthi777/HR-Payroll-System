/**
 * Sign in once, and hand the session to every other spec.
 *
 * Not a shortcut around the login form — the form is tested in
 * platform-auth.spec.ts. This exists so twenty tests are not twenty sign-ins,
 * which would say nothing new and would spend the login rate limit.
 */
import path from 'node:path';
import { expect, test as setup } from './fixtures';
import { PLATFORM } from './seed';

export const PLATFORM_STATE = path.join(__dirname, '.auth/platform.json');

setup('sign in to the platform console', async ({ page }) => {
  await page.goto('/platform/login');
  await page.getByPlaceholder('you@yourcompany.com').fill(PLATFORM.email);
  await page.locator('input[type="password"]').fill(PLATFORM.password);
  await page.getByRole('button', { name: 'Sign In' }).click();

  await expect(page).toHaveURL(/\/platform$/);
  await expect(page.getByRole('link', { name: PLATFORM.name })).toBeVisible();

  await page.context().storageState({ path: PLATFORM_STATE });
});
