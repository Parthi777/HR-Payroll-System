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
data class ClaimEmployeeDto(val name: String? = null, val employeeCode: String? = null)

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
    val photoFileId: String? = null,
    val documentFileId: String? = null,
    val photoUrl: String? = null,
    val documentUrl: String? = null,
    val createdAt: String? = null,
    val employee: ClaimEmployeeDto? = null, // present on admin listings
)

@JsonClass(generateAdapter = true)
data class ClaimListResponse(val claims: List<ClaimDto> = emptyList())

@JsonClass(generateAdapter = true)
data class ClaimCreatedResponse(val claim: ClaimDto? = null)

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
