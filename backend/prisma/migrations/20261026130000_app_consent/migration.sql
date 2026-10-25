-- The app's consent screen (terms, privacy, location and live tracking): which
-- version each employee agreed to, and when. Null for everyone until they open
-- an app version that asks.
ALTER TABLE "Employee" ADD COLUMN "consentVersion" INTEGER, ADD COLUMN "consentAt" TIMESTAMP(3);
