/**
 * Punch reminders — the app telling people to clock in and out.
 *
 * Four pushes a day, at most, and only to someone who has not already done the
 * thing being asked:
 *
 *   • 15 minutes before their shift starts  — while being on time is still possible
 *   • at their shift start
 *   • 15 minutes after                      — naming the minute the day turns late
 *   • at the dealer's evening time (19:30)  — to anyone still checked in
 *
 * The punch-in three are keyed to each employee's own shift, so a night guard
 * on 22:00 hears from the app at 21:45, not at nine in the morning. The evening
 * sweep is one fixed time for the whole dealership, which is what was asked
 * for: people recognise "it's half seven" in a way they do not recognise a time
 * computed from their roster.
 *
 * Nobody is reminded on a Sunday, on a holiday, on approved leave, before their
 * joining date, or after they have punched — the whole value of a nudge is that
 * it only arrives when it is useful, and an app that pushes on a rest day gets
 * its notifications switched off.
 *
 * Delivery is FCM push and nothing else. WhatsApp would cost a template per
 * person per day for a message that is only useful in the next ten minutes,
 * and an in-app Notification row would mean ~290 rows a day per dealer for
 * something nobody reads twice.
 */
import type { PrismaClient } from '@prisma/client';
import { requireTenantId, runAsPlatform, runInTenant } from '../../context/tenant-context.js';
import { dayKey, formatHHMM, minutesSinceMidnight, parseHHMM, startOfDay } from '../../utils/time.js';
import { logger } from '../../utils/logger.js';
import { pushToEmployee } from '../push.service.js';
import { getTenantPolicy } from '../settings/tenant-settings.service.js';

export type ReminderKind = 'PUNCH_IN_EARLY' | 'PUNCH_IN_START' | 'PUNCH_IN_LATE' | 'PUNCH_OUT';

/** Minutes either side of the shift start at which each punch-in nudge is due. */
export const PUNCH_IN_OFFSETS: { kind: ReminderKind; offset: number }[] = [
  { kind: 'PUNCH_IN_EARLY', offset: -15 },
  { kind: 'PUNCH_IN_START', offset: 0 },
  { kind: 'PUNCH_IN_LATE', offset: 15 },
];

/**
 * How late a tick may run and still send.
 *
 * The scheduler wakes every minute, so in the normal case a reminder goes out
 * within sixty seconds of its time. This window is for the abnormal case: a
 * deploy, a restart, a tick that overran. Ten minutes is long enough that a
 * redeploy at 08:59 does not silently swallow the whole morning's reminders,
 * and short enough that a server down until lunchtime does not come back and
 * tell everyone their shift is starting.
 */
export const CATCH_UP_MINUTES = 10;

/**
 * The evening sweep gets a longer one. It fires once, it is the only reminder
 * of its kind, and arriving at 19:55 instead of 19:30 still does its job —
 * whereas "your shift starts in 15 minutes" half an hour late is a lie.
 */
export const PUNCH_OUT_CATCH_UP_MINUTES = 30;

/** One reminder that went out, for logging and for the tests to read. */
export interface SentReminder {
  employeeId: string;
  kind: ReminderKind;
}

interface ReminderShift {
  startTime: string;
  gracePeriod: number | null;
  isNightShift: boolean;
}

/** Whether `nowMinutes` is inside the window that a reminder due at `dueMinutes` may fire in. */
const isDue = (nowMinutes: number, dueMinutes: number, catchUp: number) =>
  nowMinutes >= dueMinutes && nowMinutes < dueMinutes + catchUp;

function punchInMessage(kind: ReminderKind, shift: ReminderShift): { title: string; body: string } {
  const start = shift.startTime;
  const grace = shift.gracePeriod ?? 0;
  const lateAt = formatHHMM(parseHHMM(start) + grace);

  if (kind === 'PUNCH_IN_EARLY') {
    return {
      title: `Shift starts at ${start}`,
      body: 'Fifteen minutes to go. Punch in from the app as soon as you reach the branch.',
    };
  }
  if (kind === 'PUNCH_IN_START') {
    return {
      title: 'Your shift has started',
      body: `It is ${start} and you have not punched in yet. Open the app and check in.`,
    };
  }
  // The third and last one. Whether it can still be beaten depends on the
  // dealer's grace period, and saying "you are late" to someone who has three
  // minutes left would be wrong — so it names the minute instead.
  const stillInTime = PUNCH_IN_OFFSETS[2].offset < grace;
  return {
    title: 'You have not punched in',
    body: stillInTime
      ? `Check in before ${lateAt} or this day is marked late.`
      : `Your shift started at ${start}, so this day is now marked late. Check in as soon as you can.`,
  };
}

