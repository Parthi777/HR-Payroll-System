# Browser tests

Playwright, driving the real stack: a real Fastify backend on a real Postgres,
with the Next dev server in front of it. The seams are the point — a page that
renders what an endpoint actually returned, a filter applied server-side, a
session that has to survive a navigation. A mocked API would test none of that.

## Running them

```bash
cd web
npm run e2e            # headless
npm run e2e:headed     # watch it happen
npm run e2e -- --ui    # pick through them interactively
npm run e2e:report     # the last run's HTML report
```

The only prerequisite is the throwaway Postgres from `docs/MIGRATIONS.md`, on
port 55433 — the same one the backend suite uses.

Playwright starts everything else itself, on ports that are deliberately not the
dev ones (API 3399, web 3400), so a dev server can keep running beside a test
run without either disturbing the other.

## What the run does

1. **Rebuilds the database.** `hre2e` is dropped and migrated from scratch. This
   happens as the first half of the backend's start command, not in the
   Playwright config: the config module is re-imported by every worker process,
   so a reset written there runs *again* after the fixture is seeded and empties
   the database under the tests.
2. **Seeds through the API** (`global-setup.ts` → `seed.ts`). Nothing is written
   with Prisma directly. The activity log only exists because real endpoints
   wrote it, and seeding rows by hand would let the page pass against history
   the application could never have produced.
3. **Signs in once** (`auth.setup.ts`) and shares that session with every spec.
   The login form itself is tested separately, without it.

## The client IP

Sign-in is rate-limited to five attempts per ten minutes per IP, and every
request here comes from 127.0.0.1. Rather than turn a real security control off
to make the fixture fit, each test sends its own `X-Forwarded-For` — which the
backend trusts, because in production it runs behind a proxy. That is what a
room full of real users looks like, and it leaves the limiter armed.

## Waiting

Filtering is a round trip, and the page keeps the previous rows in place while
it waits. Tests use `settled()`, which waits for the results region to report
`aria-busy="false"` — the same signal a screen reader gets. Reading the list
without it means reading the previous filter's answer.
