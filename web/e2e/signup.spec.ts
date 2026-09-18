/**
 * A dealership signing itself up, from the public site to an open workspace.
 *
 * Runs against the real stack with no Razorpay configured, which is the path
 * the product ships on today: the platform records the payment by hand and the
 * workspace opens. The gateway's own half is covered by the backend suite
 * (signature verification, idempotent capture) because it cannot be driven from
 * a browser without a live account.
 *
 * Serial, and deliberately last: it adds a dealer and a handful of platform
 * audit entries, which activity.spec counts. Playwright runs files in
 * alphabetical order with one worker, so this file's name keeps it after them.
 */
import { expect, test } from './fixtures';

const COMPANY = 'Selvam Motors';
const SLUG = `selvam-${Date.now().toString(36)}`;
const CONTACT = { name: 'Selvam Raj', email: `owner@${SLUG}.test`, phone: '+919000044444' };

test.describe.configure({ mode: 'serial' });

let paymentUrl = '';

test('a dealership asks for a workspace from the pricing page', async ({ page }) => {
  await page.goto('/pricing');
  await page.getByRole('link', { name: 'Choose Growth' }).click();

  await expect(page).toHaveURL(/\/signup\?plan=GROWTH/);
  // The plan travelled with the link, so nobody has to choose twice.
  await expect(page.getByRole('radio', { name: /Growth/ })).toBeChecked();

  await page.getByPlaceholder('Bhavani Motors').fill(COMPANY);
  // The address is suggested from the name, and can be overridden.
  await expect(page.getByPlaceholder('bhavani-motors')).toHaveValue('selvam-motors');
  await page.getByPlaceholder('bhavani-motors').fill(SLUG);
  await page.getByPlaceholder('Ravi Kumar').fill(CONTACT.name);
  await page.getByPlaceholder('+91 90000 00000').fill(CONTACT.phone);
  await page.getByPlaceholder('you@dealership.com').fill(CONTACT.email);

  await page.getByRole('button', { name: 'Send request' }).click();

  await expect(page.getByRole('heading', { name: 'Request received' })).toBeVisible();
  await expect(page.getByText(COMPANY)).toBeVisible();
  // Signing up creates no session and no workspace to walk into.
  await page.goto(`/login?tenant=${SLUG}`);
  await expect(page.getByText('Welcome back')).toBeVisible();
});

test('the platform reviews it, and the workspace is created shut', async ({ page }) => {
  await page.goto('/platform/signups');
  const row = page.locator('li').filter({ hasText: COMPANY });
  await expect(row).toBeVisible();
  await expect(row.getByText('GROWTH')).toBeVisible();

  await row.getByRole('button', { name: 'Approve' }).click();
  await expect(page.getByRole('heading', { name: `Approve ${COMPANY}` })).toBeVisible();
  await page.getByRole('button', { name: 'Approve and create workspace' }).click();

  await expect(page.getByRole('heading', { name: `${COMPANY} is approved` })).toBeVisible();
  // The payment link is the thing to hand over, so it is shown, not hidden.
  const link = await page.locator('dd', { hasText: '/signup/pay/' }).first().textContent();
  paymentUrl = (link ?? '').trim();
  expect(paymentUrl).toContain('/signup/pay/');
  await expect(page.getByText('suspended')).toBeVisible();
});

test('the payment page shows what is owed, and the workspace is still shut', async ({ page }) => {
  await page.goto(new URL(paymentUrl, 'http://127.0.0.1').pathname);

  await expect(page.getByRole('heading', { name: 'One payment, and you are in.' })).toBeVisible();
  await expect(page.getByText(COMPANY)).toBeVisible();
  await expect(page.getByText('₹3,999')).toBeVisible();
  // No gateway configured in this environment, so it says so rather than
  // offering a button that cannot work.
  await expect(page.getByText('We will take payment directly')).toBeVisible();

  const signIn = await page.request.post('http://127.0.0.1:3399/api/auth/admin/login', {
    headers: { 'x-tenant-slug': SLUG },
    data: { email: CONTACT.email, password: 'x'.repeat(14) },
  });
  expect(signIn.status(), 'an unpaid workspace let someone try to sign in').toBe(403);
});

test('recording the payment opens the workspace', async ({ page }) => {
  await page.goto('/platform/signups');
  await page.getByRole('button', { name: 'approved' }).click();

  const row = page.locator('li').filter({ hasText: COMPANY });
  await expect(row.getByText(/Awaiting ₹3,999/)).toBeVisible();

  page.once('dialog', (dialog) => dialog.accept());
  await row.getByRole('button', { name: 'Mark as paid' }).click();
  await expect(row.getByText('Paid')).toBeVisible();

  // And the payment page now agrees.
  await page.goto(new URL(paymentUrl, 'http://127.0.0.1').pathname);
  await expect(page.getByRole('heading', { name: 'Your workspace is open.' })).toBeVisible();
  await expect(page.getByRole('link', { name: 'Go to sign in' })).toBeVisible();
});
