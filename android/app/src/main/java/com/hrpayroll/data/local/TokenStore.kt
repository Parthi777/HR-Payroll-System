package com.hrpayroll.data.local

import android.content.Context
import androidx.security.crypto.EncryptedSharedPreferences
import androidx.security.crypto.MasterKey
import dagger.hilt.android.qualifiers.ApplicationContext
import javax.inject.Inject
import javax.inject.Singleton

/** JWT stored in EncryptedSharedPreferences (see CLAUDE.md Security). */
@Singleton
class TokenStore @Inject constructor(@ApplicationContext context: Context) {

    private val prefs by lazy {
        val masterKey = MasterKey.Builder(context)
            .setKeyScheme(MasterKey.KeyScheme.AES256_GCM)
            .build()
        EncryptedSharedPreferences.create(
            context,
            "hr_secure_prefs",
            masterKey,
            EncryptedSharedPreferences.PrefKeyEncryptionScheme.AES256_SIV,
            EncryptedSharedPreferences.PrefValueEncryptionScheme.AES256_GCM,
        )
    }

    fun getToken(): String? = prefs.getString(KEY_TOKEN, null)

    /** Persist the JWT and the caller's role (null for employee logins). */
    fun saveToken(token: String, role: String? = null) =
        prefs.edit().putString(KEY_TOKEN, token).putString(KEY_ROLE, role).apply()

    fun getRole(): String? = prefs.getString(KEY_ROLE, null)

    /**
     * The workspace (dealer) this device is signed in to.
     *
     * One APK serves every dealer and the API is a single host, so the workspace
     * travels as an X-Tenant-Slug header rather than in the URL. Null is normal
     * and fine: the backend resolves the only workspace when just one exists.
     */
    fun getTenantSlug(): String? = prefs.getString(KEY_TENANT_SLUG, null)

    /** The workspace's display name, shown in the app header. */
    fun getTenantName(): String? = prefs.getString(KEY_TENANT_NAME, null)

    fun saveTenant(slug: String, name: String?) =
        prefs.edit().putString(KEY_TENANT_SLUG, slug).putString(KEY_TENANT_NAME, name).apply()

    /** True for any admin role (SUPER_ADMIN / HR_MANAGER / …); false for employees. */
    fun isAdmin(): Boolean = getRole().let { it != null && it != "EMPLOYEE" }

    fun clear() = prefs.edit().clear().apply()

    private companion object {
        const val KEY_TOKEN = "jwt_token"
        const val KEY_ROLE = "user_role"
        const val KEY_TENANT_SLUG = "tenant_slug"
        const val KEY_TENANT_NAME = "tenant_name"
    }
}
