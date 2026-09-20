/**
 * The branch kiosk, driven the way it is really used: an administrator pairs a
 * tablet, then someone walks up and punches on it.
 *
 * Runs with AWS off (see playwright.config.ts), so the tablet takes a plain
 * photo rather than running the live-person check. That is the fallback path a
 * deployment without liveness uses, and the only one a headless browser can
 * drive — what AWS adds is covered in docs/KIOSK.md.
 *
 * Serial: each step leans on the one before it.
 */
import type { BrowserContext, Page } from '@playwright/test';
import { expect, test } from './fixtures';
import { API_URL } from './config';
import { BUSY_DEALER } from './seed';

test.describe.configure({ mode: 'serial' });

/**
 * One context for the tablet, held across the tests.
 *
 * A paired tablet keeps its token — that is the whole point of pairing — and
 * Playwright gives each test a fresh context, which would throw it away between
 * steps. This is the tablet sitting on the desk between punches.
 */
let tablet: BrowserContext;
let tabletPage: Page;

test.beforeAll(async ({ browser }) => {
  tablet = await browser.newContext({
    permissions: ['camera'],
    extraHTTPHeaders: { 'X-Forwarded-For': '10.21.0.7' },
  });
  tabletPage = await tablet.newPage();
});

test.afterAll(async () => {
  await tablet?.close();
});

const DEALER_PASSWORD = 'dealer-owner-password';
const STAFF = { name: 'Kiosk Staffer', phone: '+919000077777' };

let pairingCode = '';
let staffCode = '';

/** Set up what the kiosk needs that the seed does not create: a placed branch and an employee. */
test('a branch with a location, and someone to punch', async ({ request }) => {
  const headers = { 'x-tenant-slug': BUSY_DEALER.slug, 'X-Forwarded-For': '10.20.0.1' };
  const login = await request.post(`${API_URL}/auth/admin/login`, {
    headers,
    data: { email: `owner@${BUSY_DEALER.slug}.test`, password: DEALER_PASSWORD },
  });
  expect(login.status(), await login.text()).toBe(200);
  const auth = { ...headers, authorization: `Bearer ${(await login.json()).token}` };

  const branches = await (await request.get(`${API_URL}/admin/branches`, { headers: auth })).json();
  const branchId = branches.branches[0].id;

  // A workspace is provisioned with its branch location zeroed; a kiosk punches
  // at those coordinates, so it has to be placed first.
  const placed = await request.put(`${API_URL}/admin/geofence/${branchId}`, {
    headers: auth,
    data: { geofenceLat: 11.0168, geofenceLng: 76.9558, geofenceRadius: 200, strictMode: false },
  });
  expect(placed.status(), await placed.text()).toBe(200);

  const [departments, designations, shifts] = await Promise.all([
    (await request.get(`${API_URL}/admin/departments`, { headers: auth })).json(),
    (await request.get(`${API_URL}/admin/designations`, { headers: auth })).json(),
    (await request.get(`${API_URL}/shifts`, { headers: auth })).json(),
  ]);

  const created = await request.post(`${API_URL}/admin/employees`, {
    headers: auth,
    data: {
      name: STAFF.name, phone: STAFF.phone, branchId,
      departmentId: departments.departments[0].id,
      designationId: designations.designations[0].id,
      shiftId: shifts.shifts[0].id,
      joiningDate: '2026-01-01', salary: 21000, password: 'employee-app-password',
    },
  });
  expect(created.status(), await created.text()).toBe(200);
  staffCode = (await created.json()).employee.employeeCode;
  expect(staffCode).toBeTruthy();
});

test('an administrator adds a kiosk and gets a pairing code', async ({ page }) => {
  await page.goto(`/login?tenant=${BUSY_DEALER.slug}`);
  await page.getByPlaceholder('you@company.com').fill(`owner@${BUSY_DEALER.slug}.test`);
  await page.locator('input[type="password"]').fill(DEALER_PASSWORD);
  await page.getByRole('button', { name: /sign in/i }).click();
  await expect(page).toHaveURL(/\/dashboard/);

  await page.goto('/kiosks');
  await expect(page.getByRole('heading', { name: 'Kiosks', level: 1 })).toBeVisible();
  // With no liveness configured the page says so rather than implying a check.
  await expect(page.getByText('The live-person check is off.')).toBeVisible();

  await page.getByRole('button', { name: 'Add kiosk' }).click();
  await page.getByPlaceholder('Reception tablet').fill('Front desk');
  await page.getByRole('button', { name: 'Create and show code' }).click();

  await expect(page.getByRole('heading', { name: 'Pair Front desk' })).toBeVisible();
  pairingCode = ((await page.locator('.font-mono.text-4xl').textContent()) ?? '').trim();
  expect(pairingCode).toMatch(/^[A-Z2-9]{4}-[A-Z2-9]{4}$/);
});

