-- The dealer's accounting ERP as an integration client, and the outbox of
-- claim announcements it is sent.
--
-- Additive; nothing existing is touched. A dealership with no client has no
-- rows here and behaves exactly as before — claims are paid here as today.
CREATE TABLE "IntegrationClient" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "webhookUrl" TEXT,
    "paysClaims" BOOLEAN NOT NULL DEFAULT true,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "tokenVersion" INTEGER NOT NULL DEFAULT 1,
    "lastUsedAt" TIMESTAMP(3),
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "IntegrationClient_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "IntegrationClient_tenantId_idx" ON "IntegrationClient"("tenantId");

CREATE TABLE "IntegrationEvent" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "clientId" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "entityId" TEXT NOT NULL,
    "payload" JSONB NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "nextAttemptAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastError" TEXT,
    "deliveredAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "IntegrationEvent_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "IntegrationEvent_tenantId_status_nextAttemptAt_idx" ON "IntegrationEvent"("tenantId", "status", "nextAttemptAt");
CREATE INDEX "IntegrationEvent_tenantId_createdAt_idx" ON "IntegrationEvent"("tenantId", "createdAt");

ALTER TABLE "IntegrationEvent" ADD CONSTRAINT "IntegrationEvent_clientId_fkey"
    FOREIGN KEY ("clientId") REFERENCES "IntegrationClient"("id") ON DELETE CASCADE ON UPDATE CASCADE;
