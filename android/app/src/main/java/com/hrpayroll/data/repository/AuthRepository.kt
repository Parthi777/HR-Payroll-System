package com.hrpayroll.data.repository

import com.hrpayroll.data.local.TokenStore
import com.hrpayroll.data.remote.HrApi
import com.hrpayroll.data.remote.dto.AdminLoginResponse
import com.hrpayroll.data.remote.dto.AdminPasswordStep
import com.hrpayroll.data.remote.dto.TwoStepSetupDto
import javax.inject.Inject

/**
 * Sign-in with credentials an administrator issued: an employee's user ID
 * (employee code or phone) + password, or an admin's email + password + a code
 * from an authenticator app. Persists the issued JWT so the OkHttp interceptor
 * can attach it.
 */
class AuthRepository @Inject constructor(
    private val api: HrApi,
    private val tokenStore: TokenStore,
    private val tracking: TrackingController,
    private val consent: com.hrpayroll.data.local.ConsentPrefs,
) {
    /**
     * Employee login with their user ID — employee code (EMP001) or phone
     * number — and the password the admin issued.
     *
     * `companyCode` names the workspace. It is only needed once — it is stored
     * and sent on every later request — and only at all when more than one
     * workspace exists, since the backend resolves the single one on its own.
     */
    suspend fun employeeLogin(userId: String, password: String, companyCode: String? = null): Boolean {
        rememberCompanyCode(companyCode)
        val res = api.employeeLogin(mapOf("userId" to normalizeUserId(userId), "password" to password))
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

    /**
     * Admin login, first step: email + password. Returns the challenge for the
     * second step — no session is stored until a code from the authenticator
     * app has been accepted.
     */
    suspend fun adminLogin(email: String, password: String, companyCode: String? = null): AdminPasswordStep {
        rememberCompanyCode(companyCode)
        val res = api.adminLogin(mapOf("email" to email.trim(), "password" to password))
        saveResolvedTenant(res.tenant?.slug, res.tenant?.name)
        return res
    }

    /** Second step for an enrolled account: the 6-digit code, or a recovery code. */
    suspend fun verifyTwoStep(challenge: String, code: String): AdminLoginResponse =
        api.adminTwoStepVerify(mapOf("challenge" to challenge, "code" to code.trim())).also(::storeAdminSession)

    /** First sign-in: a new authenticator secret to add to the phone's app. */
    suspend fun setupTwoStep(challenge: String): TwoStepSetupDto =
        api.adminTwoStepSetup(mapOf("challenge" to challenge))

    /** Confirm setup with a code from the new entry; returns the recovery codes, once. */
    suspend fun enableTwoStep(challenge: String, code: String): AdminLoginResponse =
        api.adminTwoStepEnable(mapOf("challenge" to challenge, "code" to code.trim())).also(::storeAdminSession)

    private fun storeAdminSession(res: AdminLoginResponse) {
        val token = res.token ?: throw IllegalStateException("Sign-in did not return a session")
        tokenStore.saveToken(token, res.role ?: "ADMIN")
        saveResolvedTenant(res.tenant?.slug, res.tenant?.name)
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

    /** Signing out also ends live tracking — nobody is followed after leaving the app. */
    fun logout() {
        tracking.stopForLogout()
        // The agreement stays with the phone, but the next person to sign in has
        // it recorded against them too.
        consent.resetSync()
        tokenStore.clear()
    }

    /**
     * A phone number is normalised to "+91…" (spaces and dashes stripped, +91
     * added to a bare 10-digit number); anything else is an employee code and
     * goes as typed, trimmed — the server matches codes in either case.
     */
    private fun normalizeUserId(userId: String): String {
        val trimmed = userId.trim()
        val looksLikePhone = trimmed.isNotEmpty() && trimmed.all { it.isDigit() || it in "+ -" }
        if (!looksLikePhone) return trimmed
        val cleaned = trimmed.filter { it.isDigit() || it == '+' }
        return if (!cleaned.startsWith("+") && cleaned.length == 10) "+91$cleaned" else cleaned
    }
}
