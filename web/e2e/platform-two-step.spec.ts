/**
 * Looking after two-step verification once signed in: replacing your own
 * recovery codes, and resetting a colleague's after they lose their phone.
 *
 * Runs in the shared console session (the seeded platform owner). Enrolment
 * and the sign-in itself are covered in platform-auth.spec.ts.
 */
import { expect, test } from './fixtures';
import { COLLEAGUE } from './seed';
import { currentCode } from './two-step';
import { PLATFORM } from './seed';

test('replaces your recovery codes, and only with a live code', async ({ page }) => {
  await page.goto('/platform/account');
  await expect(page.getByRole('heading', { name: 'Two-step verification' })).toBeVisible();
  await expect(page.getByText(/^On since/)).toBeVisible();

  const codeInput = page.getByPlaceholder('123456');
  const generate = page.getByRole('button', { name: 'Generate new codes' });

  await codeInput.fill('000000');
  await generate.click();
  await expect(page.getByText('That code is not right')).toBeVisible();

  await codeInput.fill(currentCode(PLATFORM.email));
  await generate.click();
  await expect(page.getByText('New recovery codes.')).toBeVisible();
  await expect(page.locator('section ul li')).toHaveCount(10);
  await expect(page.getByText('10 recovery codes left.')).toBeVisible();
});

test('resets a colleague’s two-step verification, never your own', async ({ page }) => {
  await page.goto('/platform/users');
  const colleague = page.getByRole('row').filter({ hasText: COLLEAGUE.email });
  const me = page.getByRole('row').filter({ hasText: PLATFORM.email });

  await expect(colleague.getByText('On', { exact: true })).toBeVisible();
  await expect(me.getByRole('button', { name: 'Reset two-step' })).toHaveCount(0);

  page.once('dialog', (dialog) => dialog.accept());
  await colleague.getByRole('button', { name: 'Reset two-step' }).click();

  await expect(colleague.getByText('Not set up')).toBeVisible();
  await expect(colleague.getByRole('button', { name: 'Reset two-step' })).toHaveCount(0);
});
