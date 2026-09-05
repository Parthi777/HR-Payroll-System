-- DropIndex
DROP INDEX "AdminUser_email_key";

-- DropIndex
DROP INDEX "Attendance_date_idx";

-- DropIndex
DROP INDEX "AuditLog_adminId_idx";

-- DropIndex
DROP INDEX "AuditLog_entity_idx";

-- DropIndex
DROP INDEX "Claim_claimNo_key";

-- DropIndex
DROP INDEX "Claim_employeeId_idx";

-- DropIndex
DROP INDEX "Claim_status_idx";

-- DropIndex
DROP INDEX "Claim_voucherNo_key";

-- DropIndex
DROP INDEX "ClaimMessage_claimId_idx";

-- DropIndex
DROP INDEX "Department_name_key";

-- DropIndex
DROP INDEX "Designation_name_key";

-- DropIndex
DROP INDEX "Employee_branchId_idx";

-- DropIndex
DROP INDEX "Employee_departmentId_idx";

-- DropIndex
DROP INDEX "Employee_employeeCode_key";

-- DropIndex
DROP INDEX "Employee_phone_key";

-- DropIndex
DROP INDEX "Employee_shiftId_idx";

-- DropIndex
DROP INDEX "GPSLog_attendanceId_idx";

-- DropIndex
DROP INDEX "GeofenceViolation_branchId_idx";

-- DropIndex
DROP INDEX "GeofenceViolation_employeeId_idx";

-- DropIndex
DROP INDEX "Holiday_date_key";

-- DropIndex
DROP INDEX "Leave_employeeId_idx";

-- DropIndex
DROP INDEX "Leave_status_idx";

-- DropIndex
DROP INDEX "Notification_adminId_isRead_idx";

-- DropIndex
DROP INDEX "Tenant_status_idx";

-- DropIndex
DROP INDEX "WhatsAppLog_phone_idx";

-- DropIndex
DROP INDEX "WhatsAppLog_status_idx";

-- AlterTable
ALTER TABLE "AdminUser" ALTER COLUMN "tenantId" SET NOT NULL;

-- AlterTable
ALTER TABLE "Attendance" ALTER COLUMN "tenantId" SET NOT NULL;

-- AlterTable
ALTER TABLE "AuditLog" ALTER COLUMN "tenantId" SET NOT NULL;

-- AlterTable
ALTER TABLE "Branch" ALTER COLUMN "tenantId" SET NOT NULL;

-- AlterTable
ALTER TABLE "Claim" ALTER COLUMN "tenantId" SET NOT NULL;

-- AlterTable
ALTER TABLE "ClaimMessage" ALTER COLUMN "tenantId" SET NOT NULL;

-- AlterTable
ALTER TABLE "CompanySettings" ALTER COLUMN "tenantId" SET NOT NULL;

-- AlterTable
ALTER TABLE "Department" ALTER COLUMN "tenantId" SET NOT NULL;

-- AlterTable
ALTER TABLE "Designation" ALTER COLUMN "tenantId" SET NOT NULL;

-- AlterTable
ALTER TABLE "Employee" ALTER COLUMN "tenantId" SET NOT NULL;

-- AlterTable
ALTER TABLE "GPSLog" ALTER COLUMN "tenantId" SET NOT NULL;

-- AlterTable
ALTER TABLE "GeofenceViolation" ALTER COLUMN "tenantId" SET NOT NULL;

-- AlterTable
ALTER TABLE "Holiday" ALTER COLUMN "tenantId" SET NOT NULL;

-- AlterTable
ALTER TABLE "Leave" ALTER COLUMN "tenantId" SET NOT NULL;

-- AlterTable
ALTER TABLE "LeaveBalance" ALTER COLUMN "tenantId" SET NOT NULL;

-- AlterTable
ALTER TABLE "Notification" ALTER COLUMN "tenantId" SET NOT NULL;

-- AlterTable
ALTER TABLE "Payslip" ALTER COLUMN "tenantId" SET NOT NULL;

-- AlterTable
ALTER TABLE "Shift" ALTER COLUMN "tenantId" SET NOT NULL;

-- AlterTable
ALTER TABLE "WhatsAppLog" ALTER COLUMN "tenantId" SET NOT NULL;

-- CreateIndex
CREATE INDEX "AuditLog_tenantId_adminId_idx" ON "AuditLog"("tenantId", "adminId");

-- CreateIndex
CREATE INDEX "GeofenceViolation_tenantId_branchId_idx" ON "GeofenceViolation"("tenantId", "branchId");

