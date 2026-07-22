package com.hrpayroll.data.remote

import com.hrpayroll.data.remote.dto.AdminLoginResponse
import com.hrpayroll.data.remote.dto.AppVersionResponse
import com.hrpayroll.data.remote.dto.AttendanceCalendarResponse
import com.hrpayroll.data.remote.dto.ManagerListResponse
import com.hrpayroll.data.remote.dto.NotificationListResponse
import com.hrpayroll.data.remote.dto.AdminUserListResponse
import com.hrpayroll.data.remote.dto.AdminUserResponse
import com.hrpayroll.data.remote.dto.ApplyLeaveRequest
import com.hrpayroll.data.remote.dto.AttendanceDto
import com.hrpayroll.data.remote.dto.AttendanceHistoryDto
import com.hrpayroll.data.remote.dto.BalanceListResponse
import com.hrpayroll.data.remote.dto.BranchListResponse
import com.hrpayroll.data.remote.dto.ClaimCreatedResponse
import com.hrpayroll.data.remote.dto.ClaimListResponse
import com.hrpayroll.data.remote.dto.DashboardStatsDto
import com.hrpayroll.data.remote.dto.DepartmentListResponse
import com.hrpayroll.data.remote.dto.DesignationListResponse
import com.hrpayroll.data.remote.dto.EmployeeCreatedResponse
import com.hrpayroll.data.remote.dto.EmployeeListResponse
import com.hrpayroll.data.remote.dto.EnrollFaceResponse
import com.hrpayroll.data.remote.dto.MasterItemDto
import com.hrpayroll.data.remote.dto.ShiftListResponse
import com.hrpayroll.data.remote.dto.LeaveCreatedResponse
import com.hrpayroll.data.remote.dto.LeaveListResponse
import com.hrpayroll.data.remote.dto.LiveAttendanceRowDto
import com.hrpayroll.data.remote.dto.MeDto
import com.hrpayroll.data.remote.dto.OtpResponse
import com.hrpayroll.data.remote.dto.PayslipListResponse
import com.hrpayroll.data.remote.dto.PerformanceRowDto
import com.hrpayroll.data.remote.dto.ScheduleResponse
import okhttp3.MultipartBody
import okhttp3.ResponseBody
import retrofit2.http.Body
import retrofit2.http.GET
import retrofit2.http.Multipart
import retrofit2.http.PATCH
import retrofit2.http.POST
import retrofit2.http.PUT
import retrofit2.http.Part
import retrofit2.http.Path
import retrofit2.http.Query
import retrofit2.http.Streaming

/** Retrofit interface mapping the backend REST API (see CLAUDE.md API Endpoints). */
interface HrApi {

    @POST("auth/employee-login")
    suspend fun employeeLogin(@Body body: Map<String, String>): OtpResponse

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

    @GET("me")
    suspend fun me(): MeDto

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

    // ── Admin (reports + monitoring) ──
    @POST("auth/admin/login")
    suspend fun adminLogin(@Body body: Map<String, String>): AdminLoginResponse

    @GET("admin/dashboard/stats")
    suspend fun dashboardStats(): DashboardStatsDto

    @GET("admin/attendance/live")
    suspend fun liveAttendance(): List<LiveAttendanceRowDto>

    @GET("admin/reports/performance")
    suspend fun performance(): List<PerformanceRowDto>

    // ── Claims (employee) ──
    @GET("claims/my-claims")
    suspend fun myClaims(): ClaimListResponse

    @Multipart
    @POST("claims")
    suspend fun submitClaim(@Part parts: List<MultipartBody.Part>): ClaimCreatedResponse

    @Multipart
    @POST("claims/{id}/resubmit")
    suspend fun resubmitClaim(@Path("id") id: String, @Part parts: List<MultipartBody.Part>): ClaimCreatedResponse

    @POST("claims/{id}/reply")
    suspend fun replyClaim(@Path("id") id: String, @Body body: Map<String, String>): ClaimCreatedResponse

    // Printable A5 voucher PDF (half of an A4 sheet).
    @Streaming
    @GET("claims/{id}/voucher")
    suspend fun claimVoucher(@Path("id") id: String): ResponseBody

    // ── Claims (admin) ──
    @GET("admin/claims")
    suspend fun adminClaims(@Query("status") status: String?): ClaimListResponse

    @PATCH("admin/claims/{id}/approve")
    suspend fun approveClaim(@Path("id") id: String): ClaimCreatedResponse

    @PATCH("admin/claims/{id}/reject")
    suspend fun rejectClaim(@Path("id") id: String, @Body body: Map<String, String>): ClaimCreatedResponse

    @PATCH("admin/claims/{id}/clarify")
    suspend fun clarifyClaim(@Path("id") id: String, @Body body: Map<String, String>): ClaimCreatedResponse

    @PATCH("admin/claims/{id}/pay")
    suspend fun payClaim(@Path("id") id: String, @Body body: Map<String, String>): ClaimCreatedResponse

    // ── Employees (admin onboarding + face enrollment) ──
    @GET("admin/employees")
    suspend fun adminEmployees(): EmployeeListResponse

    @POST("admin/employees")
    suspend fun createEmployee(@Body body: Map<String, @JvmSuppressWildcards Any>): EmployeeCreatedResponse

    @Multipart
    @POST("admin/employees/{id}/enroll-face")
    suspend fun enrollFace(@Path("id") id: String, @Part photo: MultipartBody.Part): EnrollFaceResponse

    // Master data (Add-Employee form dropdowns)
    @GET("attendance/calendar")
    suspend fun attendanceCalendar(
        @retrofit2.http.Query("month") month: Int,
        @retrofit2.http.Query("year") year: Int,
    ): AttendanceCalendarResponse

    @POST("me/fcm-token")
    suspend fun registerFcmToken(@Body body: Map<String, String>): Map<String, Boolean>

    // In-app notifications (admin/cashier): claims to approve / approved claims to pay.
    @GET("admin/notifications")
    suspend fun notifications(): NotificationListResponse
    @retrofit2.http.PATCH("admin/notifications/read")
    suspend fun markNotificationsRead(): Map<String, Boolean>

    // Self-update check (public) — compares against BuildConfig.VERSION_CODE at launch.
    @GET("app/version")
    suspend fun appVersion(): AppVersionResponse

    @GET("admin/employees/managers")
    suspend fun managers(): ManagerListResponse
    @GET("admin/employees/next-code")
    suspend fun nextEmployeeCode(): Map<String, String>
    @GET("admin/branches")
    suspend fun branches(): BranchListResponse

    @GET("admin/departments")
    suspend fun departments(): DepartmentListResponse

    @GET("admin/designations")
    suspend fun designations(): DesignationListResponse

    @GET("shifts")
    suspend fun shifts(): ShiftListResponse

    // ── User access (SUPER_ADMIN) ──
    @GET("admin/users")
    suspend fun adminUsers(): AdminUserListResponse

    @POST("admin/users")
    suspend fun createAdminUser(@Body body: Map<String, String>): AdminUserResponse

    @PUT("admin/users/{id}")
    suspend fun updateAdminUser(@Path("id") id: String, @Body body: Map<String, @JvmSuppressWildcards Any>): AdminUserResponse
}
