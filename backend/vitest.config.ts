import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['tests/**/*.test.ts'],
    // Pin both clocks so date maths is identical on a laptop (IST) and CI (UTC).
    env: { TZ: 'UTC', COMPANY_TZ: 'UTC' },
  },
});
