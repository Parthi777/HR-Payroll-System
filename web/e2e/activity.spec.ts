/**
 * The platform activity log.
 *
 * What matters about this page is that it tells the truth about who did what:
 * the filters are applied by the server, so "filtered" has to mean the rows
 * really changed, not that the browser hid some. Each test therefore checks
 * what is on screen against what the seed actually did.
 */
import type { Page } from '@playwright/test';
import { expect, test } from './fixtures';
import {
  BUSY_DEALER, COLLEAGUE, PADDING_ENTRIES, PLATFORM, QUIET_DEALER, QUIET_DEALER_FINAL_NAME, RENAMED_TO,
} from './seed';

const PAGE_SIZE = 50;

/** Every entry row on screen. */
const rows = (page: Page) => page.locator('ol > li');

/**
 * Pick a filter option by the start of its label.
 *
 * Options are labelled "Bhavani Motors Pvt Ltd (9)" — the count is part of what
 * the page shows and part of what is worth testing, but it makes the label a
 * moving target. Resolving the option's value keeps the test aimed at the name.
 */
async function choose(page: Page, select: number, label: string) {
  const dropdown = page.getByRole('combobox').nth(select);
  const option = dropdown.locator('option', { hasText: label }).first();
  await expect(option).toHaveCount(1);
  const value = await option.getAttribute('value');
  await dropdown.selectOption(value);
  await settled(page);
}

/**
 * Wait for the list to be the answer to the filter that is now set.
 *
 * Filtering is a round trip, and the page keeps the previous rows in place
 * while it waits — so without this a test can read the old list and believe it
 * is the new one. The page marks the region aria-busy while a request is in
 * flight, which is the same signal a screen reader gets.
 */
async function settled(page: Page) {
  await expect(page.locator('[aria-busy]').first()).toHaveAttribute('aria-busy', 'false');
}

const DEALER = 0;
const PERSON = 1;
const ACTION = 2;

test.beforeEach(async ({ page }) => {
  await page.goto('/platform/activity');
  await expect(page.getByRole('heading', { name: 'Activity', level: 1 })).toBeVisible();
  await expect(rows(page).first()).toBeVisible();
});

test('is reachable from the console navigation', async ({ page }) => {
  await page.goto('/platform');
  await page.getByRole('link', { name: 'Activity' }).click();
  await expect(page).toHaveURL(/\/platform\/activity/);
  await expect(rows(page).first()).toBeVisible();
});

test('shows what happened, who did it and to which dealer', async ({ page }) => {
  // The newest entry is the colleague renaming the quiet dealer.
  const newest = rows(page).first();
  await expect(newest).toContainText('Dealer renamed');
  await expect(newest).toContainText(COLLEAGUE.name);
  await expect(newest).toContainText(QUIET_DEALER_FINAL_NAME);

  // The whole seed is same-day, so it groups under one heading.
  await expect(page.getByRole('heading', { name: 'Today', level: 2 })).toBeVisible();

  // Actions read as English. A raw constant on screen means the describer
  // missed an action the server can emit.
  await expect(page.locator('body')).not.toContainText('TENANT_');
  await expect(page.locator('body')).not.toContainText('PLATFORM_USER_');
});

test('describes each kind of action with its specifics', async ({ page }) => {
  await choose(page, DEALER, BUSY_DEALER.name);
  await expect(rows(page).first()).toBeVisible();

  const text = await page.locator('ol').first().innerText();

  expect(text).toContain('Dealer onboarded');
  expect(text).toContain(BUSY_DEALER.slug);
  expect(text).toContain('Dealer login issued');
  expect(text).toContain('HR Manager');           // the role, not "HR_MANAGER"
  expect(text).toContain('Dealer suspended');
  expect(text).toContain('Dealer resumed');
  expect(text).toContain('Dealer renamed');
  expect(text).toContain(`${BUSY_DEALER.name} → ${RENAMED_TO}`);
});

test('filters by dealer, on the server', async ({ page }) => {
  const before = await rows(page).count();

  await choose(page, DEALER, BUSY_DEALER.name);
  await expect(page).toHaveURL(/tenantId=/);

  const after = rows(page);
  await expect(after.first()).toBeVisible();
  expect(await after.count()).toBeLessThan(before);

  // Every row is about this dealer — and the dealer chip is dropped, because
  // repeating one name on every line of a filtered list is noise.
  for (const row of await after.all()) {
    await expect(row).toContainText(/Dealer |Console /);
  }
  await expect(page.locator('ol').first()).not.toContainText(QUIET_DEALER.name);
});

