package com.hrpayroll.data.repository

import com.hrpayroll.data.remote.HrApi
import com.hrpayroll.data.remote.dto.ClaimDto
import com.hrpayroll.data.remote.dto.DashboardStatsDto
import com.hrpayroll.data.remote.dto.LiveAttendanceRowDto
import com.hrpayroll.data.remote.dto.PerformanceRowDto
import javax.inject.Inject

/** Admin-facing reads + actions: dashboard, live feed, performance, claims approval. */
class AdminRepository @Inject constructor(
    private val api: HrApi,
) {
    suspend fun dashboardStats(): DashboardStatsDto = api.dashboardStats()
    suspend fun liveAttendance(): List<LiveAttendanceRowDto> = api.liveAttendance()
    suspend fun performance(): List<PerformanceRowDto> = api.performance()

    suspend fun claims(status: String?): List<ClaimDto> = api.adminClaims(status).claims
    suspend fun approveClaim(id: String) = api.approveClaim(id)
    suspend fun rejectClaim(id: String, note: String) = api.rejectClaim(id, mapOf("note" to note))
    suspend fun clarifyClaim(id: String, note: String) = api.clarifyClaim(id, mapOf("note" to note))
}
