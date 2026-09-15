# Security review — September 2026

Review of the HR Payroll system: Fastify/Prisma backend, Next.js admin web app,
and the tenancy layer they share. Carried out 14–15 September 2026 against
commit `9dc74ad` and the work that followed it.

Seven findings. **All seven are fixed and deployed.** One was confirmed
exploitable against production before it was closed. What remained open when this was
written — dependency upgrades needing a major version — has since been done, and
both applications are now free of critical and high advisories. What is still
outstanding is listed under [Still open](#still-open).

> Keep this in the repository. It describes a live production system in detail,
> so it is not a document to publish or send outside the team as it stands.

## Method

Code was read rather than scanned: authentication and session handling, the
tenant-isolation layer, every route's guard, file upload and retrieval, the
inbound webhook, and the web app's rendering and token handling. `npm audit` for
dependencies. Where a finding could be tested safely against production without
changing data, it was — one was, and the result is below.

Every fix carries a regression test, and each test was checked by reinstating
the original behaviour to confirm the test fails. A test that passes against the
bug it is meant to catch is worse than no test, and two of these did at first.

## Findings

| # | Finding | Severity | Status |
|---|---|---|---|
| 1 | Webhook verification accepted unauthenticated callers | **High** — confirmed live | Fixed `d82edde` |
| 2 | Unauthenticated 60 MB download buffered into memory | Medium | Fixed `d82edde` |
| 3 | 30 dependency CVEs across both apps | Medium | Cleared `3f754c7`, `ea774de`, and the Next 16 upgrade |
| 4 | Stored file paths resolved without containment | Low | Fixed `d82edde` |
| 5 | Refresh tokens shared the access-token secret | Low | Fixed `4714d49` |
| 6 | `/auth/refresh-token` had no rate limit | Low | Fixed `4714d49` |
| 7 | Workspace lookup allowed customer enumeration | Low | Fixed `4714d49` |

---

### 1. The webhook verified callers it should have refused

**Confirmed against production.** Meta's verification handshake compared:

```ts
q['hub.verify_token'] === env.META_WHATSAPP_VERIFY_TOKEN
```

This deployment runs Twilio, so that variable is absent in production and the
comparison was `undefined === undefined`. Anyone who simply omitted the
parameter passed:

```
GET /api/whatsapp/webhook?hub.mode=subscribe&hub.challenge=ARBITRARY_ECHO_TEST
→ HTTP 200   ARBITRARY_ECHO_TEST
```

A *wrong* token correctly returned 403, which is why this survived review by
eye: the check appears to work whenever anyone tests it the obvious way.

**Bounded, but real.** Someone could complete Meta's webhook verification for
this URL and attach their own Meta app. They could not then do anything with it:
the POST side refuses every payload without `META_WHATSAPP_APP_SECRET`, which is
also unset, so no employee data moves. It remains a check that passed the people
it existed to stop.

**Fixed** by refusing when no token is configured. The decision moved out of the
route into `verifyChallenge(query, expected)` — see [A note on testing](#a-note-on-testing),
because the first attempt at a test could not reproduce the fault.

### 2. An unauthenticated download that buffered 60 MB per request

`GET /api/app/download` read the entire published APK into a Buffer and sent it.
No authentication, no rate limit, on a single backend instance. Concurrent
requests are heap exhaustion, and the egress is billed to us.

**Fixed:** it redirects to a signed S3 URL. The link stays permanent and always
current; S3 serves the bytes. Rate-limited, as is the webhook handshake.

### 3. Dependency CVEs

`npm audit` reported 21 in the backend and 9 in the web app. Transitive updates
cleared most without touching either `package.json`:

| | Before | After |
|---|---|---|
| backend | 21 (2 critical) | **8** |
| web | 9 (2 critical) | **2** |

What is left needs a major version bump and is covered under [Still open](#still-open).

### 4. Stored file paths resolved without containment

Three routes serve a file whose path comes out of the database — a claim
receipt, an employee photo, a check-in selfie. Each did:

```ts
if (url.startsWith('/uploads/')) path.resolve(process.cwd(), url.slice(1))
```

`/uploads/../../etc/passwd` satisfies that guard.

**Not exploitable as the code stands.** Every write to those columns is
server-generated, and the employee update parses through a Zod object schema,
which strips unknown keys — so the path fields cannot be posted in. It is one
careless schema change from being a file-read primitive.

**Fixed** with `resolveUploadPath`, which compares using `path.relative` rather
than a string prefix. A prefix test also accepts a sibling directory whose name
merely begins the same way (`/uploads-old/`), which is the usual way this check
is written wrong. It answers 404, so a probe learns nothing about what exists.

### 5. Refresh tokens shared the access-token secret

`JWT_REFRESH_SECRET` had been required by `config/env.ts` since the first commit
and was never read. Both kinds of token were signed with `JWT_SECRET`, so:

- the only thing separating an access token from a refresh token was the `typ`
  claim, and
- the two could never be invalidated apart — rotating the secret to end every
  session's ability to refresh also invalidated every access token in the field.

**Fixed** with a second `@fastify/jwt` registration under `namespace: 'refresh'`.
Both secrets were already set in production and differ, so the split took effect
on deploy.

**The transition deliberately does not sign anyone out.** Employee access tokens
last 7 days and refresh tokens 30. Rejecting the old signature outright would
have logged out every field employee as their week ran out. Tokens signed the
old way are still accepted until the last one expires on its own; the branch is
marked `REMOVE AFTER 2026-10-15` and has a test to be deleted with it. The `typ`
guard sits behind that path, which is what stops an old access token — signed
with exactly the secret the legacy branch accepts — being spent as a refresh.

### 6. `/auth/refresh-token` had no rate limit

Unauthenticated, and it verifies a token and reads the database. Every other
auth route was throttled. **Fixed:** 30 per 10 minutes per address — loose
enough for a branch coming online together on one office connection, since a
device refreshes at most once every 12 hours (admin) or 7 days (employee).

### 7. Workspace lookup allowed customer enumeration

`GET /api/auth/workspace/:slug` confirms whether a slug belongs to a customer
and returns their name, unauthenticated and unthrottled.

It has to be public — it is what puts a dealer's name on their own sign-in page
before there is a session — so this cannot be hidden without removing the
feature. **Fixed** by throttling it: fine for real sign-ins, far too slow to walk
a dictionary of company names through.

## A note on testing

Two of these tests passed against the bug they were written to catch, and were
rewritten.

The webhook test was the instructive one. Locally
`META_WHATSAPP_VERIFY_TOKEN` is set to an empty string, so the faulty line read
`undefined === ''` — false, refused, apparently correct. The vulnerable
condition, an *absent* variable, exists only in production. No test that read the
real environment could have caught it.

The fix was to make the decision a pure function taking `expected` as an
argument, so a test can state the production condition outright instead of
hoping the machine reproduces it. **Local configuration differing from
production is the recurring theme of this review** — it also produced a
misdiagnosis of the Drive folder work earlier in the same week. Any security
check whose behaviour depends on an environment variable should be tested
against explicit values, not ambient ones.

## What the system does well

Worth recording, because it is unusual and it shaped how much of the review
found nothing:

- **Tenant isolation is the strongest part of the system.** A single Prisma
  extension scopes every query, fails closed when no tenant context is present,
  and is covered by a dedicated isolation suite plus a route-coverage guard that
  refuses to let a new route exist without an isolation decision. Exactly one
  documented bypass.
- **No raw SQL anywhere** — there is no SQL injection surface.
- **Authentication is carefully built.** The tenant is resolved before
  credentials are checked, so one dealer's phone number cannot match another
  dealer's employee. Refresh rebuilds its claims from the database, so
  deactivation takes effect immediately rather than at token expiry.
- **The webhook's payload signature check is done correctly** — raw bytes are
  captured before parsing. Re-serialising a parsed body is the usual mistake and
  it was avoided.
- Zod validation on inputs with unknown keys stripped; no `dangerouslySetInnerHTML`
  or `eval` in the web app; no user-supplied URL rendered as a link; payslip
  access checked against the requesting employee; phone numbers masked in logs;
  plaintext password storage removed with a test preventing its return.

Access tokens are held in `localStorage`, which is exfiltratable by an XSS. With
no dangerous rendering anywhere and React escaping by default the surface is
small, and the 12-hour admin token limits the window. Recorded as an accepted
trade-off rather than a finding.

## Still open

### Dependency upgrades needing a major version — **done**

Closed after this review was first written. `fastify` 4 → 5 (with the
`@fastify/*` plugins and `fastify-plugin`), `bcrypt` 5 → 6, `next` 14 → 16 and
`react` 18 → 19.

| | At review | Now |
|---|---|---|
| backend | 21 (2 critical) | **2**, both moderate |
| web | 9 (2 critical) | **0** |

The two backend moderates that remain are `exceljs` and `uuid`. Their only
offered fix is `exceljs` 4 → 3.4.0, which is a downgrade, and the issue is a
missing buffer bounds check in `uuid` v3/v5/v6 when a caller supplies a buffer —
report export does not.

Two things are worth carrying forward from doing it:

- **`bcrypt` verifies real passwords**, so 5 → 6 was checked rather than
  assumed: a hash generated under 5 was kept and confirmed to still verify under
  6, correct password true and wrong password false. The `$2b$` format is
  unchanged.
- **Neither typecheck nor build catches this class of upgrade.** Both were clean
  on Fastify 5 before a single test ran; the database suites then failed all at
  once on a rejected logger option. On the web side the build was clean while
  the sign-in page rendered blank, and only the browser tests noticed. Multipart
  had no test at all — it carries every selfie, face enrolment and claim receipt
  — so one was written before trusting the plugin's two-major jump.

> **Correction to an earlier version of this report.** The Next.js image
> advisory was recorded here as unreachable, on the grounds that `next/image` is
> never imported and there was no `images` configuration. The second half was
> wrong: the check had been run against `next.config.ts`, which does not exist —
> the file is `next.config.mjs` — so the grep found nothing and the absence was
> read as evidence. `images.remotePatterns` was configured, for
> `res.cloudinary.com`, and `/_next/image` is served whether or not any
> component imports `next/image`. The advisory should have been treated as
> reachable. It is now moot — Next is upgraded and the configuration removed,
> Cloudinary having been replaced by S3 and Drive — but the reasoning error is
> the point: *a search that finds nothing is only evidence if you have confirmed
> you searched the right place.*

### Documented controls that did not exist — **resolved**

CLAUDE.md's security section described four controls the code does not
implement. Each has been settled as either a fix or an honest description; none
was left as a promise.

**Device binding** — dropped as a claim, by decision. `Employee.deviceId` exists
and nothing reads it. Attendance fraud is already stopped by the two controls
that *are* enforced and are harder to defeat — the strict face-match gate, which
refuses a check-in whose selfie does not match the signed-in employee, and the
geofence. Binding a device adds little on top of that and turns every new or
replaced phone into a support call.

**GPS encrypted at rest** — reworded. Column-level encryption would have to be
undone on every read: geofence distance and every location report are computed
from these coordinates, and ciphertext cannot be filtered in the database at
all. The database provider encrypts at rest at the disk level, and that is what
the document now says.

**Certificate pinning** — dropped as a claim, and a real defect found in its
place. Pinning is the wrong control here: the API is on a platform-managed
domain whose certificate rotates, and a pin that outlives its certificate
bricks every installed app until an update ships.

The defect: `network_security_config.xml` lived in `src/main`, carrying cleartext
exceptions for a LAN address, the emulator host and localhost, with a comment
asking whoever cut a release to remove them first. There was no release source
set to remove them from, so **every released APK shipped those exceptions**. It
now lives in `src/debug`, and `src/main` states `cleartextTrafficPermitted="false"`
outright — which matters rather than merely documenting, because minSdk is 24
and Android blocks cleartext by default only from API 28. Verified by building
both variants and reading the merged resource: debug has the exceptions,
release has none.

**Rate limiting "OTP endpoints"** — OTP was removed from this system some time
ago, so the line described nothing. Replaced with the nine limits actually
configured, cross-checked against the routes.

### Lower-priority hardening

- Refresh tokens cannot be revoked individually; rotating `JWT_REFRESH_SECRET`
  now ends all of them without touching access tokens, which is the granularity
  that was missing. Per-session revocation would need a stored token identifier.
- No Content-Security-Policy header on the web app.

## Verification

```
273 tests passing   — 136 without a database, 137 against Postgres and Redis
backend and web production builds clean
```

Each fix was confirmed against production after deploy:

| Check | Before | After |
|---|---|---|
| Webhook bypass | `200` + echoed challenge | `403` |
| APK download | 60 MB buffered | `302` to signed URL |
| Path traversal | guard passed `../` | contained, `404` |
| `/refresh-token` (bad token) | — | `401` |
| Workspace lookup | unthrottled | `200`, throttled |
