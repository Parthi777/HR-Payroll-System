package com.hrpayroll.data.remote.dto

import com.squareup.moshi.JsonClass

@JsonClass(generateAdapter = true)
data class OtpResponse(
    val token: String? = null,
    val refreshToken: String? = null,
    val sent: Boolean? = null,
    val devOtp: String? = null, // dev-only: backend returns the code when no SMS provider is wired
)

@JsonClass(generateAdapter = true)
data class AttendanceDto(
    val id: String? = null,
    val status: String? = null,
    val checkIn: String? = null,
    val checkOut: String? = null,
    val workingMinutes: Int? = null,
    val faceMatchScore: Double? = null,
    val approvalStatus: String? = null, // PENDING when outside geofence, awaiting HR
)

@JsonClass(generateAdapter = true)
data class AttendanceHistoryDto(
    val id: String? = null,
    val date: String? = null,
    val checkIn: String? = null,
    val checkOut: String? = null,
    val status: String? = null,
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
    val presentDays: Int? = null,
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
    val presentDays: Int = 0,
    val lateDays: Int = 0,
    val absentDays: Int = 0,
    val leaveDays: Int = 0,
    val attendanceRate: Int = 0,
    val avgHours: Double = 0.0,
    val flaggedCount: Int = 0,
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
data class DailyRowDto(
    val employeeCode: String? = null,
    val name: String? = null,
    val branch: String? = null,
    val status: String? = null, // PRESENT|LATE|ABSENT|... (may include "(awaiting approval)")
    val checkIn: String? = null,
    val checkOut: String? = null,
    val workedHours: Double? = null,
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
)
