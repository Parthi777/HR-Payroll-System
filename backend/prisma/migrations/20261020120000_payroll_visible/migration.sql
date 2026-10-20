-- Whether employees see their payslips and a monthly punch/leave statement in
-- the app. Off for every existing dealer: sharing pay with staff is each
-- dealer's decision, made in Settings, not something an update turns on.
ALTER TABLE "CompanySettings" ADD COLUMN "payrollVisibleToEmployees" BOOLEAN NOT NULL DEFAULT false;
