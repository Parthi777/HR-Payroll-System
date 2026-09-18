-- Two-step verification for the platform console.
--
-- The console account creates, suspends and reads across every dealer, and it
-- signed in with an email and a password alone. These columns hold a TOTP
-- secret, its replay guard, hashed recovery codes and a wrong-code lockout.
--
-- Additive and nullable (the counter defaults to 0), so existing rows are
-- untouched. Every existing account has no secret, which the sign-in reads as
-- "not enrolled yet": the next sign-in walks them through enrolment.
ALTER TABLE "PlatformUser" ADD COLUMN "totpSecret" TEXT;
ALTER TABLE "PlatformUser" ADD COLUMN "totpPendingSecret" TEXT;
ALTER TABLE "PlatformUser" ADD COLUMN "totpEnabledAt" TIMESTAMP(3);
ALTER TABLE "PlatformUser" ADD COLUMN "totpLastStep" INTEGER;
ALTER TABLE "PlatformUser" ADD COLUMN "recoveryCodes" TEXT;
ALTER TABLE "PlatformUser" ADD COLUMN "mfaFailures" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "PlatformUser" ADD COLUMN "mfaLockedUntil" TIMESTAMP(3);
