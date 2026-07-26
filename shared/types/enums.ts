// Shared enums — mirror prisma/schema.prisma. Used by web + backend.

export type EmployeeStatus = 'ACTIVE' | 'INACTIVE' | 'SUSPENDED';
export type GeofenceStatus = 'INSIDE' | 'OUTSIDE' | 'BORDERLINE';
export type AttendanceStatus =
  | 'PRESENT'
  | 'ABSENT'
  | 'LATE'
  | 'HALF_DAY'
  | 'ON_LEAVE'
  | 'HOLIDAY';
export type LeaveType = 'CL' | 'SL' | 'EL' | 'LOP' | 'HALF_DAY';
export type LeaveStatus = 'PENDING' | 'APPROVED' | 'REJECTED' | 'CANCELLED';
// Expense heads. Source of truth: backend/src/services/claim/claim-types.ts
// (which also carries the display labels and validates submissions).
export type ClaimType =
  | 'GENERAL_EXPENSES'
  | 'DONATION'
  | 'MARKETING_EXPENSES'
  | 'NEW_VEHICLE_COMMISSION'
  | 'NEW_VEHICLE_FITTINGS_INCENTIVES'
  | 'NEW_VEHICLE_PDI_PARTS'
  | 'NEW_VEHICLE_PDI_PETROL'
  | 'OTHER'
  | 'PARCEL'
  | 'PETROL_EXPENSES'
  | 'RENT'
  | 'SALARY'
  | 'SALES_INCENTIVES'
  | 'SERVICE_INCENTIVES'
  | 'SERVICE_OUTWORK'
  | 'STAFF_WELFARE_EXPENSES'
  | 'TRAINING'
  | 'TRAVEL_EXPENSES'
  | 'UNLOADING_EXPENSES'
  | 'UTILITIES_AND_OFFICE';
export type ClaimStatus = 'PENDING' | 'APPROVED' | 'REJECTED' | 'NEEDS_CLARIFICATION' | 'PAID';
export type PayslipStatus = 'DRAFT' | 'FINALIZED' | 'SENT' | 'PAID';
export type WAStatus = 'QUEUED' | 'SENT' | 'DELIVERED' | 'READ' | 'FAILED';
export type AdminRole = 'SUPER_ADMIN' | 'HR_MANAGER' | 'BRANCH_MANAGER' | 'PAYROLL_ADMIN' | 'CASHIER';
