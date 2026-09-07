/**
 * The e2e database, rebuilt from nothing on every run.
 *
 * This has to happen before the backend starts, not in globalSetup: the server
 * reads the tenant list as it boots, so it cannot come up against a database
 * with no tables. Playwright evaluates the config before it launches the
 * webServers, which makes config load the one moment early enough.
 */
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { E2E_DATABASE_URL } from './config';

const NAME = 'hre2e';

/** Drop and recreate the database. Refuses anything not named hre2e. */
export function resetDatabase(): void {
  const url = E2E_DATABASE_URL;
  if (!url.endsWith(`/${NAME}`) || /prod|railway|amazonaws/i.test(url)) {
    throw new Error(`Refusing to wipe ${url} — the e2e database must be named ${NAME}`);
  }

  // FORCE: a previous run's server may still hold a connection.
  execFileSync('psql', [url.replace(/\/[^/]+$/, '/postgres'), '-q',
    '-c', `DROP DATABASE IF EXISTS ${NAME} WITH (FORCE);`,
    '-c', `CREATE DATABASE ${NAME};`,
  ], { stdio: 'pipe' });

  execFileSync('npx', ['prisma', 'migrate', 'deploy'], {
    cwd: path.resolve(__dirname, '../../backend'),
    stdio: 'pipe',
    env: { ...process.env, DATABASE_URL: url },
  });
}
