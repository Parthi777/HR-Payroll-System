package com.hrpayroll.data.remote

import com.hrpayroll.data.remote.dto.AttendanceDto
import com.hrpayroll.data.remote.dto.AttendanceHistoryDto
import com.hrpayroll.data.remote.dto.OtpResponse
import okhttp3.MultipartBody
import retrofit2.http.Body
import retrofit2.http.GET
import retrofit2.http.Multipart
import retrofit2.http.POST
import retrofit2.http.Part

/** Retrofit interface mapping the backend REST API (see CLAUDE.md API Endpoints). */
interface HrApi {

    @POST("auth/send-otp")
    suspend fun sendOtp(@Body body: Map<String, String>): OtpResponse

    @POST("auth/verify-otp")
    suspend fun verifyOtp(@Body body: Map<String, String>): OtpResponse

    @Multipart
    @POST("attendance/checkin")
    suspend fun checkIn(
        @Part selfie: MultipartBody.Part,
        @Part("lat") lat: String,
        @Part("lng") lng: String,
    ): AttendanceDto

    @Multipart
    @POST("attendance/checkout")
    suspend fun checkOut(
        @Part selfie: MultipartBody.Part,
        @Part("lat") lat: String,
        @Part("lng") lng: String,
    ): AttendanceDto

    @GET("attendance/today")
    suspend fun today(): AttendanceDto

    @GET("attendance/history")
    suspend fun history(): List<AttendanceHistoryDto>
}
