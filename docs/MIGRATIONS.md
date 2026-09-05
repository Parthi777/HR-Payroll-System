# Database migrations

The backend now deploys with `prisma migrate deploy` (see `backend/railway.json`).
Before that, it ran `prisma db push --accept-data-loss` on every boot, which force-synced
the schema and would silently drop data to make a deploy succeed.

## One-time step before the next production deploy

Production already has all 19 tables, so `migrate deploy` would try to apply the `0_init`
baseline and fail with "relation already exists". Mark the baseline as already applied,
**once**, before deploying:

```bash
railway run --service backend npx prisma migrate resolve --applied 0_init
```

Then verify:

```bash
railway run --service backend npx prisma migrate status
# expect: "Database schema is up to date!"
```

If `migrate status` instead reports drift, production has diverged from
`prisma/schema.prisma` — stop and reconcile before deploying. Do not "fix" it with
`db push`.

## Everyday workflow

```bash
# 1. edit prisma/schema.prisma
# 2. generate a migration locally against a scratch database
npx prisma migrate dev --name add_tenant_id

# 3. commit prisma/migrations/<timestamp>_add_tenant_id/
# 4. deploy — Railway runs `prisma migrate deploy` on boot
```

Never run `prisma db push` against production again. It does not record what it did, so the
migration history and the live schema drift apart silently.

## What changed on failure

`migrate deploy` **refuses** a migration it cannot apply cleanly, so the container will
crash-loop instead of starting with a wrong schema. That is deliberate: a failed deploy is
recoverable, a silently altered production schema is not. Check the deploy logs, fix the
migration, redeploy.

## Testing a migration against a copy of production

Always do this before any migration that changes existing columns:

```bash
pg_dump "$PROD_DATABASE_URL" > /tmp/prod.sql
createdb scratch && psql scratch < /tmp/prod.sql       # verify the restore itself works
DATABASE_URL=postgresql://localhost/scratch npx prisma migrate deploy
```

## Local scratch Postgres

Docker is the documented path (`docker compose up -d`). Without Docker, a throwaway cluster:

```bash
export PATH="/opt/homebrew/opt/postgresql@16/bin:$PATH"
initdb -D /tmp/pgdata -U postgres --auth=trust
pg_ctl -D /tmp/pgdata -o "-p 55433 -c unix_socket_directories=" -l /tmp/pg.log start
psql -h 127.0.0.1 -p 55433 -U postgres -c "CREATE DATABASE hrpayroll_scratch;"
export DATABASE_URL="postgresql://postgres@127.0.0.1:55433/hrpayroll_scratch"
```

Note: Postgres unix sockets fail when the socket directory path exceeds 103 bytes, which is
why `unix_socket_directories=` (TCP only) is set above.

---

# Tests

```bash
npm test              # unit suites — no database needed, isolation suite skips
npm run test:isolation   # cross-tenant isolation against a real Postgres
```

`npm run test:isolation` applies migrations then runs `tests/isolation.test.ts`,
which boots the real Fastify app in-process, seeds two tenants whose data
deliberately collides (same employee code, phone, admin email, department name
and claim number), and asserts that neither can see the other. **It wipes the
target database**, and refuses to run against a URL that looks like production.

It defaults to the throwaway cluster above; override with `TEST_DATABASE_URL`.

## The coverage guard

`tests/isolation.test.ts` reads every registered route from `app.routeList` and
requires each to sit in exactly one bucket:

| Bucket | Meaning |
|---|---|
| `COVERED` | has an end-to-end cross-tenant assertion here |
| `NO_TENANT_DATA` | serves no tenant rows (health, login, APK download, webhooks) |
| `NOT_YET_ASSERTED` | inherits scoping from the Prisma extension, no test of its own yet |

**A newly added route lands in none and fails the suite**, which is the point:
adding an endpoint forces a decision about its tenancy. Shrink `NOT_YET_ASSERTED`
over time; never grow it without reading the route first.

## Why `TZ` is pinned in vitest.config.ts

The fixtures build calendar days with local-time constructors (`new Date(2026, 6, 1)`)
but punch instants with `Date.UTC(...)`. On a machine in IST those disagree by
5h30m, so days land either side of midnight and half-day, overtime and
"days served" all shift. Setting `COMPANY_TZ` alone is not enough — the process
timezone has to match too, or the suite passes in CI and fails on your laptop.
