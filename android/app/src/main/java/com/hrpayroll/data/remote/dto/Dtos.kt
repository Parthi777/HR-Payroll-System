package com.hrpayroll.data.remote.dto

import com.squareup.moshi.JsonClass

@JsonClass(generateAdapter = true)
data class TenantDto(
    val slug: String? = null,
    val name: String? = null,
)

@JsonClass(generateAdapter = true)
data class EmployeeLoginResponse(
    val token: String? = null,
    val refreshToken: String? = null,
    /** The workspace this sign-in resolved to. */
    val tenant: TenantDto? = null,
)

@JsonClass(generateAdapter = true)
data class AttendanceDto(
    val id: String? = null,
    val status: String? = null,
    val checkIn: String? = null,
    val checkOut: String? = null,
    val workingMinutes: Int? = null,
    val faceMatchScore: Double? = null,
    val approvalStatus: String? = null, // PENDING when late or outside geofence, awaiting approval
    val flagReason: String? = null,
    /** Live tracking for this day: start it (check-in), or say it stopped (check-out). */
    val tracking: TrackingDto? = null,
)

/**
 * Whether the phone records location for the open day. On a check-in response
 * `enabled` starts it; on a check-out `wasTracked` says monitoring has stopped.
 */
@JsonClass(generateAdapter = true)
data class TrackingDto(
    val enabled: Boolean = false,
    val intervalSec: Int = 120,
    val attendanceId: String? = null,
    val wasTracked: Boolean = false,
)

/** The consent screen was agreed to: which wording, and when (ISO). */
@JsonClass(generateAdapter = true)
data class ConsentRequest(val version: Int, val acceptedAt: String)

@JsonClass(generateAdapter = true)
data class LatLngDto(val lat: Double = 0.0, val lng: Double = 0.0)

@JsonClass(generateAdapter = true)
data class GpsPointDto(
    val ts: String,
    val lat: Double,
    val lng: Double,
    val accuracy: Float? = null,
    val mock: Boolean = false,
)

@JsonClass(generateAdapter = true)
data class GpsEventDto(val ts: String, val kind: String)

@JsonClass(generateAdapter = true)
data class GpsBatchRequest(
    val attendanceId: String,
    val points: List<GpsPointDto>,
    val events: List<GpsEventDto>,
)

@JsonClass(generateAdapter = true)
data class GpsBatchResponse(
    /** False: stop — checked out, switched off, or exempted. */
    val tracking: Boolean = true,
    val intervalSec: Int = 120,
    val accepted: Int = 0,
)

@JsonClass(generateAdapter = true)
data class AttendanceHistoryDto(
    val id: String? = null,
    val date: String? = null,
    val checkIn: String? = null,
    val checkOut: String? = null,
    val status: String? = null,
)

/**
 * A past day the employee checked in on but never checked out of. Check-in is
 * blocked until that day's check-out is raised for approval.
 */
@JsonClass(generateAdapter = true)
data class MissingCheckoutDto(
    val attendanceId: String? = null,
    val date: String? = null, // yyyy-MM-dd — pre-fills the manual punch
    val dateLabel: String? = null, // "Mon, Aug 3"
    val checkIn: String? = null, // that day's check-in, "09:02 AM"
    val shiftEnd: String? = null, // "18:00" — default for the time picker
    val openDays: Int = 0,
)

@JsonClass(generateAdapter = true)
data class MissingCheckoutResponse(
    val pending: MissingCheckoutDto? = null,
)

// ── Leaves ──
@JsonClass(generateAdapter = true)
data class ApplyLeaveRequest(
    val type: String,
    val fromDate: String, // ISO yyyy-MM-dd
    val toDate: String,
    val days: Double,
    val reason: String,
)

@JsonClass(generateAdapter = true)
data class LeaveDto(
    val id: String? = null,
    val type: String? = null,
    val fromDate: String? = null,
    val toDate: String? = null,
    val days: Double? = null,
    val reason: String? = null,
    val status: String? = null,
)

@JsonClass(generateAdapter = true)
data class LeaveListResponse(val leaves: List<LeaveDto> = emptyList())

