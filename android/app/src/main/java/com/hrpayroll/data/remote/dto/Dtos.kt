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
