/**
 * Build the world the browser tests expect, from an empty database.
 *
 * Everything here goes through the real API rather than Prisma, for two
 * reasons: the fixture is then exactly what the product would have produced,
 * and the audit entries the activity page is meant to display only exist
 * because a real endpoint wrote them. Seeding rows directly would let the page
 * pass against history the application could never create.
 *
 * The one exception is the platform account itself, which by definition cannot
 * be created through an API that requires a platform account — the same
 * bootstrap script an operator runs.
 */
import { execFileSync } from 'node:child_process';
import path from 'node:path';

const BACKEND = path.resolve(__dirname, '../../backend');

export const PLATFORM = {
  email: 'e2e@platform.test',
  name: 'Priya Platform',
  password: 'e2e-platform-password',
};

/** A second console account, so "filter by person" has more than one person. */
export const COLLEAGUE = {
  email: 'colleague@platform.test',
  name: 'Sam Colleague',
  password: 'e2e-colleague-password',
};

export const DEALERS = [
  { slug: 'bhavani-motors', name: 'Bhavani Motors' },
  { slug: 'kovai-cars', name: 'Kovai Cars' },
];

/** The dealer that gets renamed, suspended and resumed — the interesting one. */
export const BUSY_DEALER = DEALERS[0];
export const RENAMED_TO = 'Bhavani Motors Pvt Ltd';

/** The other dealer, whose name the colleague is the last to change. */
export const QUIET_DEALER = DEALERS[1];
export const QUIET_DEALER_FINAL_NAME = 'Kovai Cars & Co';

/**
 * Filler entries, so the log is longer than one page (50) and "Show older
 * entries" has something to fetch.
 */
export const PADDING_ENTRIES = 55;

export interface Seeded {
  apiUrl: string;
  dealerIds: Record<string, string>;
}

export async function seed(apiUrl: string, databaseUrl: string): Promise<Seeded> {
  execFileSync('npx', [
    'tsx', 'scripts/create-platform-admin.ts',
    '--email', PLATFORM.email, '--name', PLATFORM.name, '--password', PLATFORM.password,
  ], { cwd: BACKEND, stdio: 'pipe', env: { ...process.env, DATABASE_URL: databaseUrl } });

  const api = await client(apiUrl, PLATFORM.email, PLATFORM.password);

  const dealerIds: Record<string, string> = {};
  for (const dealer of DEALERS) {
    const { tenant } = await api.post('/platform/tenants', {
      slug: dealer.slug,
      name: dealer.name,
      admin: { name: 'Dealer Owner', email: `owner@${dealer.slug}.test`, password: 'dealer-owner-password' },
    });
    dealerIds[dealer.slug] = tenant.id;
  }

  const busy = dealerIds[BUSY_DEALER.slug];
  const quiet = dealerIds[DEALERS[1].slug];

  // Enough history to page through. Written first, so the interesting entries
  // below stay on the newest page where the tests look for them.
  for (let i = 0; i < PADDING_ENTRIES; i++) {
    await api.patch(`/platform/tenants/${quiet}`, { name: `${DEALERS[1].name} ${i}` });
  }

  // A spread of actions, so every filter and both tones have something to show.
  await api.post(`/platform/tenants/${busy}/admins`, {
    name: 'Second Login', email: `hr@${BUSY_DEALER.slug}.test`, password: 'dealer-second-password', role: 'HR_MANAGER',
  });
  await api.patch(`/platform/tenants/${busy}/status`, { status: 'SUSPENDED' });
  await api.patch(`/platform/tenants/${busy}/status`, { status: 'ACTIVE' });
  await api.patch(`/platform/tenants/${busy}`, { name: RENAMED_TO });

  // A second actor, who then does something of their own.
  await api.post('/platform/users', COLLEAGUE);
  const theirApi = await client(apiUrl, COLLEAGUE.email, COLLEAGUE.password);
  await theirApi.patch(`/platform/tenants/${quiet}`, { name: QUIET_DEALER_FINAL_NAME });

  return { apiUrl, dealerIds };
}

/** A minimal authenticated client — the seed needs no more than this. */
let seedIp = 0;

async function client(apiUrl: string, email: string, password: string) {
  // A distinct client IP per sign-in. Sign-in is rate-limited to 5 attempts per
  // 10 minutes per IP, and the backend trusts X-Forwarded-For — so this is the
  // same thing the backend suite does with freshIp(), rather than turning a
  // real security control off to make the fixture fit.
  const ip = `10.8.0.${++seedIp}`;
  const login = await fetch(`${apiUrl}/platform/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Forwarded-For': ip },
    body: JSON.stringify({ email, password }),
  });
  if (!login.ok) throw new Error(`seed: could not sign in as ${email} (${login.status})`);
  const { token } = (await login.json()) as { token: string };

  const send = async (method: string, path: string, body: unknown) => {
    const res = await fetch(`${apiUrl}${path}`, {
      method,
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}`, 'X-Forwarded-For': ip },
      body: JSON.stringify(body),
    });
    if (!res.ok) throw new Error(`seed: ${method} ${path} failed (${res.status}): ${await res.text()}`);
    return res.json();
  };

  return {
    post: (path: string, body: unknown) => send('POST', path, body),
    patch: (path: string, body: unknown) => send('PATCH', path, body),
  };
}