@JsonClass(generateAdapter = true)
data class LeaveBalanceDto(val type: String? = null, val total: Double? = null, val used: Double? = null)

@JsonClass(generateAdapter = true)
data class BalanceListResponse(val balances: List<LeaveBalanceDto> = emptyList())

@JsonClass(generateAdapter = true)
data class LeaveCreatedResponse(val leave: LeaveDto? = null)

// ── Payslips ──
@JsonClass(generateAdapter = true)
data class PayslipDto(
    val id: String? = null,
    val month: Int? = null,
    val year: Int? = null,
    val presentDays: Double? = null, // fractional — a half day counts 0.5
    val absentDays: Double? = null,
    val halfDays: Double? = null,
    val otHours: Double? = null,
    val basicSalary: Double? = null,
    val hra: Double? = null,
    val da: Double? = null,
    val otherAllowances: Double? = null,
    val grossSalary: Double? = null,
    val pfDeduction: Double? = null,
    val esiDeduction: Double? = null,
    val netSalary: Double? = null,
    val status: String? = null,
    val lateDays: Int? = null,
    val payDate: String? = null,
)

@JsonClass(generateAdapter = true)
data class PayslipListResponse(val payslips: List<PayslipDto> = emptyList())

// ── Shift schedule ──
@JsonClass(generateAdapter = true)
data class ScheduleDayDto(
    val date: String? = null,
    val shiftName: String? = null,
    val startTime: String? = null,
    val endTime: String? = null,
    val isOff: Boolean? = null,
)

@JsonClass(generateAdapter = true)
data class ScheduleResponse(val schedule: List<ScheduleDayDto> = emptyList())

// ── Admin (mobile reports + monitoring) ──
@JsonClass(generateAdapter = true)
data class AdminLoginResponse(
    val token: String? = null,
    val role: String? = null,
    val email: String? = null,
    val name: String? = null,
    /** The workspace this sign-in resolved to. */
    val tenant: TenantDto? = null,
    /** Present only when two-step setup just finished: shown once, never again. */
    val recoveryCodes: List<String>? = null,
    /** Present when a recovery code was used to sign in — how many remain. */
    val recoveryCodesLeft: Int? = null,
)

/**
 * A correct admin password: half a sign-in. `step` is "verify" (enter the code
 * from the authenticator) or "enroll" (set one up first); `challenge` is handed
 * back with the code and opens nothing else.
 */
@JsonClass(generateAdapter = true)
data class AdminPasswordStep(
    val step: String? = null,
    val challenge: String? = null,
    val tenant: TenantDto? = null,
)

/** A new authenticator secret, during setup. */
@JsonClass(generateAdapter = true)
data class TwoStepSetupDto(
    val secret: String? = null,
    val otpauthUri: String? = null,
)

@JsonClass(generateAdapter = true)
data class DashboardStatsDto(
    val presentNow: Int = 0,
    val absent: Int = 0,
    val lateArrivals: Int = 0,
    val onLeave: Int = 0,
    val pendingApprovals: Int = 0,
    val totalStaff: Int = 0,
    val branches: Int = 0,
    val checkedIn: Int = 0,
    val attendanceRate: Int = 0,
)

@JsonClass(generateAdapter = true)
data class LiveAttendanceRowDto(
    val id: String? = null,
    val name: String? = null,
    val branch: String? = null,
    val checkIn: String? = null,
    val checkOut: String? = null,
    val status: String? = null,
)

@JsonClass(generateAdapter = true)
data class PerformanceRowDto(
    val employeeId: String? = null,
    val employeeCode: String? = null,
    val name: String? = null,
    val branch: String? = null,
    val department: String? = null,
    val designation: String? = null,
    val joiningDate: String? = null,
    /** ISO date: joining, or when the workspace began if later. The earliest starts the month dropdown. */
    val availableFrom: String? = null,
    // Fractional: a half day counts 0.5, as on the muster and the payslip.
    val presentDays: Double = 0.0,
    val lateDays: Int = 0,
    val absentDays: Double = 0.0,
    val leaveDays: Double = 0.0,
    val attendanceRate: Int = 0,
    val avgHours: Double = 0.0,
    val flaggedCount: Int = 0,
)

