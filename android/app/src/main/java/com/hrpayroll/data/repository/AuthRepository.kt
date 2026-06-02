package com.hrpayroll.data.repository

import com.hrpayroll.data.local.TokenStore
import com.hrpayroll.data.remote.HrApi
import javax.inject.Inject

/** Phone + OTP auth. Persists the issued JWT so the OkHttp interceptor can attach it. */
class AuthRepository @Inject constructor(
    private val api: HrApi,
    private val tokenStore: TokenStore,
) {
    /** Returns the dev OTP if the backend exposed one (no SMS provider wired), else null. */
    suspend fun sendOtp(phone: String): String? {
        return api.sendOtp(mapOf("phone" to phone)).devOtp
    }

    /** Verify OTP, store the returned JWT, and report whether a token was issued. */
    suspend fun verifyOtp(phone: String, otp: String): Boolean {
        val res = api.verifyOtp(mapOf("phone" to phone, "otp" to otp))
        val token = res.token
        return if (!token.isNullOrBlank()) {
            tokenStore.saveToken(token)
            true
        } else {
            false
        }
    }

    fun isLoggedIn(): Boolean = !tokenStore.getToken().isNullOrBlank()

    fun logout() = tokenStore.clear()
}
