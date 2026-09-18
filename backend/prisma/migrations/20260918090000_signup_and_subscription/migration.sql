-- Self-serve signup, and what a dealership pays.
--
-- Both tables live above tenancy: a signup exists before there is a workspace,
-- and a subscription is the platform's billing record for one. Neither carries
-- a `tenantId` column, so the tenant-scoping extension treats them as global.
--
-- Purely additive; nothing existing is touched. Dealers created before this
-- have no Subscription row, which reads as "not on a self-serve plan".
CREATE TABLE "SignupRequest" (
    "id" TEXT NOT NULL,
    "companyName" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "contactName" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "phone" TEXT NOT NULL,
    "staffCount" INTEGER,
    "branchCount" INTEGER,
    "planCode" TEXT NOT NULL,
    "note" TEXT,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "reviewedById" TEXT,
    "reviewedAt" TIMESTAMP(3),
    "reviewNote" TEXT,
    "workspaceId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SignupRequest_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "SignupRequest_status_idx" ON "SignupRequest"("status");
CREATE INDEX "SignupRequest_createdAt_idx" ON "SignupRequest"("createdAt");

CREATE TABLE "Subscription" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "planCode" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'PENDING_PAYMENT',
    "amountPaise" INTEGER NOT NULL,
    "payToken" TEXT NOT NULL,
    "periodEnd" TIMESTAMP(3),
    "razorpayOrderId" TEXT,
    "razorpayPaymentId" TEXT,
    "paidAt" TIMESTAMP(3),
    "paidById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Subscription_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "Subscription_workspaceId_key" ON "Subscription"("workspaceId");
CREATE UNIQUE INDEX "Subscription_payToken_key" ON "Subscription"("payToken");
CREATE UNIQUE INDEX "Subscription_razorpayOrderId_key" ON "Subscription"("razorpayOrderId");
CREATE UNIQUE INDEX "Subscription_razorpayPaymentId_key" ON "Subscription"("razorpayPaymentId");