const PUNCH_OUT_MESSAGE = {
  title: 'Do not forget to punch out',
  body:
    'Leaving now? Check out before you go. Still working? Please check out when you leave — ' +
    'a day left open has to be raised by hand and approved before it is paid.',
};

/**
 * Send one reminder, exactly once.
 *
 * The ledger row is written BEFORE the push, and its unique constraint is what
 * makes this safe: two server instances, or one instance either side of a
 * restart, race on the insert and only the winner sends. Writing it afterwards
 * would mean a crash between the two re-sending on the next tick.
 *
 * The other order — send, then record — is also wrong in the cheaper direction:
 * a lost push is a person not reminded, while a duplicate is a person who stops
 * trusting the notifications.
 */
async function sendOnce(
  prisma: PrismaClient,
  employeeId: string,
  date: Date,
  kind: ReminderKind,
  message: { title: string; body: string },
): Promise<SentReminder | null> {
  try {
    await prisma.attendanceReminder.create({
      data: { employeeId, date, kind, tenantId: requireTenantId() },
    });
  } catch (err) {
    // P2002 — already sent, which is the expected outcome of a restart and of
    // a second instance, not an error. Everything else is worth hearing about,
    // but never worth stopping the rest of the sweep for.
    if ((err as { code?: string })?.code !== 'P2002') {
      logger.warn({ err, employeeId, kind }, 'reminder ledger write failed');
    }
    return null;
  }
  await pushToEmployee(prisma, employeeId, message.title, message.body);
  return { employeeId, kind };
}

/**
 * One dealer's due reminders. Must be called inside that tenant's context —
 * every query below is scoped by it.
 *
 * `now` is a parameter rather than read from the clock so the tests can stand
 * at 08:45 on a Tuesday without waiting for one.
 */
export async function sweepTenantReminders(prisma: PrismaClient, now: Date = new Date()): Promise<SentReminder[]> {
  const policy = await getTenantPolicy(prisma);
  if (!policy.attendance.punchRemindersOn) return [];

  const today = startOfDay(now);
  const tomorrow = new Date(today);
  tomorrow.setDate(tomorrow.getDate() + 1);
  const nowMinutes = minutesSinceMidnight(now);

  const employees = await prisma.employee.findMany({
    where: {
      status: 'ACTIVE',
      // No token, no reminder — and no ledger row either, so someone who
      // installs the app at lunchtime still gets tomorrow's.
      fcmToken: { not: null },
      joiningDate: { lt: tomorrow },
    },
    select: {
      id: true,
      shift: { select: { startTime: true, gracePeriod: true, isNightShift: true } },
    },
  });
  if (employees.length === 0) return [];

  const [holidays, attendance, leaves] = await Promise.all([
    prisma.holiday.findMany({ where: { date: { gte: today, lt: tomorrow } }, select: { date: true } }),
    prisma.attendance.findMany({
      where: { date: { gte: today, lt: tomorrow } },
      select: { employeeId: true, checkIn: true, checkOut: true },
    }),
    prisma.leave.findMany({
      where: { status: 'APPROVED', fromDate: { lt: tomorrow }, toDate: { gte: today } },
      select: { employeeId: true },
    }),
  ]);

  // Sundays and holidays are weekly-offs: nobody is due in, so nobody is
  // nudged. Someone who works one anyway still gets the evening punch-out
  // reminder, because by then they demonstrably have a day open.
  const isRestDay = now.getDay() === 0 || holidays.some((h) => dayKey(h.date) === dayKey(today));
  const onLeave = new Set(leaves.map((l) => l.employeeId));
  const punchByEmployee = new Map(attendance.map((a) => [a.employeeId, a]));
  const punchOutDue = parseHHMM(policy.attendance.punchOutReminderAt);

  const sent: SentReminder[] = [];

  for (const emp of employees) {
    const shift = emp.shift;
    if (!shift) continue;
    const punch = punchByEmployee.get(emp.id);

    if (!punch?.checkIn && !isRestDay && !onLeave.has(emp.id)) {
      const startMinutes = parseHHMM(shift.startTime);
      for (const { kind, offset } of PUNCH_IN_OFFSETS) {
        if (!isDue(nowMinutes, startMinutes + offset, CATCH_UP_MINUTES)) continue;
        const one = await sendOnce(prisma, emp.id, today, kind, punchInMessage(kind, shift));
        if (one) sent.push(one);
      }
    }

    // Still checked in this evening. Night shifts are left out: theirs is only
    // beginning around now, and the day they might have left open is
    // yesterday's row, which this sweep is not looking at.
    if (
      punch?.checkIn &&
      !punch.checkOut &&
      !shift.isNightShift &&
      isDue(nowMinutes, punchOutDue, PUNCH_OUT_CATCH_UP_MINUTES)
    ) {
      const one = await sendOnce(prisma, emp.id, today, 'PUNCH_OUT', PUNCH_OUT_MESSAGE);
      if (one) sent.push(one);
    }
  }

  return sent;
}

