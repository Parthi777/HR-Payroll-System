package com.hrpayroll.data.local

import android.content.Context
import dagger.hilt.android.qualifiers.ApplicationContext
import javax.inject.Inject
import javax.inject.Singleton

/**
 * Whether this phone's user has agreed to the consent screen — terms, privacy,
 * and location used for geofenced attendance and live tracking — and whether
 * that agreement has reached the server yet.
 *
 * Asked before anyone signs in, so it is per install. Raising [CURRENT_VERSION]
 * (after changing what the screen says) asks everyone again.
 */
@Singleton
class ConsentPrefs @Inject constructor(@ApplicationContext context: Context) {

    private val prefs = context.getSharedPreferences("hr_consent_prefs", Context.MODE_PRIVATE)

    val accepted: Boolean get() = prefs.getInt(KEY_VERSION, 0) >= CURRENT_VERSION
    val acceptedVersion: Int get() = prefs.getInt(KEY_VERSION, 0)
    val acceptedAt: Long get() = prefs.getLong(KEY_AT, 0L)

    /** Agreed on this phone, but the server has not recorded it for the signed-in employee yet. */
    val needsSync: Boolean get() = accepted && prefs.getInt(KEY_SYNCED, 0) < acceptedVersion

    fun accept() {
        prefs.edit()
            .putInt(KEY_VERSION, CURRENT_VERSION)
            .putLong(KEY_AT, System.currentTimeMillis())
            .apply()
    }

    fun markSynced(version: Int) = prefs.edit().putInt(KEY_SYNCED, version).apply()

    /** A different person may sign in next; their agreement is recorded against them anew. */
    fun resetSync() = prefs.edit().remove(KEY_SYNCED).apply()

    companion object {
        /** Bump when the consent wording changes — everyone is asked again. Matches the server's record. */
        const val CURRENT_VERSION = 1
        private const val KEY_VERSION = "accepted_version"
        private const val KEY_AT = "accepted_at"
        private const val KEY_SYNCED = "synced_version"
    }
}