// ── One employee's month (admin) — GET /admin/reports/employee/:id/month ──
@JsonClass(generateAdapter = true)
data class MonthRefDto(val month: Int = 1, val year: Int = 2026)

@JsonClass(generateAdapter = true)
data class ShiftRefDto(val name: String? = null, val startTime: String? = null, val endTime: String? = null)

@JsonClass(generateAdapter = true)
data class EmployeeProfileDto(
    val id: String? = null,
    val name: String? = null,
    val employeeCode: String? = null,
    val phone: String? = null,
    val branch: String? = null,
    val department: String? = null,
    val designation: String? = null,
    val shift: ShiftRefDto? = null,
    val joiningDate: String? = null,
)

/** One day: status is PRESENT / LATE / HALF_DAY / ABSENT / PENDING / ON_LEAVE / LOP / WEEKLY_OFF(_WORKED) / HOLIDAY(_WORKED) / NOT_JOINED. */
@JsonClass(generateAdapter = true)
data class EmployeeDayDto(
    val day: Int = 0,
    val weekday: Int = 0,
    val status: String? = null,
    val checkIn: String? = null,
    val checkOut: String? = null,
    val workedHours: Double? = null,
    val punchMode: String? = null,
)

@JsonClass(generateAdapter = true)
data class EmployeeMonthSummaryDto(
    val present: Double = 0.0,
    val offDuty: Double = 0.0,
    val late: Double = 0.0,
    val half: Double = 0.0,
    val absent: Double = 0.0,
    val pending: Double = 0.0,
    val leave: Double = 0.0,
    val lop: Double = 0.0,
    val off: Double = 0.0,
    val served: Double = 0.0,
    val workedHours: Double = 0.0,
)

@JsonClass(generateAdapter = true)
data class EmployeeAttendanceDto(
    val days: List<EmployeeDayDto> = emptyList(),
    val summary: EmployeeMonthSummaryDto = EmployeeMonthSummaryDto(),
)

@JsonClass(generateAdapter = true)
data class EmployeeVoucherDto(
    val id: String? = null,
    val claimNo: Int? = null,
    val title: String? = null,
    val typeLabel: String? = null,
    val amount: Double = 0.0,
    val status: String? = null,
    val createdAt: String? = null,
)

@JsonClass(generateAdapter = true)
data class VoucherTotalsDto(val count: Int = 0, val amount: Double = 0.0, val paid: Double = 0.0)

/** Present only for Super Admin and Payroll Admin. */
@JsonClass(generateAdapter = true)
data class EmployeeSalaryDto(
    val monthlySalary: Double = 0.0,
    val payrollBasis: String? = null,
    val perDaySalary: Double = 0.0,
    val servedDays: Double = 0.0,
    val paidDays: Double = 0.0,
    val basePay: Double = 0.0,
    val otHours: Double = 0.0,
    val otPay: Double = 0.0,
    val sundayDays: Double = 0.0,
    val sundayPay: Double = 0.0,
    val leaveDeduction: Double = 0.0,
    val grossSalary: Double = 0.0,
    val pf: Double = 0.0,
    val esi: Double = 0.0,
    val netSalary: Double = 0.0,
)

@JsonClass(generateAdapter = true)
data class EmployeeMonthDto(
    val month: Int = 1,
    val year: Int = 2026,
    val employee: EmployeeProfileDto = EmployeeProfileDto(),
    val attendance: EmployeeAttendanceDto = EmployeeAttendanceDto(),
    val leaves: List<LeaveDto> = emptyList(),
    val vouchers: List<EmployeeVoucherDto> = emptyList(),
    val voucherTotals: VoucherTotalsDto = VoucherTotalsDto(),
    val salary: EmployeeSalaryDto? = null,
    val months: List<MonthRefDto> = emptyList(),
)

// ── Claims ──
@JsonClass(generateAdapter = true)
data class BranchNameDto(val name: String? = null)

@JsonClass(generateAdapter = true)
data class ClaimEmployeeDto(
    val name: String? = null,
    val employeeCode: String? = null,
    val branch: BranchNameDto? = null,
)