/**
 * Every dealer's due reminders.
 *
 * Tenants are listed as the platform and then entered one at a time, rather
 * than swept in one unscoped query. That is deliberate: `runUnscoped` has
 * exactly one reviewed caller in this codebase (WhatsApp inbound, which cannot
 * know its tenant yet), and a scheduler that reads every dealer's employees at
 * once would be a second. This one always knows whose rows it wants.
 *
 * One dealer's failure is logged and skipped, never allowed to end the sweep —
 * a missing shift or a bad settings row must not cost everyone else their
 * reminders.
 */
export async function runReminderSweep(prisma: PrismaClient, now: Date = new Date()): Promise<number> {
  const tenants = await runAsPlatform('reminder-scheduler', () =>
    prisma.tenant.findMany({ where: { status: 'ACTIVE' }, select: { id: true } }),
  );

  let total = 0;
  for (const tenant of tenants) {
    try {
      const sent = await runInTenant(
        { tenantId: tenant.id, subjectId: 'reminder-scheduler', role: 'SUPER_ADMIN' },
        () => sweepTenantReminders(prisma, now),
      );
      total += sent.length;
      if (sent.length > 0) logger.info({ tenantId: tenant.id, sent: sent.length }, 'punch reminders sent');
    } catch (err) {
      logger.warn({ err, tenantId: tenant.id }, 'punch reminder sweep failed for tenant');
    }
  }
  return total;
}

/**
 * Wake once a minute and send what is due.
 *
 * A minute is the resolution the reminders are specified at — "15 minutes
 * before the shift" is not a thing a five-minute ticker can say. The work per
 * tick is three indexed queries per dealer and nothing at all for the ~1400
 * minutes of the day when nothing is due.
 *
 * Not BullMQ: repeatable jobs need Redis, and this deployment has none (see
 * CLAUDE.md on REDIS_URL). The ledger is what makes an in-process timer safe
 * enough without one — see `sendOnce`.
 *
 * Returns a stop function. Started from `start()` in server.ts and not from
 * `buildServer()`, so the tests, which build the real app in-process, never
 * start a timer or push to a real phone.
 */
export function startReminderScheduler(prisma: PrismaClient): () => void {
  if (process.env.ATTENDANCE_REMINDERS === 'off') {
    logger.info('punch reminders disabled (ATTENDANCE_REMINDERS=off)');
    return () => {};
  }

  // A sweep that overruns must not have a second one land on top of it: both
  // would read the same un-punched employees, and the ledger would then be the
  // only thing between the pair of them and a duplicate push.
  let running = false;
  const tick = async () => {
    if (running) return;
    running = true;
    try {
      await runReminderSweep(prisma);
    } catch (err) {
      logger.warn({ err }, 'punch reminder sweep failed');
    } finally {
      running = false;
    }
  };

  const timer = setInterval(tick, 60_000);
  // Do not hold the process open on shutdown; Railway's SIGTERM should not have
  // to wait out a timer that is asleep 59 seconds in every 60.
  timer.unref();
  void tick();

  logger.info('punch reminders on (every minute)');
  return () => clearInterval(timer);
}
