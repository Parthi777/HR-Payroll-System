-- Live location tracking between check-in and check-out. Off for every dealer
-- until switched on in Settings: an update tracks nobody.
ALTER TABLE "CompanySettings" ADD COLUMN "liveTrackingOn" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "Employee" ADD COLUMN "trackingExempt" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "Attendance" ADD COLUMN "trackingFrom" TIMESTAMP(3), ADD COLUMN "trackingTo" TIMESTAMP(3);

-- GPSLog has never been written to, but backfill employeeId defensively
-- before making it NOT NULL. Status events (GPS off, no permission) carry no
-- coordinates, so lat/lng become nullable.
ALTER TABLE "GPSLog"
  ADD COLUMN "employeeId" TEXT,
  ADD COLUMN "kind" TEXT NOT NULL DEFAULT 'FIX',
  ADD COLUMN "geofenceStatus" TEXT,
  ADD COLUMN "distance" DOUBLE PRECISION,
  ADD COLUMN "isMock" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "receivedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  ALTER COLUMN "lat" DROP NOT NULL,
  ALTER COLUMN "lng" DROP NOT NULL;
UPDATE "GPSLog" g SET "employeeId" = a."employeeId" FROM "Attendance" a WHERE a."id" = g."attendanceId";
DELETE FROM "GPSLog" WHERE "employeeId" IS NULL;
ALTER TABLE "GPSLog" ALTER COLUMN "employeeId" SET NOT NULL;

CREATE UNIQUE INDEX "GPSLog_attendanceId_kind_timestamp_key" ON "GPSLog"("attendanceId", "kind", "timestamp");
CREATE INDEX "GPSLog_tenantId_employeeId_timestamp_idx" ON "GPSLog"("tenantId", "employeeId", "timestamp");
CREATE INDEX "GPSLog_tenantId_timestamp_idx" ON "GPSLog"("tenantId", "timestamp");
