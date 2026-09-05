# Per-dealer settings

Everything below used to be a deployment-wide environment variable, read once at
process start. With more than one dealer that no longer works: a dealer with a
different pay day, a different half-day window or a different employee-code
series needs its own value.

They now live on `TenantSettings` — one row per dealer, edited at
`GET`/`PUT /api/admin/company` by that dealer's own `SUPER_ADMIN` or
`HR_MANAGER`. **The environment variables survive as platform defaults**: they
seed a new dealer's row and back-stop a dealer that has no row yet, so a
single-tenant deployment behaves exactly as it did before.

## What a dealer can set

| Setting | Default | Effect |
|---|---|---|
| `name` `address` `phone` `email` `gstin` | empty | printed on payslips, registers and vouchers |
| `employeeCodePrefix` | `EMP` | the employee code series — two dealers can both run `EMP001` |
| `halfDayWindowStart` / `End` | `12:30` / `14:00` | a punch inside this window makes the day a half day |
| `lateRequiresApproval` | `true` | a late punch is held for the reporting manager before it is paid |
| `openPunchLookbackDays` | `7` | how far back a forgotten check-out blocks the next check-in |
| `monthDivisor` | `30` | per-day salary = monthly ÷ this |
| `clPerYear` | `12` | paid casual leave before it becomes LOP |
| `otHoursPerDay` | `10` | OT hours that add up to one day's pay |
| `payrollLateShiftAt` | `5` | late punches that push the pay date out |
| `payrollLateWithholdOver` | `8` | late punches that withhold the payslip |
| `payrollPayDay` / `payrollPayDayLate` | `5` / `8` | pay dates, day of the following month |
| `faceMatchThreshold` | `85` | minimum face-match score, **floor of 70** — below that the match stops meaning anything |

## External resources

Set at provisioning and not editable by the dealer, because changing one would
orphan files that already exist.

| Resource | New dealer | The original dealer |
|---|---|---|
| Rekognition collection | `<platform>-<slug>` | keeps the platform collection |
| S3 prefix | `t/<slug>/` | empty — objects stay at the bucket root |
| Drive parent folder | per dealer, else the platform folder | unchanged |
| WhatsApp | `SHARED` (platform number) or `OWN` | `SHARED` |
| APK (`app/latest.apk`) | **global** — one app for every dealer | — |

These are **stored, not derived from the slug**. That is deliberate: the first
dealer's faces are already enrolled in the platform collection and its selfies
already sit at the bucket root, so deriving the names would have meant
re-enrolling everyone and copying every object.

### Why the Rekognition collection matters most

The collection is the isolation boundary for faces. With one shared collection,
a search at dealer A could match a face enrolled by dealer B — so one dealer's
employee could be recognised as, or blocked by, another's. Each dealer now has
its own collection, and every call names it.

## Known gap: the company timezone

`timezone` is stored on `TenantSettings` and set at provisioning, but **nothing
reads it yet** — the company timezone is still deployment-wide in
`utils/time.ts`. It is therefore deliberately *not* exposed as an editable
setting: a control that silently does nothing is worse than no control.

Threading it means changing `minutesSinceMidnight` and `atCompanyTime`, which
every half-day, overtime and "days served" calculation depends on. That deserves
its own pass with the payroll tests in front of it, not a change tacked onto a
larger one. Until then, all dealers share one timezone — fine while they are in
one country, and the blocker to fix before they are not.

## Reading settings in code

```ts
const { attendance, payroll, resources } = await getTenantPolicy(prisma);
```

`getTenantPolicy` is scoped by the tenant filter, so it reads the caller's own
row. It is **not cached**: it is one indexed read, and a stale policy would mean
paying someone by yesterday's rules. Phase 8 moves it behind Redis, which is
shared across replicas and can be invalidated on write.

Pure functions take policy as a trailing optional argument defaulting to the
platform value (`resolveAttendanceStatus`, `effectiveStatus`,
`computeMonthlyPayroll`, `classifyDay`). That keeps them pure and testable, and
is why the existing unit tests still pass unchanged.

**The same policy must be used when a punch is recorded and when payroll
re-derives it** — otherwise a day reads `HALF_DAY` on one screen and `PRESENT`
on another. That is why the window is threaded all the way through
`classifyDay` rather than only at punch time.
