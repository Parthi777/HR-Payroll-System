package com.hrpayroll.data.repository

import com.hrpayroll.data.local.TokenStore
import com.hrpayroll.data.remote.HrApi
import javax.inject.Inject

/** Phone + password auth. Persists the issued JWT so the OkHttp interceptor can attach it. */
class AuthRepository @Inject constructor(
    private val api: HrApi,
    private val tokenStore: TokenStore,
) {
    /**
     * Employee login with phone + password (password set by admin at creation).
     *
     * `companyCode` names the workspace. It is only needed once — it is stored
     * and sent on every later request — and only at all when more than one
     * workspace exists, since the backend resolves the single one on its own.
     */
    suspend fun employeeLogin(phone: String, password: String, companyCode: String? = null): Boolean {
        rememberCompanyCode(companyCode)
        val res = api.employeeLogin(mapOf("phone" to normalizePhone(phone), "password" to password))
        val token = res.token
        return if (!token.isNullOrBlank()) {
            tokenStore.saveToken(token)
            saveResolvedTenant(res.tenant?.slug, res.tenant?.name)
            true
        } else {
            false
        }
    }

    /** Register this device for push after login (no-op server-side until Firebase is wired). */
    suspend fun registerFcmToken(token: String) {
        api.registerFcmToken(mapOf("token" to token))
    }

    /** Admin login (email + password). Stores the JWT + role; reports if a token was issued. */
    suspend fun adminLogin(email: String, password: String, companyCode: String? = null): Boolean {
        rememberCompanyCode(companyCode)
        val res = api.adminLogin(mapOf("email" to email.trim(), "password" to password))
        val token = res.token
        return if (!token.isNullOrBlank()) {
            tokenStore.saveToken(token, res.role ?: "ADMIN")
            saveResolvedTenant(res.tenant?.slug, res.tenant?.name)
            true
        } else {
            false
        }
    }

    /** The workspace this device is signed in to, for the app header. */
    fun tenantName(): String? = tokenStore.getTenantName()

    /**
     * Store a typed company code before the request, so the interceptor sends it
     * on the login call itself — that is the request that needs it most.
     */
    private fun rememberCompanyCode(code: String?) {
        val slug = code?.trim()?.lowercase()?.takeIf { it.isNotEmpty() } ?: return
        tokenStore.saveTenant(slug, tokenStore.getTenantName())
    }

    /** Replace it with what the server actually resolved, which is authoritative. */
    private fun saveResolvedTenant(slug: String?, name: String?) {
        if (!slug.isNullOrBlank()) tokenStore.saveTenant(slug, name)
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
