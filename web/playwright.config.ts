/**
 * Browser tests for the Master Control web app.
 *
 * They run against the real stack — a real Fastify backend on a real Postgres —
 * because the things worth testing here are the seams: a page that reads what
 * an endpoint actually returns, a filter applied server-side, a token that has
 * to survive a navigation. A mocked API would test none of that.
 *
 *   npm run e2e            # headless
 *   npm run e2e:headed     # watch it happen
 *
 * Needs the throwaway Postgres from docs/MIGRATIONS.md on port 55433. The
 * database (hre2e) is dropped and rebuilt on every run; the dev database and
 * the backend suite's hrtest are both left alone.
 */
import { defineConfig, devices } from '@playwright/test';
import { API_PORT, E2E_DATABASE_URL, WEB_PORT, WEB_URL, API_URL } from './e2e/config';
export default defineConfig({
  testDir: './e2e',
  globalSetup: './e2e/global-setup.ts',
  // The suite shares one database, and several tests change state in it.
  fullyParallel: false,
  workers: 1,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [['github'], ['list']] : [['list']],
  timeout: 30_000,
  expect: { timeout: 10_000 },

  use: {
    baseURL: WEB_URL,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },

  projects: [
    // Signs in once and saves the session; everything else starts from it.
    { name: 'setup', testMatch: /auth\.setup\.ts/ },
    {
      name: 'chromium',
      dependencies: ['setup'],
      testIgnore: /auth\.setup\.ts/,
      use: { ...devices['Desktop Chrome'], storageState: './e2e/.auth/platform.json' },
    },
  ],

  webServer: [
    {
      // The reset runs here, not at config scope: Playwright re-imports the
      // config in every worker, and a reset there would wipe the seeded
      // fixture out from under the tests. It has to precede the server, which
      // reads the tenant list as it boots and cannot start on no schema.
      command: 'npx tsx ../web/e2e/reset-db.ts && npx tsx src/server.ts',
      cwd: '../backend',
      port: API_PORT,
      reuseExistingServer: false,
      stdout: 'pipe',
      stderr: 'pipe',
      timeout: 60_000,
      env: {
        DATABASE_URL: E2E_DATABASE_URL,
        PORT: String(API_PORT),
        JWT_SECRET: 'e2e-jwt-secret-key',
        JWT_REFRESH_SECRET: 'e2e-jwt-refresh-key',
        NODE_ENV: 'test',
      },
    },
    {
      command: `npx next dev -p ${WEB_PORT}`,
      cwd: '.',
      port: WEB_PORT,
      reuseExistingServer: false,
      stdout: 'pipe',
      stderr: 'pipe',
      timeout: 120_000,
      env: { NEXT_PUBLIC_API_URL: API_URL },
    },
  ],
});
