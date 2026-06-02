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
