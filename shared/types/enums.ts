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
export type ClaimType = 'TRAVEL' | 'FOOD' | 'MEDICAL' | 'ACCOMMODATION' | 'OTHER';
export type ClaimStatus = 'PENDING' | 'APPROVED' | 'REJECTED' | 'NEEDS_CLARIFICATION' | 'PAID';
export type PayslipStatus = 'DRAFT' | 'FINALIZED' | 'SENT' | 'PAID';
export type WAStatus = 'QUEUED' | 'SENT' | 'DELIVERED' | 'READ' | 'FAILED';
export type AdminRole = 'SUPER_ADMIN' | 'HR_MANAGER' | 'BRANCH_MANAGER' | 'PAYROLL_ADMIN' | 'CASHIER';
