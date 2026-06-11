package com.hrpayroll.data.repository

import com.hrpayroll.data.remote.HrApi
import com.hrpayroll.data.remote.dto.ClaimDto
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.MultipartBody
import okhttp3.RequestBody.Companion.toRequestBody
import javax.inject.Inject

/** Employee claims: submit (photo + PDF), list, resubmit after clarification. */
class ClaimRepository @Inject constructor(
    private val api: HrApi,
) {
    suspend fun myClaims(): List<ClaimDto> = api.myClaims().claims

    suspend fun submit(
        type: String,
        title: String,
        amount: Double,
        description: String?,
        photo: ByteArray?,
        pdf: ByteArray?,
    ): ClaimDto? {
        val fields = buildMap {
            put("type", type)
            put("title", title)
            put("amount", amount.toString())
            if (!description.isNullOrBlank()) put("description", description)
        }
        return api.submitClaim(buildParts(fields, photo, pdf)).claim
    }

    suspend fun resubmit(
        id: String,
        description: String?,
        employeeNote: String?,
        photo: ByteArray?,
        pdf: ByteArray?,
    ): ClaimDto? {
        val fields = buildMap {
            if (!description.isNullOrBlank()) put("description", description)
            if (!employeeNote.isNullOrBlank()) put("employeeNote", employeeNote)
        }
        return api.resubmitClaim(id, buildParts(fields, photo, pdf)).claim
    }

    private fun buildParts(
        fields: Map<String, String>,
        photo: ByteArray?,
        pdf: ByteArray?,
    ): List<MultipartBody.Part> = buildList {
        fields.forEach { (k, v) -> add(MultipartBody.Part.createFormData(k, v)) }
        photo?.let {
            add(MultipartBody.Part.createFormData("photo", "receipt.jpg", it.toRequestBody("image/jpeg".toMediaType())))
        }
        pdf?.let {
            add(MultipartBody.Part.createFormData("pdf", "document.pdf", it.toRequestBody("application/pdf".toMediaType())))
        }
    }
}
