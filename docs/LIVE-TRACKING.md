# Live tracking

Where checked-in staff are, and how long anyone has been away from their
branch's geofence. Off for every dealer until switched on in Settings.

## When someone is tracked

A day is tracked when **all** of these hold at check-in:

- the dealer has **Settings → Attendance policy → Live location tracking** on
  (`TenantSettings.liveTrackingOn`);
- the employee is not **Exempt from live tracking** on their record
  (`Employee.trackingExempt`, set by Super Admin / HR Manager only);
- the check-in came from the employee's **own phone**. Kiosk punches and
  manual / selfie punches are never tracked.
- the employee has **agreed to the app's consent screen**
  (`Employee.consentVersion` is set). Only app 0.9.6+ asks, so this is also what
  keeps an older app — which has no tracking service — from being marked
  tracked and reading "no signal" all day.

That moment is stored as `Attendance.trackingFrom`. The window closes at:

| What happened | Window ends at |
|---|---|
| Checked out (app, kiosk, HR correction) | `checkOut` |
| Dealer switched tracking off, or exempted the employee mid-shift | `trackingTo` (set to that moment) |
| Day shift with no check-out | end of the attendance date, company time |
| Night shift with no check-out | 16 hours after check-in |

Nothing is collected outside the window, and fixes outside it are dropped at
upload.

## Consent

The first time the app is opened — before sign-in — it shows a consent screen
(`ui/screens/consent/ConsentScreen.kt`): what it collects (selfie and face
match, location at check-in for the geofence, live location during the shift
when the employer turns it on), who sees it, and links to `/terms` and
`/privacy`. Two boxes must be ticked — the terms and privacy policy, and the
photo/location consent — and "I do not agree" closes the app.

- Stored on the phone (`ConsentPrefs`), then recorded against the employee after
  sign-in: `POST /api/me/consent { version, acceptedAt }` →
  `Employee.consentVersion` / `consentAt`. The first agreement to a version keeps
  its time; a reinstall does not overwrite it.
- Master Control's employee form shows whether and when each person agreed.
- Changing what the screen says? Raise `ConsentPrefs.CURRENT_VERSION` and
  everyone is asked again on their next open.

## What the employee sees

- **At check-in**, the confirmation dialog: "Checked in at 09:02 AM — Your
  location is being monitored until you check out." Then, on Android 10+, one
  request for "Allow all the time" (optional; see below).
- **While tracked**, a persistent notification ("Location monitoring on") and a
  line under Today on the Home screen.
- **At check-out**: "Checked out at 06:15 PM — Location monitoring has stopped."
  The notification goes away.
- **Signing out** stops tracking and discards anything not yet uploaded.

## The phone

`LocationTrackingService` is a foreground service (type `location`) started by
`TrackingController` right after a check-in, while the app is on screen,
because Android 12+ will not start one from the background.

- A fix every **2 minutes** (`TRACK_INTERVAL_SEC`), at high accuracy when the
  phone has precise location.
- Each fix is queued in Room (`gps_points`) and uploaded in batches of up to
  200, so a phone with no signal loses nothing; the queue drains when it is back.
- Location switched off / on is recorded as `GPS_OFF` / `GPS_ON`; starting
  without permission records `NO_PERMISSION`. Fixes from a mock-location app are
  flagged (`isMock`).
- The server has the last word: an upload that answers `tracking: false`
  (checked out on a kiosk, switched off, exempted) stops the phone. Opening the
  app asks `GET /attendance/tracking` and starts or stops to match.
- After a reboot or an app update, `TrackingBootReceiver` resumes — only with
  "Allow all the time", which Android requires to start a location service in
  the background. Without it, tracking resumes the next time the app is opened,
  and the gap reads as no signal.

## Away alerts

When someone tracked has been more than `awayAlertMeters` (100 m) **past the
fence edge** for `awayAlertAfterMin` (10 min), the server pushes to their phone:
"You have been outside your office location for 12 min (about 450 m away).
Please go back to your workstation." Their reporting manager — or, with none,
the branch's approvers — gets the same as a Master Control bell entry and push.
It repeats every `awayAlertRepeatMin` (30 min) while they stay out; coming back
in and leaving again is a new trip with its own first alert.

Checked on each upload in `ingestTrack()` (`awayAlertDue()` is the pure rule).
`Attendance.awayAlertAt` records the last alert, claimed with a compare-and-set
so overlapping uploads send one. Borderline readings and a phone gone quiet
never alert. All four settings are per dealer, under Settings → Live location
tracking.

## Field workers

