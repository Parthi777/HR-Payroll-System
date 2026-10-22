-- When a Master Control login last completed sign-in, for the console health view.
ALTER TABLE "AdminUser" ADD COLUMN "lastSignInAt" TIMESTAMP(3);
