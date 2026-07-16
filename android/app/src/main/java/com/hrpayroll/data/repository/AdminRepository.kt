package com.hrpayroll.data.repository

import com.hrpayroll.data.remote.HrApi
import com.hrpayroll.data.remote.dto.AdminUserDto
import com.hrpayroll.data.remote.dto.ClaimDto
import com.hrpayroll.data.remote.dto.DashboardStatsDto
import com.hrpayroll.data.remote.dto.LiveAttendanceRowDto
import com.hrpayroll.data.remote.dto.PerformanceRowDto
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.MultipartBody
import okhttp3.RequestBody.Companion.toRequestBody
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
    suspend fun payClaim(id: String, note: String?) =
        api.payClaim(id, if (note.isNullOrBlank()) emptyMap() else mapOf("note" to note))

    // Employee onboarding + face enrollment
    suspend fun employees() = api.adminEmployees().employees
    suspend fun createEmployee(body: Map<String, Any>) = api.createEmployee(body)
    suspend fun enrollFace(id: String, photo: ByteArray) = api.enrollFace(
        id,
        MultipartBody.Part.createFormData("photo", "face.jpg", photo.toRequestBody("image/jpeg".toMediaType())),
    )

    // Master data for the Add-Employee form
    suspend fun branches() = api.branches().branches
    suspend fun managers() = api.managers().managers
    suspend fun departments() = api.departments().departments
    suspend fun designations() = api.designations().designations
    suspend fun shifts() = api.shifts().shifts

    // User access (SUPER_ADMIN)
    suspend fun adminUsers(): List<AdminUserDto> = api.adminUsers().admins
    suspend fun createAdminUser(name: String, email: String, role: String, password: String) =
        api.createAdminUser(mapOf("name" to name, "email" to email, "role" to role, "password" to password))
    suspend fun setAdminActive(id: String, active: Boolean) =
        api.updateAdminUser(id, mapOf("isActive" to active))
}
