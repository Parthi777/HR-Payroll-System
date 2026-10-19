-- Two-step verification for Master Control accounts.
--
-- Every dealer administrator and manager signed in with an email and a password
-- alone. These are the same columns PlatformUser gained in
-- 20260917120000_platform_two_step: a TOTP secret, its replay guard, hashed
-- recovery codes and a wrong-code lockout.
--
-- Additive and nullable (the counter defaults to 0), so existing rows are
-- untouched. No existing account has a secret, which sign-in reads as "not
-- enrolled yet": the next sign-in walks them through enrolment.
ALTER TABLE "AdminUser" ADD COLUMN "totpSecret" TEXT;
ALTER TABLE "AdminUser" ADD COLUMN "totpPendingSecret" TEXT;
ALTER TABLE "AdminUser" ADD COLUMN "totpEnabledAt" TIMESTAMP(3);
ALTER TABLE "AdminUser" ADD COLUMN "totpLastStep" INTEGER;
ALTER TABLE "AdminUser" ADD COLUMN "recoveryCodes" TEXT;
ALTER TABLE "AdminUser" ADD COLUMN "mfaFailures" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "AdminUser" ADD COLUMN "mfaLockedUntil" TIMESTAMP(3);
