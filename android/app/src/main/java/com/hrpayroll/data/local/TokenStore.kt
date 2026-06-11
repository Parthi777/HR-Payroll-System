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

    /** True for any admin role (SUPER_ADMIN / HR_MANAGER / …); false for employees. */
    fun isAdmin(): Boolean = getRole().let { it != null && it != "EMPLOYEE" }

    fun clear() = prefs.edit().clear().apply()

    private companion object {
        const val KEY_TOKEN = "jwt_token"
        const val KEY_ROLE = "user_role"
    }
}
