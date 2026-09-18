/**
 * Getting in and out of the platform console, and the wall around it.
 *
 * These run without the shared session — that is the point of them.
 */
import { expect, test } from './fixtures';
import { PLATFORM } from './seed';
import { createPlatformAccount, currentCode, totp } from './two-step';

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

test('a correct password alone does not open the console', async ({ page }) => {
  await page.goto('/platform/login');
  await page.getByPlaceholder('you@yourcompany.com').fill(PLATFORM.email);
  await page.locator('input[type="password"]').fill(PLATFORM.password);
  await page.getByRole('button', { name: 'Sign In' }).click();

  await expect(page.getByPlaceholder('123456')).toBeVisible();
  await page.getByPlaceholder('123456').fill('000000');
  await page.getByRole('button', { name: 'Verify' }).click();
  await expect(page.getByText('That code is not right')).toBeVisible();

  // Half signed in is not signed in.
  await page.goto('/platform/activity');
  await expect(page).toHaveURL(/\/platform\/login/);
});

test('signing in and out', async ({ page }) => {
  await page.goto('/platform/login');
  await page.getByPlaceholder('you@yourcompany.com').fill(PLATFORM.email);
  await page.locator('input[type="password"]').fill(PLATFORM.password);
  await page.getByRole('button', { name: 'Sign In' }).click();
  await page.getByPlaceholder('123456').fill(currentCode(PLATFORM.email));
  await page.getByRole('button', { name: 'Verify' }).click();

  await expect(page).toHaveURL(/\/platform$/);
  await expect(page.getByRole('link', { name: PLATFORM.name })).toBeVisible();

  await page.getByTitle('Sign out').click();
  await expect(page).toHaveURL(/\/platform\/login/);

  // The session is really gone, not just navigated away from.
  await page.goto('/platform/activity');
  await expect(page).toHaveURL(/\/platform\/login/);
});

test('a first sign-in sets up two-step verification before letting anyone in', async ({ page }) => {
  // Unique per attempt: a retry must meet an account that has never enrolled.
  const account = { email: `enrol-${Date.now()}@platform.test`, name: 'Enrolling Admin', password: 'enrolling-admin-password' };
  createPlatformAccount(account);

  await page.goto('/platform/login');
  await page.getByPlaceholder('you@yourcompany.com').fill(account.email);
  await page.locator('input[type="password"]').fill(account.password);
  await page.getByRole('button', { name: 'Sign In' }).click();

  await expect(page.getByRole('heading', { name: 'Set up two-step verification' })).toBeVisible();
  await expect(page.getByAltText('QR code for your authenticator app')).toBeVisible();

  // Nothing is open while setup is unfinished.
  const elsewhere = await page.context().newPage();
  await elsewhere.goto('/platform');
  await expect(elsewhere).toHaveURL(/\/platform\/login/);
  await elsewhere.close();

  // Enter the key by hand, as someone who cannot scan would.
  await page.getByText('Can’t scan? Enter the key instead').click();
  const secret = (await page.locator('details code').textContent()) ?? '';
  await page.getByPlaceholder('123456').fill(totp(secret));
  await page.getByRole('button', { name: 'Turn on and sign in' }).click();

  await expect(page.getByRole('heading', { name: 'Two-step verification is on' })).toBeVisible();
  await expect(page.getByRole('list', { name: 'Recovery codes' }).getByRole('listitem')).toHaveCount(10);

  // The codes exist only on this screen, so leaving it is gated on saying so.
  const proceed = page.getByRole('button', { name: 'Continue to the console' });
  await expect(proceed).toBeDisabled();
  await page.getByLabel('I have saved these codes somewhere safe').check();
  await proceed.click();

  await expect(page).toHaveURL(/\/platform$/);
  await expect(page.getByRole('link', { name: account.name })).toBeVisible();
});
