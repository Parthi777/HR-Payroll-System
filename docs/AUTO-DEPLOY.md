# Deploying: push to `main`

**This is connected and in force.** Both services build from
`Parthi777/HR-Payroll-System` and deploy on every push to `main`. To ship:

```bash
git push origin main      # this is the deploy
```

**Do not use `railway up`** — see "Why `railway up` no longer works" below.

It was connected on 2026-09-08, and the rest of this page is the record of how,
kept because it is what to redo if a service is ever recreated.

Before that, both services were deployed by `railway up`, which uploads a
snapshot of a local directory — so pushing to `main` changed nothing in
production until somebody ran two more commands, and twice production sat a
commit behind the repo without anything looking wrong. That is the problem this
removed.

## How it was connected, in the browser

Connecting a repo needs the Railway GitHub App authorised against
`Parthi777/HR-Payroll-System`, which is an OAuth flow. The CLI has no command
for it (`railway service` can link, delete, redeploy and restart — not connect a
source), so these steps are the dashboard's.

For **each** of the two services — `backend` and `web`:

1. Railway → project **HR-Payroll** → the service → **Settings → Source**.
2. **Connect Repo** → `Parthi777/HR-Payroll-System` → branch **`main`**.
3. **Root Directory**: `backend` for the backend service, `web` for the web one.
   This is what replaces `--path-as-root`; without it Railway builds the whole
   monorepo and neither service starts.
4. **Watch Paths**: `/backend/**` on the backend, `/web/**` on the web service.
   Without these, every push rebuilds both — an Android-only commit would
   restart the API and re-run migrations for nothing.

Nothing else needs retyping. `railway.json` lives inside each service's root
directory, so the build and start commands come across with it:

| Service | Build | Start |
|---|---|---|
| backend | `npm run build` | `npx prisma migrate deploy && node dist/server.js` |
| web | `npm run build` | `npm run start` |

Environment variables are stored on the service, not in the source, so they are
untouched by the switch.

## The consequence worth deciding on deliberately

The backend's start command runs `npx prisma migrate deploy` on every deploy.
Right now a human chooses the moment that happens, because a human runs
`railway up`. After this change, **merging a migration to `main` applies it to
the production database unattended.**

That is fine for an additive migration. It is not fine for every migration:
`docs/TENANCY-CUTOVER.md` describes a contract migration whose "only rollback is
restore-from-backup", and the expand/backfill/contract sequence there depends on
a deploy failing at a chosen point while somebody watches.

So either:

- keep migrations off `main` until you intend them to run — review the
  `backend/prisma/migrations/` diff before merging, the way the cutover runbook
  assumes; or
- point the services at a `production` branch instead of `main`, and merge into
  it when you mean to deploy. Auto-deploy then still removes the forgotten-
  deploy problem, without making every merge a database change.

The first is simpler and is the right default while one person is merging. The
second is what to switch to once more than one person is.

**In force today: the first.** The services watch `main`, so a migration merged
to `main` runs against the production database on the next deploy, unattended.
Review the `backend/prisma/migrations/` diff before merging — that review is the
only thing standing between a merge and a schema change in production.

## Verifying a deploy actually shipped

Two checks, and the second is the one that means anything.

**Did it build?**

```bash
railway deployment list --service backend
railway deployment list --service web
```

A push deploys BOTH services at the *identical* timestamp — that is how to tell
a push from two CLI uploads, which land seconds apart. Wait for `SUCCESS`;
`BUILDING` and `DEPLOYING` are not outcomes, and `FAILED` is silent from outside.

**Is the new code actually serving?**

Neither `SUCCESS` nor `/api/health` proves this — health answers exactly the same
on old code, which is why a failed deploy looks like a healthy service. Probe a
route that is *new in this deploy* and watch its status change. When the
tenant-storage work shipped:

```bash
curl -s -o /dev/null -w "%{http_code}\n" -X PATCH \
  https://backend-production-0b26.up.railway.app/api/platform/tenants/probe/storage
# 404 before (no such route) -> 401 after (route exists, auth refuses)
```

Pick the equivalent for whatever shipped: a route that did not exist before, hit
without credentials, moving 404 -> 401/403. Do **not** probe
`/api/auth/admin/login` — it is rate-limited to 5 attempts per 10 minutes per IP,
and a probe burns a real allowance.

## Why `railway up` no longer works

This page originally said `railway up` would keep working afterwards as an
escape hatch for an urgent fix. **It does not, and that line cost two failed
deployments on 2026-09-14** before anyone checked why.

Once a service has a **Root Directory** set (step 3 above), `railway up backend
--path-as-root --service backend` fails during the build:

```
Error: Failed to read app source directory
    No such file or directory (os error 2)
nixpacks exited with an error
```

The upload already makes `backend/` the archive root, and the service then
applies its own root directory on top — so the build looks for `backend/backend`
and finds nothing. The form is right (it is Railway's own documented example);
it is the Root Directory setting that makes it wrong here.

A failed deploy is harmless: the previous SUCCESS deployment keeps serving, and
`/api/health` stays up throughout — which is exactly why this can fail without
looking like anything. Check `railway deployment list --service backend` rather
than assuming an upload that printed a build-log URL actually built.

**The escape hatch is a push.** There is no faster path that works.

## Checked before recommending this

Two things would have broken the switch, and neither does:

- **Nothing outside each service directory is needed at build time.** Both
  `tsconfig.json` files declare a `@shared/*` alias pointing at `../shared/*`,
  which a root-directory build cannot see — but nothing imports it
  (`grep -rn "from '@shared" backend/src web/src` finds zero), so the alias is
  dead config rather than a dependency.
- **No untracked file is load-bearing.** `railway up` uploads whatever is in the
  directory, including files git ignores; a GitHub build only gets what is
  committed. The only ignored files under `backend/` and `web/` are `dist/`,
  `.next/`, `node_modules/` and test artefacts — all rebuilt by the build.
  No secret or config file is being smuggled in by the upload.
