-- Sign-up asks for the dealership's GSTIN, and can take the email from Google.
ALTER TABLE "SignupRequest" ADD COLUMN "gstNumber" TEXT;
ALTER TABLE "SignupRequest" ADD COLUMN "emailFromGoogle" BOOLEAN NOT NULL DEFAULT false;
