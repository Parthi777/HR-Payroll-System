/**
 * Drop and rebuild the e2e database, then get out of the way.
 *
 * Run as the first half of the backend's start command rather than from the
 * Playwright config, and the distinction matters: the config module is
 * re-imported by every worker process, so a reset written there runs again
 * *after* the fixture is seeded and silently empties the database under the
 * tests. A webServer command runs once.
 */
import { resetDatabase } from './database';

resetDatabase();
console.log('[e2e] database rebuilt');
