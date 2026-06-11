# Deployment Guide — Railway

Deploys the **backend** (Fastify API) and **web** (Next.js) as two Railway services
backed by a managed **PostgreSQL** plugin. The **Android** app then points at the
backend's public URL. Selfies live in S3, claim files in Google Drive (or S3 fallback).

```
Android app ─┐
             ├─►  Backend service (Railway)  ─►  PostgreSQL (Railway plugin)
Web service ─┘            └─► S3 (selfies) · Google Drive (claims) · Twilio (WhatsApp)
```

Both `backend/` and `web/` already contain a `railway.json` (build + start commands),
so Railway just needs the repo, the root directory per service, and the env vars below.

---

## 0. Prerequisites
- A Railway account + the repo pushed to GitHub.
- The AWS keys (already working locally), Twilio creds, and — optionally — the
  Google Drive OAuth values (see below; claims fall back to S3 without them).

## 1. PostgreSQL + switch Prisma provider
1. In your Railway project: **New → Database → PostgreSQL**.
2. Change the datasource in [`backend/prisma/schema.prisma`](../backend/prisma/schema.prisma):
   ```prisma
   datasource db {
     provider = "postgresql"   // was "sqlite"
     url      = env("DATABASE_URL")
   }
   ```
   The enums are modelled as `String`, so they migrate to Postgres 1:1. The backend's
   start command runs `prisma db push`, so **no migration files are needed** — tables
   are created on first boot.
   > Local dev uses SQLite for zero-infra. Either keep this change only on your deploy
   > branch, or run the bundled Postgres (`docker-compose up db`) locally too.

## 2. Backend service
- **New → GitHub repo →** set **Root Directory = `backend`**.
- Railway reads `backend/railway.json` (build `npm run build`, start = `prisma db push` + `node dist/server.js`).
- **Variables:**
  | Key | Value |
  |---|---|
  | `DATABASE_URL` | `${{Postgres.DATABASE_URL}}` (reference the Postgres plugin) |
  | `NODE_ENV` | `production` |
  | `JWT_SECRET` | a strong 32+ char random string |
  | `JWT_REFRESH_SECRET` | a different strong random string |
  | `AWS_REGION` | `ap-south-1` |
  | `AWS_ACCESS_KEY_ID` / `AWS_SECRET_ACCESS_KEY` | your IAM keys |
  | `AWS_REKOGNITION_COLLECTION_ID` | `hr-payroll-faces` |
  | `AWS_S3_BUCKET` | `hr-payroll-selfies-8d345dca` |
  | `FACE_MATCH_THRESHOLD` | `85` |
  | `WHATSAPP_PROVIDER` | `twilio` (+ `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`, `TWILIO_WHATSAPP_FROM`) |
  | `GOOGLE_OAUTH_CLIENT_ID/SECRET/REFRESH_TOKEN`, `GOOGLE_DRIVE_PARENT_FOLDER_ID` | optional — claims use S3 if unset |
- `PORT` is injected by Railway automatically (the server already reads it).
- Deploy → note the public URL, e.g. `https://hr-backend-production.up.railway.app`.

## 3. Web service
- **New → same repo →** set **Root Directory = `web`** (reads `web/railway.json`).
- **Variables** (these are baked at build time, so set them before the first deploy):
  | Key | Value |
  |---|---|
  | `NEXT_PUBLIC_API_URL` | `https://<backend-url>/api` |
  | `NEXT_PUBLIC_SOCKET_URL` | `https://<backend-url>` |
  | `NEXT_PUBLIC_GOOGLE_MAPS_KEY` | optional (maps use Leaflet, no key needed) |
- Deploy → open the web URL → log in with the admin (see hardening below).

## 4. Android app → production backend
1. In `android/local.properties`:
   ```
   API_BASE_URL=https://<backend-url>/api/
   ```
   (HTTPS, so no cleartext network config needed.)
2. Build a signed release: configure a signing key, then `./gradlew bundleRelease`
   → upload the `.aab` to the Play Console (or `assembleRelease` for an APK).

## 5. Go-live hardening (do before real users)
- [ ] **Change the admin password** — `admin123` is the seeded default. Update the
      `AdminUser` row (or reseed) with a strong password.
- [ ] **Strong `JWT_SECRET` / `JWT_REFRESH_SECRET`** (not the `change_me…` dev values).
- [ ] **Remove the dev OTP bypass** — the blank-OTP block in
      [`auth.service.ts`](../backend/src/services/auth/auth.service.ts) `verifyOtp` is
      already auto-disabled when `NODE_ENV=production`, and the app now uses phone+password,
      so this path is unused — delete it for cleanliness.
- [ ] Rotate the AWS/Twilio keys if they were ever shared.
- [ ] (Optional) Restrict CORS `origin` to the web domain instead of reflecting all.
- [ ] (Optional) Add a Railway **Redis** plugin + `REDIS_URL` if you enable the BullMQ
      WhatsApp queue.

## Notes
- **Ephemeral disk:** Railway's filesystem is not persistent — that's fine because
  selfies go to S3 and claim files to Drive/S3 (the local-disk fallback is dev-only).
- **First boot** auto-creates the admin (`ensureSeedData`) so the web login works
  immediately on a fresh Postgres DB.
