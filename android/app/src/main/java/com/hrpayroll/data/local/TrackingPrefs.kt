package com.hrpayroll.data.local

import android.content.Context
import dagger.hilt.android.qualifiers.ApplicationContext
import javax.inject.Inject
import javax.inject.Singleton

/**
 * Which day the phone is tracking, kept on disk so the tracking service can
 * pick up again after Android kills it, the phone restarts, or the app updates
 * itself — all of which wipe anything held in memory.
 *
 * Plain SharedPreferences: an attendance id and an interval are not secrets.
 */
@Singleton
class TrackingPrefs @Inject constructor(@ApplicationContext context: Context) {

    private val prefs = context.getSharedPreferences("hr_tracking_prefs", Context.MODE_PRIVATE)

    val active: Boolean get() = prefs.getBoolean(KEY_ACTIVE, false)
    val attendanceId: String? get() = prefs.getString(KEY_ATTENDANCE, null)
    val intervalSec: Int get() = prefs.getInt(KEY_INTERVAL, DEFAULT_INTERVAL_SEC)
    val startedAt: Long get() = prefs.getLong(KEY_STARTED, 0L)

    /** The last GPS event recorded, so "GPS off" is not queued again on every callback. */
    var lastEventKind: String?
        get() = prefs.getString(KEY_LAST_EVENT, null)
        set(value) = prefs.edit().putString(KEY_LAST_EVENT, value).apply()

    fun begin(attendanceId: String, intervalSec: Int) {
        prefs.edit()
            .putBoolean(KEY_ACTIVE, true)
            .putString(KEY_ATTENDANCE, attendanceId)
            .putInt(KEY_INTERVAL, intervalSec.coerceIn(30, 900))
            .putLong(KEY_STARTED, System.currentTimeMillis())
            .remove(KEY_LAST_EVENT)
            .apply()
    }

    fun clear() = prefs.edit().clear().apply()

    /**
     * Nothing is tracked for longer than a night shift. A day left "active" past
     * this — the phone was off overnight, the check-out happened on a kiosk — is
     * stale, and resuming it would follow someone home.
     */
    fun isStale(now: Long = System.currentTimeMillis()): Boolean = now - startedAt > MAX_AGE_MS

    private companion object {
        const val KEY_ACTIVE = "active"
        const val KEY_ATTENDANCE = "attendance_id"
        const val KEY_INTERVAL = "interval_sec"
        const val KEY_STARTED = "started_at"
        const val KEY_LAST_EVENT = "last_event"
        const val DEFAULT_INTERVAL_SEC = 120
        const val MAX_AGE_MS = 17L * 60 * 60 * 1000
    }
}
