package com.hrpayroll.data.local

import android.content.Context
import dagger.hilt.android.qualifiers.ApplicationContext
import javax.inject.Inject
import javax.inject.Singleton

/**
 * Remembers that the user has already been asked about a published version.
 *
 * The launch check used to keep its answer in memory only, so it re-prompted on
 * every cold start *and* every Activity recreation — a device that could not
 * finish the install was nagged several times a day, forever.
 */
@Singleton
class UpdatePrefs @Inject constructor(@ApplicationContext context: Context) {

    private val prefs = context.getSharedPreferences("hr_update_prefs", Context.MODE_PRIVATE)

    /** False while the snooze for this exact versionCode is still running. */
    fun shouldPrompt(versionCode: Int): Boolean =
        prefs.getInt(KEY_SNOOZE_CODE, 0) != versionCode ||
            System.currentTimeMillis() >= prefs.getLong(KEY_SNOOZE_UNTIL, 0L)

    /** "Later" — stay quiet for a day. */
    fun snooze(versionCode: Int) = snoozeFor(versionCode, DISMISS_SNOOZE_MS)

    /** Update started — quiet for a few hours, so a failed install can still be retried today. */
    fun snoozeWhileUpdating(versionCode: Int) = snoozeFor(versionCode, UPDATING_SNOOZE_MS)

    private fun snoozeFor(versionCode: Int, millis: Long) =
        prefs.edit()
            .putInt(KEY_SNOOZE_CODE, versionCode)
            .putLong(KEY_SNOOZE_UNTIL, System.currentTimeMillis() + millis)
            .apply()

    /** Keep the DownloadManager id so a finished download survives the app being closed. */
    fun rememberDownload(id: Long, versionCode: Int) =
        prefs.edit().putLong(KEY_DOWNLOAD_ID, id).putInt(KEY_DOWNLOAD_CODE, versionCode).apply()

    /** The queued/finished download for this version, if the last one was for it. */
    fun downloadIdFor(versionCode: Int): Long? =
        prefs.getLong(KEY_DOWNLOAD_ID, -1L)
            .takeIf { it >= 0 && prefs.getInt(KEY_DOWNLOAD_CODE, 0) == versionCode }

    private companion object {
        const val KEY_SNOOZE_CODE = "snoozed_version_code"
        const val KEY_SNOOZE_UNTIL = "snoozed_until"
        const val KEY_DOWNLOAD_ID = "download_id"
        const val KEY_DOWNLOAD_CODE = "download_version_code"
        const val DISMISS_SNOOZE_MS = 24 * 60 * 60 * 1000L
        const val UPDATING_SNOOZE_MS = 6 * 60 * 60 * 1000L
    }
}
