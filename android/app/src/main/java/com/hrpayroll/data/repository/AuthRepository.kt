package com.hrpayroll.data.repository

import com.hrpayroll.data.local.TokenStore
import com.hrpayroll.data.remote.HrApi
import javax.inject.Inject

/** Phone + password auth. Persists the issued JWT so the OkHttp interceptor can attach it. */
class AuthRepository @Inject constructor(
    private val api: HrApi,
    private val tokenStore: TokenStore,
) {
    /** Employee login with phone + password (password set by admin at creation). */
    suspend fun employeeLogin(phone: String, password: String): Boolean {
        val res = api.employeeLogin(mapOf("phone" to normalizePhone(phone), "password" to password))
        val token = res.token
        return if (!token.isNullOrBlank()) {
            tokenStore.saveToken(token)
            true
        } else {
            false
        }
    }

    /** Admin login (email + password). Stores the JWT + role; reports if a token was issued. */
    suspend fun adminLogin(email: String, password: String): Boolean {
        val res = api.adminLogin(mapOf("email" to email.trim(), "password" to password))
        val token = res.token
        return if (!token.isNullOrBlank()) {
            tokenStore.saveToken(token, res.role ?: "ADMIN")
            true
        } else {
            false
        }
    }

    fun isLoggedIn(): Boolean = !tokenStore.getToken().isNullOrBlank()

    fun isAdmin(): Boolean = tokenStore.isAdmin()

    fun logout() = tokenStore.clear()

    /** Normalize to "+91…": strip spaces/dashes, and prefix +91 for a bare 10-digit number. */
    private fun normalizePhone(phone: String): String {
        val cleaned = phone.filter { it.isDigit() || it == '+' }
        return if (!cleaned.startsWith("+") && cleaned.length == 10) "+91$cleaned" else cleaned
    }
}
