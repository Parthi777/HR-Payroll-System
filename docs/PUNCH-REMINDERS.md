# Punch reminders

The app telling people to clock in and out, so a forgotten punch stops being
something HR discovers on the 1st of next month.

Four pushes a day at most, and never to someone who has already done the thing
being asked.

| When | Kind | Says |
|---|---|---|
| 15 min before the shift starts | `PUNCH_IN_EARLY` | "Shift starts at 09:00 — fifteen minutes to go." |
| At the shift start | `PUNCH_IN_START` | "Your shift has started and you have not punched in." |
| 15 min after | `PUNCH_IN_LATE` | Names the minute the day turns late, or says it already has. |
| The dealer's evening time (19:30) | `PUNCH_OUT` | "Leaving now? Check out before you go. Still working? Check out when you leave." |

The three punch-in reminders are keyed to **each employee's own shift**, so a
night guard on 22:00 hears from the app at 21:45 rather than at nine in the
morning. The evening sweep is **one fixed time for the whole dealership**,
which is what was asked for: people recognise "it's half seven" in a way they
do not recognise a time computed from their roster.

## Who is skipped, and why it matters

Nobody is reminded when they are not due in:

- a Sunday or a configured holiday (both are paid weekly-offs);
- approved leave covering that date;
- before their joining date, or while deactivated;
- once they have punched in — the punch-in three stop immediately;
- an employee with no FCM token (nothing to push to, and no ledger row either,
  so installing the app at lunchtime still gets them tomorrow's).

The evening sweep additionally skips **night shifts**: theirs is only beginning
around then, and the day they might have left open is yesterday's row, which
the sweep is not looking at.

Each of those is a way to push a notification at someone who is asleep, on
leave, or already at their desk — and an app that does that gets its
notifications switched off, which costs every later reminder too.

## The third reminder's wording

Whether "you are late" is true at shift start + 15 depends on the dealer's
grace period, so the message is written from it:

- grace longer than 15 minutes → "Check in before 09:20 or this day is marked late."
- grace of 15 or less → "Your shift started at 09:00, so this day is now marked late."

Telling someone with three minutes in hand that they are already late is the
kind of small lie that teaches people to ignore the next message.

## The evening time is deliberately 19:30

It sits before `TenantSettings.manualPunchLatest` (20:00 by default) — the
latest check-out an employee may type when settling a forgotten day themselves.
A reminder after that cut-off would reach someone who can no longer fix the
problem without HR.

## How it runs

An in-process timer started by `start()` in `server.ts` (not `buildServer()`,
so the tests never open one), waking **every minute**. A minute is the
resolution "15 minutes before the shift" is specified at; anything coarser
cannot say it. The work per tick is three indexed queries per dealer, and
nothing at all for the ~1400 minutes of the day when nothing is due.

Not BullMQ: repeatable jobs need Redis and this deployment has none.

Tenants are listed as the platform and entered one at a time with
`runInTenant`, never swept in one unscoped query — `runUnscoped` has exactly
one reviewed caller in this codebase and a scheduler is not a second one. One
dealer's failure is logged and skipped rather than ending the sweep.

### Sending exactly once

`AttendanceReminder` is a ledger, unique on
`(tenantId, employeeId, date, kind)`. The row is written **before** the push,
and that insert is the lock:

- a restart mid-morning re-runs the tick and loses the insert, so sends nothing;
- two instances during a Railway deploy race on it, and only one wins;
- a crash between the write and the push costs one reminder, which is the
  cheaper failure — a duplicate is a person who stops trusting notifications.

Rows are kept. "Why did nobody warn me?" is answerable from them.

### Catch-up windows

A reminder may still fire up to **10 minutes** after its time (30 for the
evening sweep). Long enough that a deploy at 08:59 does not silently swallow
the morning's reminders; short enough that a server down until lunchtime does
not come back and tell everyone their shift is starting.

## Switching it off

| Where | What |
|---|---|
| Settings → Attendance policy → Punch reminders | Per dealer, in Master Control. |
| `TenantSettings.punchOutReminderAt` | The evening time, same screen. |
| `ATTENDANCE_REMINDERS=off` | Platform kill switch — the scheduler never starts. |
| `PUNCH_REMINDERS=off` / `PUNCH_OUT_REMINDER_AT` | Platform defaults for a dealer with no settings row. |

## Where the code is

| Thing | Where |
|---|---|
| The sweep, the messages, the ledger write | `backend/src/services/attendance/reminders.service.ts` |
| Started and stopped | `backend/src/server.ts` |
| Settings | `TenantSettings.punchRemindersOn`, `.punchOutReminderAt` |
| Tests | `backend/tests/punch-reminders.test.ts` |
