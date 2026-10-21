-- "Forgot password?" for Master Control: the hash of an emailed one-time link
-- and its expiry. Empty for everyone until someone asks.
ALTER TABLE "AdminUser" ADD COLUMN "resetLinkHash" TEXT;
ALTER TABLE "AdminUser" ADD COLUMN "resetLinkExpiresAt" TIMESTAMP(3);
CREATE UNIQUE INDEX "AdminUser_resetLinkHash_key" ON "AdminUser"("resetLinkHash");
