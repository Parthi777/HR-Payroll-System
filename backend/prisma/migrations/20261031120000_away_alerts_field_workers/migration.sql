-- Away alerts (a push to someone tracked who has been well outside the fence
-- for a while, and to their manager) and field workers (staff who check in
-- anywhere). Alerts follow the dealer's live-tracking switch, so they do
-- nothing until tracking is on. Nobody becomes a field worker by an update.
ALTER TABLE "CompanySettings"
  ADD COLUMN "awayAlertOn" BOOLEAN NOT NULL DEFAULT true,
  ADD COLUMN "awayAlertMeters" INTEGER NOT NULL DEFAULT 100,
  ADD COLUMN "awayAlertAfterMin" INTEGER NOT NULL DEFAULT 10,
  ADD COLUMN "awayAlertRepeatMin" INTEGER NOT NULL DEFAULT 30;
ALTER TABLE "Employee" ADD COLUMN "fieldWorker" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "Attendance" ADD COLUMN "awayAlertAt" TIMESTAMP(3);