@JsonClass(generateAdapter = true)
data class ClaimMessageDto(
    val id: String? = null,
    val senderRole: String? = null, // ADMIN | EMPLOYEE
    val senderName: String? = null,
    val message: String? = null,
    val createdAt: String? = null,
)

@JsonClass(generateAdapter = true)
data class ClaimDto(
    val id: String? = null,
    val type: String? = null,
    val typeLabel: String? = null, // human expense-head name, e.g. "Petrol Expenses"
    val claimNo: Int? = null, // running Claim ID, issued on receipt
    val voucherNo: Int? = null, // running Voucher No, issued only on approval
    val claimNoLabel: String? = null, // zero-padded, e.g. "001"
    val voucherNoLabel: String? = null,
    val title: String? = null,
    val amount: Double? = null,
    val description: String? = null,
    val status: String? = null,
    val reviewerNote: String? = null,
    val employeeNote: String? = null,
    val reviewerName: String? = null,
    val reviewedAt: String? = null,
    val paidByName: String? = null,
    val paidAt: String? = null,
    val paidNote: String? = null,
    val photoFileId: String? = null,
    val documentFileId: String? = null,
    val photoUrl: String? = null,
    val documentUrl: String? = null,
    val createdAt: String? = null,
    val employee: ClaimEmployeeDto? = null, // present on admin listings
    val messages: List<ClaimMessageDto>? = null, // clarification thread
)

@JsonClass(generateAdapter = true)
data class ClaimListResponse(val claims: List<ClaimDto> = emptyList())

@JsonClass(generateAdapter = true)
data class ClaimCreatedResponse(val claim: ClaimDto? = null)

// ── Admin: employee onboarding + face enrollment ──
@JsonClass(generateAdapter = true)
data class AdminEmployeeDto(
    val id: String? = null,
    val employeeCode: String? = null,
    val name: String? = null,
    val phone: String? = null,
    val salary: Double? = null,
    val status: String? = null,
    val faceTemplateId: String? = null, // non-null = face enrolled
    val branch: BranchNameDto? = null,
)

@JsonClass(generateAdapter = true)
data class EmployeeListResponse(val employees: List<AdminEmployeeDto> = emptyList())

@JsonClass(generateAdapter = true)
data class EmployeeCreatedResponse(val employee: AdminEmployeeDto? = null)

@JsonClass(generateAdapter = true)
data class EnrollFaceResponse(val enrolled: Boolean? = null)

@JsonClass(generateAdapter = true)
data class MasterItemDto(val id: String? = null, val name: String? = null)

@JsonClass(generateAdapter = true)
data class BranchListResponse(val branches: List<MasterItemDto> = emptyList())

@JsonClass(generateAdapter = true)
data class ManagerListResponse(val managers: List<MasterItemDto> = emptyList())

@JsonClass(generateAdapter = true)
data class AttendanceApprovalDto(
    val id: String? = null,
    val name: String? = null,
    val employeeCode: String? = null,
    val branch: String? = null,
    val date: String? = null,
    val checkIn: String? = null,
    val reason: String? = null,
    val hasSelfie: Boolean? = null,
)

@JsonClass(generateAdapter = true)
data class AttendanceApprovalsResponse(val approvals: List<AttendanceApprovalDto> = emptyList())

@JsonClass(generateAdapter = true)
data class AttendanceDecisionResponse(val ok: Boolean = true)

@JsonClass(generateAdapter = true)
data class DailyRowDto(
    val employeeCode: String? = null,
    val name: String? = null,
    val branch: String? = null,
    val status: String? = null, // PRESENT|LATE|ABSENT|... (may include "(awaiting approval)")
    val checkIn: String? = null,
    val checkOut: String? = null,
    val workedHours: Double? = null,
    val geofence: String? = null, // INSIDE|OUTSIDE|BORDERLINE
    val flagged: Boolean? = null,
)

@JsonClass(generateAdapter = true)
data class DailySummaryDto(val total: Int = 0, val present: Int = 0, val late: Int = 0, val absent: Int = 0)

