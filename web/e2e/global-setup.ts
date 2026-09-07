/**
 * Fill the database once, before any test runs.
 *
 * The schema is already there — see e2e/database.ts for why that has to happen
 * earlier still. All this does is wait for the backend to answer and then drive
 * it through the API to build the fixture.
 */
import { API_URL, E2E_DATABASE_URL } from './config';
import { seed } from './seed';

export default async function globalSetup() {
  console.log('[e2e] global setup: waiting for the API…');
  await waitForApi();
  console.log('[e2e] global setup: seeding…');
  await seed(API_URL, E2E_DATABASE_URL);
  console.log('[e2e] global setup: done');
}

/** Playwright waits for the port to accept a connection; this waits for the app. */
async function waitForApi() {
  const deadline = Date.now() + 60_000;
  let lastError = 'never answered';
  while (Date.now() < deadline) {
    try {
      // 401 is the expected answer — it means routes are registered and the
      // auth layer is running, which is as ready as this endpoint gets.
      const res = await fetch(`${API_URL}/platform/audit`);
      if (res.status === 401) return;
      lastError = `unexpected status ${res.status}`;
    } catch (err) {
      lastError = err instanceof Error ? err.message : String(err);
    }
    await new Promise((r) => setTimeout(r, 500));
  }
  throw new Error(`Backend never became ready at ${API_URL}: ${lastError}`);
}
