-- Punch reminders, and the approver's half-day / full-day call.
--
-- Three things, all additive:
--
-- 1. "Attendance"."approvedAs" — how much of a held day the approver decided it
--    was worth (FULL / HALF), or NULL where nobody overrode anything. Every
--    existing row is NULL, so every existing day is still derived from its
--    punch times exactly as before and no payslip already issued can move.
--
-- 2. "AttendanceReminder" — the ledger that stops a reminder being sent twice.
--    The unique index is the lock, not a tidiness measure: the scheduler has no
--    memory across a restart, so the insert is what decides whether a push goes
--    out at all. See prisma/schema.prisma for the reasoning.
--
-- 3. Two settings columns. Reminders default ON, because they are the reason
--    this migration exists, and a dealer who dislikes them has a switch.

ALTER TABLE "Attendance" ADD COLUMN "approvedAs" TEXT;

ALTER TABLE "CompanySettings" ADD COLUMN "punchRemindersOn" BOOLEAN NOT NULL DEFAULT true;
ALTER TABLE "CompanySettings" ADD COLUMN "punchOutReminderAt" TEXT NOT NULL DEFAULT '19:30';

CREATE TABLE "AttendanceReminder" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "employeeId" TEXT NOT NULL,
    "date" TIMESTAMP(3) NOT NULL,
    "kind" TEXT NOT NULL,
    "sentAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AttendanceReminder_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "AttendanceReminder_tenantId_employeeId_date_kind_key"
    ON "AttendanceReminder"("tenantId", "employeeId", "date", "kind");

CREATE INDEX "AttendanceReminder_tenantId_date_idx"
    ON "AttendanceReminder"("tenantId", "date");

ALTER TABLE "AttendanceReminder"
    ADD CONSTRAINT "AttendanceReminder_employeeId_fkey"
    FOREIGN KEY ("employeeId") REFERENCES "Employee"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
