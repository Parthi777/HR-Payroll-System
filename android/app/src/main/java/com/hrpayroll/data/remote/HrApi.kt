package com.hrpayroll.data.remote

import com.hrpayroll.data.remote.dto.ApplyLeaveRequest
import com.hrpayroll.data.remote.dto.AttendanceDto
import com.hrpayroll.data.remote.dto.AttendanceHistoryDto
import com.hrpayroll.data.remote.dto.BalanceListResponse
import com.hrpayroll.data.remote.dto.LeaveCreatedResponse
import com.hrpayroll.data.remote.dto.LeaveListResponse
import com.hrpayroll.data.remote.dto.OtpResponse
import com.hrpayroll.data.remote.dto.PayslipListResponse
import com.hrpayroll.data.remote.dto.ScheduleResponse
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
        @Part("accuracy") accuracy: String,
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

    // Leaves
    @POST("leaves/apply")
    suspend fun applyLeave(@Body body: ApplyLeaveRequest): LeaveCreatedResponse

    @GET("leaves/my-leaves")
    suspend fun myLeaves(): LeaveListResponse

    @GET("leaves/balance")
    suspend fun leaveBalance(): BalanceListResponse

    // Payslips
    @GET("payroll/my-payslips")
    suspend fun myPayslips(): PayslipListResponse

    // Shift schedule
    @GET("shifts/my-schedule")
    suspend fun mySchedule(): ScheduleResponse
}