@JsonClass(generateAdapter = true)
data class DailyReportResponse(
    val date: String? = null,
    val summary: DailySummaryDto? = null,
    val rows: List<DailyRowDto> = emptyList(),
)

@JsonClass(generateAdapter = true)
data class MonthDayDto(
    val day: Int = 0,
    val weekday: Int = 0,
    val present: Int = 0,
    val late: Int = 0,
    val absent: Int = 0,
    val future: Boolean = false,
)

@JsonClass(generateAdapter = true)
data class MonthSummaryResponse(
    val month: Int = 0,
    val year: Int = 0,
    val totalStaff: Int = 0,
    val days: List<MonthDayDto> = emptyList(),
)

@JsonClass(generateAdapter = true)
data class CalendarDayDto(
    val day: Int? = null,
    val weekday: Int? = null, // 0 = Sunday
    val status: String? = null, // PRESENT|LATE|HALF_DAY|ABSENT|LEAVE|OFF|FUTURE|PENDING_APPROVAL
    val checkIn: String? = null,
    val checkOut: String? = null,
)

@JsonClass(generateAdapter = true)
data class CalendarSummaryDto(
    val present: Int? = null,
    val late: Int? = null,
    val half: Int? = null,
    val absent: Int? = null,
    val leave: Int? = null,
    /** Punches still waiting on a manager. Unpaid until approved. */
    val pending: Int? = null,
    /** Minutes actually worked across the month, from the punches themselves. */
    val workedMinutes: Int? = null,
)

@JsonClass(generateAdapter = true)
data class AttendanceCalendarResponse(
    val month: Int? = null,
    val year: Int? = null,
    val days: List<CalendarDayDto> = emptyList(),
    val summary: CalendarSummaryDto? = null,
)

@JsonClass(generateAdapter = true)
data class NotificationDto(
    val id: String? = null,
    val type: String? = null,
    val title: String? = null,
    val body: String? = null,
    val isRead: Boolean? = null,
    val createdAt: String? = null,
)

@JsonClass(generateAdapter = true)
data class NotificationListResponse(
    val notifications: List<NotificationDto> = emptyList(),
    val unread: Int? = null,
)

@JsonClass(generateAdapter = true)
data class AppVersionResponse(
    val available: Boolean? = null,
    val versionCode: Int? = null,
    val versionName: String? = null,
    val url: String? = null,
)

@JsonClass(generateAdapter = true)
data class DepartmentListResponse(val departments: List<MasterItemDto> = emptyList())

@JsonClass(generateAdapter = true)
data class DesignationListResponse(val designations: List<MasterItemDto> = emptyList())

@JsonClass(generateAdapter = true)
data class ShiftListResponse(val shifts: List<MasterItemDto> = emptyList())

// ── Admin user-access management ──
@JsonClass(generateAdapter = true)
data class AdminUserDto(
    val id: String? = null,
    val name: String? = null,
    val email: String? = null,
    val role: String? = null,
    val isActive: Boolean = true,
)

@JsonClass(generateAdapter = true)
data class AdminUserListResponse(val admins: List<AdminUserDto> = emptyList())

@JsonClass(generateAdapter = true)
data class AdminUserResponse(val admin: AdminUserDto? = null)

// ── Profile (home dashboard) ──
@JsonClass(generateAdapter = true)
data class MeDto(
    val id: String? = null,
    val name: String? = null,
    val employeeCode: String? = null,
    val phone: String? = null,
    val designation: String? = null,
    val department: String? = null,
    val branch: String? = null,
    val shift: String? = null,
    /** Who to ring about attendance or salary. Null when the dealer set nobody. */
    val hr: HrContactDto? = null,
    /** The dealer shares payroll with staff: show the Payroll tab. Off unless they turned it on. */
    val payrollVisible: Boolean = false,
    /** The dealer live-tracks this employee's check-ins: say so in the check-in dialog. */
    val tracking: TrackingDto? = null,
    /** The branch's pin — where the weather card looks when the phone has no fix. */
    val branchLocation: LatLngDto? = null,
)

@JsonClass(generateAdapter = true)
data class HrContactDto(
    val name: String? = null,
    val phone: String? = null,
)
