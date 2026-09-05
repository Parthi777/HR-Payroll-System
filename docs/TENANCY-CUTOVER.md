# Tenancy cutover runbook

Turning the live single-company deployment into tenant #1. Every step below was
rehearsed against a database built from the pre-tenancy schema and populated
with rows, not just reasoned about.

**The contract migration is a one-way door.** Its only rollback is
restore-from-backup. Do not start without step 0.

---

## 0. Backup, and prove the backup works

```bash
pg_dump "$PROD_DATABASE_URL" > prod-$(date +%F).sql
createdb prodcheck && psql prodcheck < prod-$(date +%F).sql   # must restore clean
```

Skipping the *verify* half is how people discover their backup was unusable at
the worst possible moment.

## 1. Baseline the migration history — once, ever

Production already has the tables, so Prisma refuses to run against it:

```
Error: P3005  The database schema is not empty.
```

Mark the baseline as already applied:

```bash
railway run --service backend npx prisma migrate resolve --applied 0_init
```

## 2. Deploy — expand runs, contract stops

Push the branch and let Railway deploy. What happens, verified:

```
Applying migration `..._add_tenant_expand`     ← additive, succeeds
Applying migration `..._tenant_contract`       ← FAILS, 23502
  column "tenantId" of relation "AdminUser" contains null values
```

**This failure is correct and expected.** The contract cannot run until the
backfill has claimed the existing rows. The container crash-loops; no data is
touched. The expand migration has succeeded and is safe.

## 3. Backfill — manually, never on boot

```bash
railway run --service backend npx tsx scripts/backfill-tenant.ts \
  --slug dharani --name "Dharani Motors" --dry-run     # review the row counts
railway run --service backend npx tsx scripts/backfill-tenant.ts \
  --slug dharani --name "Dharani Motors"
```

Pick the slug carefully — it becomes the dealer's subdomain and is **immutable**.
The script runs in one transaction and ends by asserting zero NULL `tenantId`
remain. That assertion is what makes step 4 safe.

## 4. Clear the failed migration and redeploy

```bash
railway run --service backend npx prisma migrate resolve --rolled-back <contract-migration-name>
```

Redeploy. All migrations now apply, including the platform-console and
tenant-settings ones.

## 5. Verify

```bash
railway run --service backend npx prisma migrate status     # "up to date"
```

Then, in the app:

- The existing admin signs in **exactly as before** — no URL change, no new
  field. Their clients send no tenant slug, and the backend falls back to the
  only tenant. Verified end to end.
- Employees, codes, attendance and settings are unchanged.

## 6. Create the platform administrator

```bash
railway run --service backend npx tsx scripts/create-platform-admin.ts \
  --email you@yourco.com --name "Your Name" --password '<12+ chars>'
```

From here, onboarding is [docs/ONBOARDING.md](ONBOARDING.md).

---

## Before you onboard dealer #2

The single-tenant fallback in `requireTenantFromRequest` resolves a
slug-less sign-in to the only tenant. **It stops applying the moment a second
active tenant exists** — after that, a sign-in that names no workspace is
refused rather than guessed.

So before creating the second dealer, the clients must send the tenant:

- **Web** — set `APP_BASE_DOMAIN`, point `*.yourapp.com` at the web service with
  a wildcard certificate, and have the app send `X-Tenant-Slug` from its own
  subdomain.
- **Android** — add the company-code field to login and send the same header.

That is Phase 9. Until it lands, the platform console works and dealers can be
*created*, but only one can be **active** at a time without breaking sign-in.

## Rollback

| Step | Rollback |
|---|---|
| 1–2 (expand) | redeploy the previous image; the added columns are nullable and unused |
| 3 (backfill) | re-runnable; it only fills NULLs |
| 4 (contract) | **restore from the step 0 dump** — there is no other way back |
