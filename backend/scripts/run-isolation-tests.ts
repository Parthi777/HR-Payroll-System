/**
 * Run the cross-tenant isolation suite against a real Postgres.
 *
 *   npm run test:isolation
 *
 * The suite needs a database because it proves isolation end to end — an
 * in-memory fake could not show that a real query is actually filtered. It
 * skips itself when TEST_DATABASE_URL is unset, so plain `npm test` still runs
 * anywhere; this script is the one-command way to give it a database.
 *
 * Set TEST_DATABASE_URL to point somewhere else (CI, docker compose). The
 * default matches the throwaway cluster described in docs/MIGRATIONS.md.
 *
 * The target database is WIPED by the suite. Never point this at production.
 */
import { execFileSync } from 'node:child_process';

const url = process.env.TEST_DATABASE_URL ?? 'postgresql://postgres@127.0.0.1:55433/hrtest';

if (/prod|railway|amazonaws/i.test(url)) {
  console.error(`Refusing to run: ${url} looks like a real database. This suite deletes every row.`);
  process.exit(1);
}

const run = (cmd: string, args: string[], env: NodeJS.ProcessEnv = {}) =>
  execFileSync(cmd, args, { stdio: 'inherit', env: { ...process.env, ...env } });

console.log(`\nIsolation suite → ${url}\n`);

// Bring the schema up to date first; the suite assumes the tables exist.
run('npx', ['prisma', 'migrate', 'deploy'], { DATABASE_URL: url });

run('npx', ['vitest', 'run', 'tests/isolation.test.ts', 'tests/platform.test.ts'], {
  DATABASE_URL: url,
  TEST_DATABASE_URL: url,
  // The app refuses to boot without these; values are irrelevant to isolation.
  JWT_SECRET: process.env.JWT_SECRET ?? 'isolation-suite-secret-key',
  JWT_REFRESH_SECRET: process.env.JWT_REFRESH_SECRET ?? 'isolation-suite-refresh-key',
});