test('filters by person', async ({ page }) => {
  await choose(page, PERSON, COLLEAGUE.name);
  await expect(page).toHaveURL(/actorId=/);

  // The colleague did exactly one thing in the seed.
  await expect(rows(page)).toHaveCount(1);
  await expect(rows(page).first()).toContainText(COLLEAGUE.name);
  await expect(rows(page).first()).toContainText('Dealer renamed');
  await expect(page.locator('ol').first()).not.toContainText(PLATFORM.name);
});

test('filters by action', async ({ page }) => {
  await choose(page, ACTION, 'Dealer suspended');
  await expect(page).toHaveURL(/action=TENANT_SUSPENDED/);

  await expect(rows(page)).toHaveCount(1);
  await expect(rows(page).first()).toContainText('Dealer suspended');
});

test('combines filters, and clears them', async ({ page }) => {
  await choose(page, PERSON, PLATFORM.name);
  await choose(page, ACTION, 'Dealer onboarded');

  await expect(page).toHaveURL(/actorId=.*action=|action=.*actorId=/);
  await expect(rows(page)).toHaveCount(2); // two dealers were onboarded

  await page.getByRole('button', { name: 'Clear' }).click();
  await expect(page).not.toHaveURL(/actorId=|action=/);
  await settled(page);
  await expect(rows(page)).toHaveCount(PAGE_SIZE);
});

test('says so when a filter matches nothing, and offers a way back', async ({ page }) => {
  // Nobody suspended a dealer except the platform owner, so pairing the
  // colleague with that action is a real empty result.
  await choose(page, PERSON, COLLEAGUE.name);
  await choose(page, ACTION, 'Dealer suspended');

  await expect(page.getByText('Nothing matches these filters.')).toBeVisible();
  await page.getByRole('button', { name: 'Clear the filters' }).click();
  await settled(page);
  await expect(rows(page)).toHaveCount(PAGE_SIZE);
});

test('pages through a log longer than one screen', async ({ page }) => {
  await expect(rows(page)).toHaveCount(PAGE_SIZE);

  const firstPageIds = await rowSignatures(page);
  await page.getByRole('button', { name: 'Show older entries' }).click();

  await expect(rows(page)).not.toHaveCount(PAGE_SIZE);
  const all = await rowSignatures(page);

  // The first page is still there, unchanged and still first.
  expect(all.slice(0, PAGE_SIZE)).toEqual(firstPageIds);
  // Nothing was served twice.
  expect(new Set(all).size).toBe(all.length);
  // The seed's entries are all accounted for.
  expect(all.length).toBeGreaterThan(PADDING_ENTRIES);

  await expect(page.getByText(/That is the whole log/)).toBeVisible();
});

test('opens pre-filtered from a link, so a filtered view can be shared', async ({ page }) => {
  // The dealer's own page is where such a link is offered.
  await page.goto('/platform');
  await page.getByRole('link', { name: new RegExp(BUSY_DEALER.name) }).first().click();
  await expect(page.getByRole('heading', { name: RENAMED_TO })).toBeVisible();

  await page.getByRole('link', { name: 'Open in the activity log' }).click();

  await expect(page).toHaveURL(/\/platform\/activity\?tenantId=/);
  await expect(rows(page).first()).toBeVisible();
  await expect(page.locator('ol').first()).not.toContainText(QUIET_DEALER.name);

  // The dropdown reflects the filter the link arrived with, rather than
  // showing "All dealers" over a filtered list.
  await expect(page.getByRole('combobox').nth(DEALER)).toHaveValue(/.+/);
});

test('a dealer’s own page names who acted, not just what happened', async ({ page }) => {
  await page.goto('/platform');
  await page.getByRole('link', { name: new RegExp(QUIET_DEALER.name) }).first().click();

  const log = page.locator('section', { has: page.getByRole('heading', { name: 'Activity' }) });
  await expect(log.locator('li').first()).toContainText(COLLEAGUE.name);
  await expect(log.locator('li').first()).toContainText('Dealer renamed');
});

/** A stable per-row identity: the text of each row, in order. */
async function rowSignatures(page: Page): Promise<string[]> {
  return rows(page).allInnerTexts();
}
