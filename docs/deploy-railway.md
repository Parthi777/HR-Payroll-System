# Deploying the Backend to Railway

The backend (`backend/`) is a Node + Fastify + Prisma API. These steps deploy it on
[Railway](https://railway.app) and give you a public HTTPS URL the Android app and web
dashboard can point at.

> The Android app and Next.js web app are **not** deployed to Railway — they just need
> the backend's public URL. Web can go on Vercel/Railway; Android ships as an APK.

---

## 1. Push the latest code to GitHub

Railway deploys from your GitHub repo, so commit and push first:

```bash
git add -A
git commit -m "Railway deploy config"
git push
```

## 2. Create the Railway project

1. Go to **railway.app → New Project → Deploy from GitHub repo**.
2. Select **Parthi777/HR-Payroll-System**.
3. Open the service → **Settings → Root Directory** → set to `backend`
   (the repo is a monorepo; Railway must build only the backend).

Railway reads `backend/railway.json` automatically:
- Build: `npm run build` (runs `prisma generate` + `tsc`)
- Start: `npx prisma db push` (creates tables) then `node dist/server.js`

## 3. Add a persistent database (SQLite volume)

The app uses SQLite. Railway containers have an **ephemeral** filesystem, so without a
volume your data resets on every deploy. Add one:

1. Service → **Variables** → add:
   ```
   DATABASE_URL = file:/data/prod.db
   ```
2. Service → **Settings → Volumes → New Volume**, mount path `/data`.

> **Prefer Postgres?** Add a Railway **Postgres** plugin instead, then in
> `backend/prisma/schema.prisma` change `provider = "sqlite"` → `"postgresql"`, set
> `DATABASE_URL` to the Postgres connection string Railway provides, and redeploy.
> No other code changes are needed (enums are already modelled as strings).

## 4. Set environment variables

Service → **Variables**:

| Variable | Value | Notes |
|---|---|---|
| `DATABASE_URL` | `file:/data/prod.db` | (from step 3) |
| `JWT_SECRET` | *(long random string)* | min 16 chars |
| `JWT_REFRESH_SECRET` | *(long random string)* | min 16 chars |
| `NODE_ENV` | `production` | |
| `DEV_FIXED_OTP` | `123456` | **demo only** — lets OTP login work without an SMS provider. Remove once a real WhatsApp/SMS provider is wired. |

Do **not** set `PORT` — Railway injects it and the server already reads it.

## 5. Deploy

Railway builds and deploys automatically. When it's live, **Settings → Networking →
Generate Domain** gives you a public URL like:

```
https://hr-payroll-system-production.up.railway.app
```

The database auto-seeds on first boot (admin + demo employee) — see `src/bootstrap.ts`.
For the full sample dataset (multiple employees, today's attendance), run once:
Railway service → **⋯ → Run a command** → `npm run db:seed`.

## 6. Point the apps at the deployed URL

**Android** — `android/local.properties`:
```
API_BASE_URL=https://YOUR-APP.up.railway.app/api/
```
Rebuild/install. (HTTPS, so the cleartext network-security config is no longer needed
for the prod URL.)

**Web** — set `NEXT_PUBLIC_API_URL=https://YOUR-APP.up.railway.app/api` in the web env.

## Test it

```bash
curl https://YOUR-APP.up.railway.app/api/health
# {"status":"ok","ts":"..."}

# Admin login
curl -X POST https://YOUR-APP.up.railway.app/api/auth/admin/login \
  -H 'Content-Type: application/json' \
  -d '{"email":"admin@hrpayroll.local","password":"admin123"}'
```

## Notes & limitations

- **Selfie uploads** are written to the container filesystem (`backend/uploads`), which is
  ephemeral unless on the volume. For production, wire Cloudinary (see CLAUDE.md).
- **Redis / BullMQ** (WhatsApp queue) isn't required to boot. Add a Railway Redis plugin
  and set `REDIS_URL` when you enable WhatsApp.
- SQLite + volume runs a **single instance**. Switch to Postgres before scaling horizontally.
