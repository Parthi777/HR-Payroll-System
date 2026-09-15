-- The latest time an employee may type as a check-out on a manual punch.
-- Additive with a default, so existing rows need no backfill and the deploy
-- that applies this keeps serving throughout.
ALTER TABLE "CompanySettings" ADD COLUMN "manualPunchLatest" TEXT NOT NULL DEFAULT '20:00';