`Employee.fieldWorker` (Super Admin / HR only, on the employee form): sales on
the road, service visits. They may check in and out anywhere — the fence does
not block, hold for approval, flag or log a violation (lateness still applies).
They are still tracked unless also exempt, but outside the fence they show as
**On field** (sky), never "away", get no away alerts, and are kept out of the
report's away totals and ranking (marked "Field" / "(field)").

## Why someone shows "no signal"

More than 6 minutes without a fix, and the phone never said GPS was off. In
practice: a battery saver killed the app (App info → Battery → "No
restrictions"), the app was swiped away or the phone restarted without "Allow
all the time", the phone is off, or it has no internet — in which case the fixes
are queued and the gap fills in when it reconnects.

## How away time is counted

`summarizeTrack()` in `backend/src/services/tracking/tracking.service.ts` is
pure and is the only implementation — the live page, the track detail and the
report all go through it.

1. Each fix is classified at upload with the same `checkGeofence()` as check-in.
   An OUTSIDE fix whose accuracy circle (capped at 150 m) still reaches the fence
   is **BORDERLINE**, and BORDERLINE counts as **inside** — a blurry reading near
   the edge is never time away.
2. Walk the rows in time order, starting in the check-in's geofence state. The
   time up to each row belongs to the state before it.
3. A fix vouches for at most **6 minutes** (three intervals). The rest of a
   longer gap is **no signal** — a dead phone, a killed app, a refused
   permission. It is never stored; it is the absence of rows.
4. After `GPS_OFF` / `NO_PERMISSION`, and for a mock fix, the time is **GPS off**
   for as long as it lasts, because the phone said why.
5. Each unbroken OUTSIDE stretch is an **away episode**, with the furthest any
   fix in it was beyond the fence edge.

Inside + away + GPS off + no signal = the tracked window (to the minute).

## Endpoints

| Route | Who |
|---|---|
| `POST /api/attendance/gps-log` | Employee only. `{ attendanceId, points ≤200, events ≤50 }` → `{ tracking, intervalSec, accepted, dropped }`. Idempotent on (attendance, kind, timestamp). 60/min per IP |
| `GET /api/attendance/tracking` | Employee. `{ enabled, intervalSec, attendanceId }` |
| `GET /api/admin/tracking/live?branchId=` | Super Admin, HR Manager, Branch Manager (own branch and direct reports). `{ enabled: false }` when off |
| `GET /api/admin/tracking/:attendanceId/track` | Same, plus `assertManages`. The day's path, events and summary |
| `GET /api/admin/reports/tracking?from&to&view=summary\|episodes&branchId&departmentId&designationId&format=json\|xlsx\|pdf` | Same roles. At most 31 days. Downloads are audited (`TRACKING_REPORT_EXPORTED`) |

**Payroll Admin is left out on purpose**: where people stood is not something
paying them needs.

## Master Control

**Live Tracking** (`/live-tracking`) polls every 30 seconds:

- the map — green inside, red away, grey GPS off / no signal; click a dot or a
  row for that person's path, red where it left the fence;
- **Away now**, longest first, with a running duration; **GPS off / no signal**;
- today's table — inside, away, times away, GPS off, no signal, last seen;
- the report — any range up to 31 days, per day or per away episode, as Excel
  or PDF.
- each person's **current address** and a **Track** button that flies the map
  to them (also "Google Maps" in their panel).
- click a **branch** (its label shows a count) for who is inside its fence right
  now — visitors from other branches included and tagged — and how its own
  staff are spread today, including those checked in without tracking.

### Addresses

`GET /api/admin/tracking/address?lat&lng` turns a fix into a short street
address with OpenStreetMap's Nominatim (`services/geofence/reverse-geocode.service.ts`).
Free and keyless, but its policy is one request a second with an identifying
User-Agent, so lookups are queued 1.1 s apart and cached per ~100 m square for
a week. Only coordinates leave the server — never a name. Point
`REVERSE_GEOCODE_URL` at another Nominatim-compatible service to change provider.

## Retention

Fixes older than `GPS_RETENTION_DAYS` (default 180) are deleted once a day by
`startTrackingRetention()`, started from `start()` in `server.ts`. A report for
a day whose fixes are gone shows the whole window as no signal.

## Known limits

- **Battery savers** on some phones (Xiaomi, Oppo, Vivo) kill background
  services regardless. The server shows it as no signal; HR can ask the
  employee to set the app's battery use to "No restrictions".
- **Mock-location detection** is what Android reports. It catches the common
  apps, not a rooted phone.
- Turning tracking **off and back on** the same day does not reopen a day that
  was closed; that employee's next check-in is tracked.
