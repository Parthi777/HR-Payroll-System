-- A tablet at a branch that staff punch on.
--
-- Tenant-scoped, and tied to one branch: pairing is what decides where the
-- device is, and a punch made on it uses that branch's coordinates rather than
-- trusting a browser's idea of its location.
--
-- Additive; nothing existing is touched. A dealership with no kiosk has no rows
-- here and behaves exactly as before.
CREATE TABLE "KioskDevice" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "branchId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "pairingHash" TEXT,
    "pairingExpiresAt" TIMESTAMP(3),
    "pairedAt" TIMESTAMP(3),
    "lastSeenAt" TIMESTAMP(3),
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "tokenVersion" INTEGER NOT NULL DEFAULT 1,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "KioskDevice_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "KioskDevice_tenantId_branchId_idx" ON "KioskDevice"("tenantId", "branchId");

ALTER TABLE "KioskDevice" ADD CONSTRAINT "KioskDevice_branchId_fkey"
    FOREIGN KEY ("branchId") REFERENCES "Branch"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
