-- AlterTable
ALTER TABLE "AdminUser" ADD COLUMN     "tenantId" TEXT;

-- AlterTable
ALTER TABLE "Attendance" ADD COLUMN     "tenantId" TEXT;

-- AlterTable
ALTER TABLE "AuditLog" ADD COLUMN     "tenantId" TEXT;

-- AlterTable
ALTER TABLE "Branch" ADD COLUMN     "tenantId" TEXT;

-- AlterTable
ALTER TABLE "Claim" ADD COLUMN     "tenantId" TEXT;

-- AlterTable
ALTER TABLE "ClaimMessage" ADD COLUMN     "tenantId" TEXT;

-- AlterTable
ALTER TABLE "CompanySettings" ADD COLUMN     "tenantId" TEXT,
ALTER COLUMN "id" DROP DEFAULT;

-- AlterTable
ALTER TABLE "Department" ADD COLUMN     "tenantId" TEXT;

-- AlterTable
ALTER TABLE "Designation" ADD COLUMN     "tenantId" TEXT;

-- AlterTable
ALTER TABLE "Employee" ADD COLUMN     "tenantId" TEXT;

-- AlterTable
ALTER TABLE "GPSLog" ADD COLUMN     "tenantId" TEXT;

-- AlterTable
ALTER TABLE "GeofenceViolation" ADD COLUMN     "tenantId" TEXT;

-- AlterTable
ALTER TABLE "Holiday" ADD COLUMN     "tenantId" TEXT;

-- AlterTable
ALTER TABLE "Leave" ADD COLUMN     "tenantId" TEXT;

-- AlterTable
ALTER TABLE "LeaveBalance" ADD COLUMN     "tenantId" TEXT;

-- AlterTable
ALTER TABLE "Notification" ADD COLUMN     "tenantId" TEXT;

-- AlterTable
ALTER TABLE "Payslip" ADD COLUMN     "tenantId" TEXT;

-- AlterTable
ALTER TABLE "Shift" ADD COLUMN     "tenantId" TEXT;

-- AlterTable
ALTER TABLE "WhatsAppLog" ADD COLUMN     "tenantId" TEXT;

-- CreateTable
CREATE TABLE "Tenant" (
    "id" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'ACTIVE',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Tenant_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PlatformUser" (
    "id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "passwordHash" TEXT NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PlatformUser_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Tenant_slug_key" ON "Tenant"("slug");

-- CreateIndex
CREATE INDEX "Tenant_status_idx" ON "Tenant"("status");

-- CreateIndex
CREATE UNIQUE INDEX "PlatformUser_email_key" ON "PlatformUser"("email");

-- CreateIndex
CREATE INDEX "AdminUser_tenantId_idx" ON "AdminUser"("tenantId");

-- CreateIndex
CREATE UNIQUE INDEX "AdminUser_tenantId_email_key" ON "AdminUser"("tenantId", "email");

-- CreateIndex
CREATE INDEX "Attendance_tenantId_date_idx" ON "Attendance"("tenantId", "date");

-- CreateIndex
CREATE INDEX "Attendance_tenantId_approvalStatus_idx" ON "Attendance"("tenantId", "approvalStatus");

-- CreateIndex
CREATE INDEX "AuditLog_tenantId_timestamp_idx" ON "AuditLog"("tenantId", "timestamp");

-- CreateIndex
CREATE INDEX "AuditLog_tenantId_entity_idx" ON "AuditLog"("tenantId", "entity");

-- CreateIndex
CREATE INDEX "Branch_tenantId_idx" ON "Branch"("tenantId");

-- CreateIndex
CREATE INDEX "Claim_tenantId_status_idx" ON "Claim"("tenantId", "status");

-- CreateIndex
CREATE INDEX "Claim_tenantId_employeeId_idx" ON "Claim"("tenantId", "employeeId");

-- CreateIndex
CREATE UNIQUE INDEX "Claim_tenantId_claimNo_key" ON "Claim"("tenantId", "claimNo");

-- CreateIndex
CREATE UNIQUE INDEX "Claim_tenantId_voucherNo_key" ON "Claim"("tenantId", "voucherNo");

-- CreateIndex
CREATE INDEX "ClaimMessage_tenantId_claimId_idx" ON "ClaimMessage"("tenantId", "claimId");

-- CreateIndex
CREATE UNIQUE INDEX "CompanySettings_tenantId_key" ON "CompanySettings"("tenantId");

-- CreateIndex
CREATE INDEX "Department_tenantId_idx" ON "Department"("tenantId");

-- CreateIndex
CREATE UNIQUE INDEX "Department_tenantId_name_key" ON "Department"("tenantId", "name");

-- CreateIndex
CREATE INDEX "Designation_tenantId_idx" ON "Designation"("tenantId");

-- CreateIndex
CREATE UNIQUE INDEX "Designation_tenantId_name_key" ON "Designation"("tenantId", "name");

-- CreateIndex
CREATE INDEX "Employee_tenantId_branchId_idx" ON "Employee"("tenantId", "branchId");

-- CreateIndex
CREATE INDEX "Employee_tenantId_departmentId_idx" ON "Employee"("tenantId", "departmentId");

-- CreateIndex
CREATE INDEX "Employee_tenantId_shiftId_idx" ON "Employee"("tenantId", "shiftId");

-- CreateIndex
CREATE INDEX "Employee_tenantId_status_idx" ON "Employee"("tenantId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "Employee_tenantId_employeeCode_key" ON "Employee"("tenantId", "employeeCode");

-- CreateIndex
CREATE UNIQUE INDEX "Employee_tenantId_phone_key" ON "Employee"("tenantId", "phone");

-- CreateIndex
CREATE INDEX "GPSLog_tenantId_attendanceId_idx" ON "GPSLog"("tenantId", "attendanceId");

-- CreateIndex
CREATE INDEX "GeofenceViolation_tenantId_timestamp_idx" ON "GeofenceViolation"("tenantId", "timestamp");

-- CreateIndex
CREATE INDEX "GeofenceViolation_tenantId_employeeId_idx" ON "GeofenceViolation"("tenantId", "employeeId");

-- CreateIndex
CREATE UNIQUE INDEX "Holiday_tenantId_date_key" ON "Holiday"("tenantId", "date");

-- CreateIndex
CREATE INDEX "Leave_tenantId_status_idx" ON "Leave"("tenantId", "status");

-- CreateIndex
CREATE INDEX "Leave_tenantId_employeeId_idx" ON "Leave"("tenantId", "employeeId");

-- CreateIndex
CREATE INDEX "LeaveBalance_tenantId_year_idx" ON "LeaveBalance"("tenantId", "year");

-- CreateIndex
CREATE INDEX "Notification_tenantId_adminId_isRead_idx" ON "Notification"("tenantId", "adminId", "isRead");

-- CreateIndex
CREATE INDEX "Payslip_tenantId_year_month_idx" ON "Payslip"("tenantId", "year", "month");

-- CreateIndex
CREATE INDEX "Shift_tenantId_idx" ON "Shift"("tenantId");

-- CreateIndex
CREATE INDEX "WhatsAppLog_tenantId_status_idx" ON "WhatsAppLog"("tenantId", "status");

-- CreateIndex
CREATE INDEX "WhatsAppLog_tenantId_phone_idx" ON "WhatsAppLog"("tenantId", "phone");

