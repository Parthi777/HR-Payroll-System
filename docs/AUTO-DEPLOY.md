# Deploying from GitHub instead of by hand

Today both services are deployed by `railway up`, which uploads a snapshot of a
local directory. That is why pushing to `main` changes nothing in production
until somebody remembers to run two more commands — and why, twice now,
production has sat a commit behind the repo without anything looking wrong.

Connecting each service to the repo removes that step: a merge to `main` builds
and deploys on its own.

## What has to happen in the browser

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

## Verifying it took

Push a trivial commit to the watched branch, then confirm both services built
from it — the deployment's source in the dashboard should name the commit rather
than reading "CLI upload". Then probe, as ever, rather than trusting the UI:

```bash
curl -s -o /dev/null -w "%{http_code}\n" https://backend-production-0b26.up.railway.app/api/health
curl -s -o /dev/null -w "%{http_code}\n" https://web-production-2b851.up.railway.app/activity
```

`railway up` keeps working afterwards, so an urgent fix can still be pushed
straight from a laptop without waiting on a merge.

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
