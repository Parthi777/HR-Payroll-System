/**
 * The console overview: adding a dealer through the drawer, then suspending
 * and resuming it through the dialog — the two animated flows.
 */
import { expect, test } from './fixtures';

const SUFFIX = Date.now().toString(36);
const NAME = `Overview Motors ${SUFFIX}`;
const SLUG = `overview-motors-${SUFFIX}`;

test.describe.configure({ mode: 'serial' });

test('the overview shows totals, charts and the dealers', async ({ page }) => {
  await page.goto('/platform');
  await expect(page.getByRole('heading', { name: 'Overview', level: 1 })).toBeVisible();
  await expect(page.getByText('Active dealers')).toBeVisible();
  await expect(page.getByText('Check-ins, all dealers')).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Dealers', level: 2 })).toBeVisible();
});

test('a dealer is added through the drawer, step by step', async ({ page }) => {
  await page.goto('/platform');
  await page.getByRole('button', { name: 'Add dealer' }).first().click();

  const drawer = page.getByRole('dialog', { name: 'Add a dealer' });
  await expect(drawer).toBeVisible();
  const next = drawer.getByRole('button', { name: 'Next' });
  await expect(next).toBeDisabled();

  await drawer.getByPlaceholder('ABC Motors').fill(NAME);
  // The address follows the name.
  await expect(drawer.getByPlaceholder('abc-motors')).toHaveValue(SLUG);
  await next.click();

  await drawer.getByPlaceholder('Ravi Kumar').fill('Overview Owner');
  await drawer.getByPlaceholder('ravi@abcmotors.com').fill(`owner@${SLUG}.test`);
  await next.click();

  await expect(drawer.getByText(SLUG, { exact: true })).toBeVisible();
  await drawer.getByRole('button', { name: 'Create dealer' }).click();

  const done = page.getByRole('dialog', { name: 'Dealer created' });
  await expect(done.getByText(`${NAME} is ready`)).toBeVisible();
  await expect(done.getByText(`owner@${SLUG}.test`)).toBeVisible();
  await done.getByRole('button', { name: 'I have saved these' }).click();

  await expect(page.getByRole('link', { name: NAME })).toBeVisible();
});

test('suspending asks for the address, and resuming does not', async ({ page }) => {
  await page.goto('/platform');
  const card = page.locator('article', { has: page.getByRole('link', { name: NAME }) });
  await card.getByRole('button', { name: 'Suspend' }).click();

  const dialog = page.getByRole('dialog');
  await expect(dialog.getByRole('heading', { name: `Suspend ${NAME}?` })).toBeVisible();
  const confirm = dialog.getByRole('button', { name: 'Suspend dealer' });
  await expect(confirm).toBeDisabled();
  await dialog.getByRole('textbox').fill(SLUG);
  await confirm.click();
  await expect(dialog.getByText(`${NAME} is suspended`)).toBeVisible();

  await expect(card.getByText('Suspended', { exact: true })).toBeVisible();

  await card.getByRole('button', { name: 'Resume' }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'Resume dealer' }).click();
  await expect(card.getByText('Active', { exact: true })).toBeVisible();
});