test('the tablet pairs itself, once', async ({ browser }) => {
  await tabletPage.goto('/kiosk');
  await expect(tabletPage.getByRole('heading', { name: 'Set up this tablet' })).toBeVisible();

  await tabletPage.getByPlaceholder('bhavani-motors').fill(BUSY_DEALER.slug);
  await tabletPage.getByPlaceholder('ABCD-EFGH').fill(pairingCode);
  await tabletPage.getByRole('button', { name: 'Pair this tablet' }).click();

  // Paired: it now knows which branch it stands in.
  await expect(tabletPage.getByText('Front desk')).toBeVisible();
  await expect(tabletPage.getByText('Enter your employee code')).toBeVisible();

  // A genuinely different tablet — its own context, so its own storage —
  // cannot pair with the code that has just been used.
  const otherTablet = await browser.newContext({ extraHTTPHeaders: { 'X-Forwarded-For': '10.21.0.8' } });
  const second = await otherTablet.newPage();
  await second.goto('/kiosk');
  await second.getByPlaceholder('bhavani-motors').fill(BUSY_DEALER.slug);
  await second.getByPlaceholder('ABCD-EFGH').fill(pairingCode);
  await second.getByRole('button', { name: 'Pair this tablet' }).click();
  await expect(second.getByText('That pairing code is not valid')).toBeVisible();
  await otherTablet.close();
});

test('someone punches in, then out', async () => {
  const page = tabletPage;
  await page.reload();
  await expect(page.getByText('Enter your employee code')).toBeVisible();

  // Typed on the keypad, digit by digit, the way it is really used.
  for (const digit of staffCode.replace(/\D/g, '')) {
    await page.getByRole('button', { name: digit, exact: true }).click();
  }
  await page.getByRole('button', { name: 'Continue' }).click();

  await expect(page.getByRole('heading', { name: STAFF.name })).toBeVisible();
  await page.getByRole('button', { name: 'Check in' }).click();

  await page.getByRole('button', { name: 'Take photo' }).click();
  await expect(page.getByRole('heading', { name: STAFF.name })).toBeVisible();
  await expect(page.getByText('Checked in')).toBeVisible();

  // Back to the keypad by itself, so the next person does not see the last one.
  await page.getByRole('button', { name: 'Done' }).click();
  await expect(page.getByText('Enter your employee code')).toBeVisible();

  // The same code again sends them the other way.
  for (const digit of staffCode.replace(/\D/g, '')) {
    await page.getByRole('button', { name: digit, exact: true }).click();
  }
  await page.getByRole('button', { name: 'Continue' }).click();
  await expect(page.getByRole('button', { name: 'Check out' })).toBeVisible();
  await page.getByRole('button', { name: 'Check out' }).click();
  await page.getByRole('button', { name: 'Take photo' }).click();
  await expect(page.getByText('Checked out')).toBeVisible();
});

test('switching the tablet off stops it', async ({ page }) => {
  await page.goto(`/login?tenant=${BUSY_DEALER.slug}`);
  await page.getByPlaceholder('you@company.com').fill(`owner@${BUSY_DEALER.slug}.test`);
  await page.locator('input[type="password"]').fill(DEALER_PASSWORD);
  await page.getByRole('button', { name: /sign in/i }).click();
  // Wait for the session to land: navigating straight away races it, and the
  // guard bounces back to the sign-in page.
  await expect(page).toHaveURL(/\/dashboard/);
  await page.goto('/kiosks');

  await expect(page.getByRole('heading', { name: 'Kiosks', level: 1 })).toBeVisible();
  const card = page.locator('li').filter({ hasText: 'Front desk' });
  await expect(card).toHaveCount(1);
  page.once('dialog', (dialog) => dialog.accept());
  await card.getByRole('button', { name: 'Switch off' }).click();
  await expect(card.getByText('Off', { exact: true })).toBeVisible();

  // The tablet finds out on its next request, not when its token expires.
  await tabletPage.reload();
  await expect(tabletPage.getByRole('heading', { name: 'Set up this tablet' })).toBeVisible();
});
