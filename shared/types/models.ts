// Shared domain models — mirror prisma/schema.prisma. Used by web + backend.
import type {
  AttendanceStatus,
  EmployeeStatus,
  GeofenceStatus,
  LeaveStatus,
  LeaveType,
  PayslipStatus,
  WAStatus,
} from './enums';

export interface Employee {
  id: string;
  employeeCode: string;
  name: string;
  phone: string;
  email?: string | null;
  branchId: string;
  departmentId: string;
  designationId: string;
  shiftId: string;
  faceTemplateUrl?: string | null;
  faceTemplateId?: string | null;
  deviceId?: string | null;
  /** Never live-tracked, even when the dealer tracks. */
  trackingExempt?: boolean;
  status: EmployeeStatus;
  joiningDate: string; // ISO date
  salary: number;
  createdAt: string;
}

/** FIX is a location; the rest are status events from the phone, with no coordinates. */
export type TrackKind = 'FIX' | 'GPS_OFF' | 'GPS_ON' | 'NO_PERMISSION' | 'STOPPED';

export interface GPSLog {
  id: string;
  attendanceId: string;
  employeeId: string;
  kind: TrackKind;
  lat?: number | null;
  lng?: number | null;
  accuracy?: number | null;
  geofenceStatus?: GeofenceStatus | null;
  distance?: number | null;
  isMock: boolean;
  timestamp: string;
  receivedAt: string;
}

export interface Attendance {
  id: string;
  employeeId: string;
  date: string; // ISO date
  checkIn?: string | null;
  checkOut?: string | null;
  checkInSelfie?: string | null;
  checkOutSelfie?: string | null;
  checkInLat?: number | null;
  checkInLng?: number | null;
  checkOutLat?: number | null;
  checkOutLng?: number | null;
  checkInDevice?: string | null;
  geofenceStatus: GeofenceStatus;
  faceMatchScore?: number | null;
  status: AttendanceStatus;
  workingMinutes?: number | null;
  isFlagged: boolean;
  flagReason?: string | null;
  /** Live tracking window — null trackingFrom means the day was not tracked. */
  trackingFrom?: string | null;
  trackingTo?: string | null;
  gpsLogs?: GPSLog[];
}

export interface Shift {
  id: string;
  name: string;
  startTime: string; // "09:00"
  endTime: string; // "18:00"
  gracePeriod: number;
  isNightShift: boolean;
}

export interface Leave {
  id: string;
  employeeId: string;
  type: LeaveType;
  fromDate: string;
  toDate: string;
  days: number;
  reason: string;
  documentUrl?: string | null;
  status: LeaveStatus;
  approvedBy?: string | null;
  approverNote?: string | null;
  createdAt: string;
}

export interface Payslip {
  id: string;
  employeeId: string;
  month: number;
  year: number;
  presentDays: number;
  absentDays: number;
  lopDays: number;
  basicSalary: number;
  hra: number;
  da: number;
  otherAllowances: number;
  grossSalary: number;
  pfDeduction: number;
  esiDeduction: number;
  ptDeduction: number;
  tdsDeduction: number;
  otherDeductions: number;
  netSalary: number;
  pdfUrl?: string | null;
  status: PayslipStatus;
  createdAt: string;
}

export interface WhatsAppLog {
  id: string;
  employeeId?: string | null;
  phone: string;
  templateName: string;
  message: string;
  status: WAStatus;
  messageId?: string | null;
  sentAt?: string | null;
  deliveredAt?: string | null;
  readAt?: string | null;
  trigger: string;
  createdAt: string;
}

export interface Branch {
  id: string;
  name: string;
  address: string;
  geofenceLat: number;
  geofenceLng: number;
  geofenceRadius: number;
  geofencePolygon?: unknown;
  strictMode: boolean;
}
