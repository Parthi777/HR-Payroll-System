package com.hrpayroll.data.repository

import com.hrpayroll.data.remote.HrApi
import com.hrpayroll.data.remote.dto.AttendanceDto
import com.hrpayroll.data.remote.dto.AttendanceHistoryDto
import okhttp3.MediaType.Companion.toMediaTypeOrNull
import okhttp3.MultipartBody
import okhttp3.RequestBody.Companion.asRequestBody
import java.io.File
import javax.inject.Inject

/** Repository: ViewModel -> UseCase -> Repository -> API/Room (see CLAUDE.md conventions). */
class AttendanceRepository @Inject constructor(
    private val api: HrApi,
) {
    suspend fun checkIn(selfie: File, lat: Double, lng: Double, accuracy: Float): AttendanceDto =
        api.checkIn(selfiePart(selfie), lat.toString(), lng.toString(), accuracy.toString())

    suspend fun checkOut(selfie: File, lat: Double, lng: Double): AttendanceDto =
        api.checkOut(selfiePart(selfie), lat.toString(), lng.toString())

    private fun selfiePart(selfie: File): MultipartBody.Part = MultipartBody.Part.createFormData(
        "selfie",
        selfie.name,
        selfie.asRequestBody("image/jpeg".toMediaTypeOrNull()),
    )

    suspend fun today(): AttendanceDto = api.today()

    suspend fun history(): List<AttendanceHistoryDto> = api.history()
}
