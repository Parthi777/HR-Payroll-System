package com.hrpayroll.data.repository

import com.hrpayroll.data.remote.HrApi
import com.hrpayroll.data.remote.dto.AttendanceDto
import com.hrpayroll.data.remote.dto.AttendanceHistoryDto
import com.hrpayroll.data.remote.dto.MissingCheckoutDto
import okhttp3.MediaType.Companion.toMediaTypeOrNull
import okhttp3.MultipartBody
import okhttp3.RequestBody.Companion.asRequestBody
import okhttp3.RequestBody.Companion.toRequestBody
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

    /**
     * Manual / selfie punch. Times are company wall-clock "HH:MM"; at least one
     * of checkIn / checkOut must be given. Always needs manager approval.
     */
    suspend fun manualPunch(
        mode: String,
        reason: String,
        date: String?,
        checkIn: String?,
        checkOut: String?,
        selfie: ByteArray?,
    ): AttendanceDto {
        // Text parts are built by hand rather than via @Part("name") String: the
        // only registered converter is Moshi, which would JSON-quote the values.
        val parts = buildList {
            add(MultipartBody.Part.createFormData("mode", mode))
            add(MultipartBody.Part.createFormData("reason", reason))
            date?.let { add(MultipartBody.Part.createFormData("date", it)) }
            checkIn?.let { add(MultipartBody.Part.createFormData("checkIn", it)) }
            checkOut?.let { add(MultipartBody.Part.createFormData("checkOut", it)) }
            selfie?.let {
                add(
                    MultipartBody.Part.createFormData(
                        "selfie",
                        "punch.jpg",
                        it.toRequestBody("image/jpeg".toMediaTypeOrNull()),
                    ),
                )
            }
        }
        return api.manualPunch(parts)
    }

    private fun selfiePart(selfie: File): MultipartBody.Part = MultipartBody.Part.createFormData(
        "selfie",
        selfie.name,
        selfie.asRequestBody("image/jpeg".toMediaTypeOrNull()),
    )

    suspend fun today(): AttendanceDto = api.today()

    /** The day the employee forgot to check out of (null when nothing is open). */
    suspend fun missingCheckout(): MissingCheckoutDto? = api.missingCheckout().pending

    suspend fun history(): List<AttendanceHistoryDto> = api.history()

    suspend fun calendar(month: Int, year: Int) = api.attendanceCalendar(month, year)
}
