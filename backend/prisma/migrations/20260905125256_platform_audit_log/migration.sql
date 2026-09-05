-- CreateTable
CREATE TABLE "PlatformAuditLog" (
    "id" TEXT NOT NULL,
    "platformUserId" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "targetTenantId" TEXT,
    "targetId" TEXT,
    "metadata" TEXT,
    "ipAddress" TEXT,
    "timestamp" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PlatformAuditLog_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "PlatformAuditLog_platformUserId_idx" ON "PlatformAuditLog"("platformUserId");

-- CreateIndex
CREATE INDEX "PlatformAuditLog_targetTenantId_idx" ON "PlatformAuditLog"("targetTenantId");

-- CreateIndex
CREATE INDEX "PlatformAuditLog_timestamp_idx" ON "PlatformAuditLog"("timestamp");

