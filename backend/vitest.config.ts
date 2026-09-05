import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['tests/**/*.test.ts'],
    /**
     * Pin both clocks.
     *
     * The fixtures build calendar days with local-time constructors
     * (`new Date(2026, 6, 1)`) but punch instants with `Date.UTC(...)`, so on a
     * machine in IST the two disagree by 5h30m and days land either side of a
     * midnight boundary — half-days, overtime and "days served" all shift.
     * `COMPANY_TZ` alone is not enough; the process timezone has to match too.
     *
     * Without this the suite passes on a UTC CI box and fails on the author's
     * laptop, which is exactly the kind of difference that wastes an afternoon.
     */
    env: {
      TZ: 'UTC',
      COMPANY_TZ: 'UTC',
      // config/env.ts refuses to load without these, and it sits in the import
      // graph of anything that touches auth or storage. Placeholders keep
      // `npm test` working with zero setup; the isolation suite overrides
      // DATABASE_URL with a real one (see scripts/run-isolation-tests.ts).
      DATABASE_URL: process.env.DATABASE_URL ?? 'postgresql://placeholder/unused',
      JWT_SECRET: process.env.JWT_SECRET ?? 'test-jwt-secret-placeholder',
      JWT_REFRESH_SECRET: process.env.JWT_REFRESH_SECRET ?? 'test-refresh-secret-placeholder',
    },
  },
});
