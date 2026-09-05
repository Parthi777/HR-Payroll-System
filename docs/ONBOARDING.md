# Onboarding a dealer

One platform administrator account signs in, creates a dealer, and hands over
that dealer's login. Everything a dealer needs is created in a single step, so
there is never a half-made customer waiting on a follow-up.

```
  platform administrator  ──creates──▶  dealer (tenant)
   owner@yourco.com                      · workspace address (subdomain)
   POST /api/platform/auth/login         · Head Office branch, department,
                                           designation, General Shift
                                          · first SUPER_ADMIN login
                                          ──▶ hand the credentials over
```

## 1. Create the platform administrator (once, ever)

This is the account that onboards dealers. It is created from the command line
because at that point there is nobody to authorise it.

```bash
npx tsx scripts/create-platform-admin.ts \
  --email you@yourco.com --name "Your Name" --password '<12+ characters>'
```

Re-running with the same email updates the name and password — that is also how
you reset it if the password is lost.

## 2. Sign in to the platform

```http
POST /api/platform/auth/login
{ "email": "you@yourco.com", "password": "…" }
→ { "token": "…", "name": "Your Name" }
```

The token lasts 8 hours. Send it as `Authorization: Bearer <token>` on every
platform call below.

## 3. Create a dealer

```http
POST /api/platform/tenants
{
  "slug":  "bhavani-motors",
  "name":  "Bhavani Motors",
  "admin": { "name": "Ravi Kumar", "email": "ravi@bhavani.com", "password": "…" }
}
→ 201
{ "tenant": { "slug": "bhavani-motors", "adminEmail": "ravi@bhavani.com",
              "loginUrl": "https://bhavani-motors.yourapp.com/login", … } }
```

`slug` becomes the dealer's subdomain, so it must be a DNS label — lowercase
letters, digits and hyphens. It is **immutable**: it appears in their URL and in
their S3 object paths. The name can be changed later; the address cannot.

The administrator password must be at least 12 characters. That account can see
every employee's salary.

Hand the dealer their `loginUrl`, email and password.

## 4. Add further logins to a dealer

```http
POST /api/platform/tenants/:id/admins
{ "name": "HR Manager", "email": "hr@bhavani.com", "password": "…", "role": "HR_MANAGER" }
```

Roles: `SUPER_ADMIN`, `HR_MANAGER`, `BRANCH_MANAGER`, `PAYROLL_ADMIN`, `CASHIER`.
Defaults to `HR_MANAGER`. Dealers can also add their own users from inside their
workspace — this is for setting up the first few.

## 5. Suspend or resume

```http
PATCH /api/platform/tenants/:id/status   { "status": "SUSPENDED" }
```

Suspension takes effect **immediately**, not when tokens expire: every request
re-checks the tenant's status, so existing sessions stop working at once and new
sign-ins are refused with a clear message.

## Other platform endpoints

| Endpoint | Purpose |
|---|---|
| `GET /api/platform/tenants` | every dealer, with status and headcount |
| `GET /api/platform/tenants/:id` | one dealer, with its admin accounts |
| `PATCH /api/platform/tenants/:id` | rename (slug stays fixed) |
| `GET /api/platform/audit` | platform actions, newest first; `?tenantId=` to filter |

## The two surfaces do not overlap

This is deliberate and tested:

- A **platform token is rejected by every dealer endpoint** (403). Platform staff
  onboard dealers; they have no route into a dealer's payroll or employee data.
- A **dealer's token is rejected by every platform endpoint** (403).
- The platform console shows a dealer's *admin accounts and headcount* — never
  their employees, attendance or payroll.

Platform requests run in a `PLATFORM` context, which the tenant-scoping Prisma
extension passes through unscoped. That is the one intended hole in the scoping,
which is why it is confined to `routes/platform.routes.ts` and why the checks
above are asserted in `tests/platform.test.ts`.

## Audit

Every platform action is recorded in `PlatformAuditLog` with the actor, the
dealer, the IP and a timestamp: `TENANT_CREATED`, `TENANT_ADMIN_CREATED`,
`TENANT_SUSPENDED`, `TENANT_RESUMED`, `TENANT_RENAMED`. Passwords are never
recorded — a test asserts that.

This is the only place where one account can affect every customer, so it is the
most closely recorded part of the system.
