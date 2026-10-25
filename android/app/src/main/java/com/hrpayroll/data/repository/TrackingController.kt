package com.hrpayroll.data.repository

import android.content.Context
import android.content.Intent
import android.location.Location
import android.os.Build
import androidx.core.content.ContextCompat
import com.hrpayroll.data.local.GpsPointDao
import com.hrpayroll.data.local.GpsPointEntity
import com.hrpayroll.data.local.TrackingPrefs
import com.hrpayroll.data.remote.HrApi
import com.hrpayroll.data.remote.dto.GpsBatchRequest
import com.hrpayroll.data.remote.dto.GpsEventDto
import com.hrpayroll.data.remote.dto.GpsPointDto
import com.hrpayroll.service.LocationTrackingService
import com.hrpayroll.utils.LocationUtils
import dagger.hilt.android.qualifiers.ApplicationContext
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.launch
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock
import retrofit2.HttpException
import java.io.IOException
import java.time.Instant
import javax.inject.Inject
import javax.inject.Singleton

/**
 * Live tracking between check-in and check-out (docs/LIVE-TRACKING.md).
 *
 * Starts the foreground [LocationTrackingService] when a check-in says the day
 * is tracked, queues each fix in Room, and uploads the queue. The server has
 * the last word: when an upload answers `tracking = false` — checked out on a
 * kiosk, switched off in Settings, exempted — the phone stops.
 */
@Singleton
class TrackingController @Inject constructor(
    @ApplicationContext private val context: Context,
    private val prefs: TrackingPrefs,
    private val dao: GpsPointDao,
    private val api: HrApi,
) {
    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.IO)
    private val flushLock = Mutex()

    private val _active = MutableStateFlow(prefs.active)
    /** Monitoring is on for an open day — Home shows a chip while it is. */
    val isActive: StateFlow<Boolean> = _active.asStateFlow()

    /**
     * Begin tracking [attendanceId]. Called right after a check-in, while the app
     * is on screen — Android 12+ refuses to start a location service from the
     * background.
     */
    fun start(attendanceId: String, intervalSec: Int) {
        prefs.begin(attendanceId, intervalSec)
        _active.value = true
        if (!LocationUtils.hasPermission(context)) {
            // Starting a location service without the permission crashes on
            // Android 14. Tell the server instead: the day reads "GPS off".
            recordEvent(NO_PERMISSION)
            return
        }
        if (!LocationUtils.locationEnabled(context)) recordEvent(GPS_OFF)
        startService()
    }

    /** Checked out (or the server said stop): end the service and send what is left. */
    fun stop() {
        stopLocal()
        scope.launch { flush() }
    }

    /**
     * Signed out. The session is about to be cleared, so queued fixes could not
     * be uploaded anyway; the server reads the rest of the day as no signal.
     */
    fun stopForLogout() {
        stopLocal()
        scope.launch { dao.deleteAll() }
    }

    /**
     * Ask the server whether a day should be tracking now and match it — after
     * the app was killed, the phone restarted, or the day closed elsewhere.
     */
    suspend fun resume() {
        val t = try {
            api.tracking()
        } catch (e: IOException) {
            // Offline: carry on with what was stored, if anything.
            if (prefs.active && !prefs.isStale() && !LocationTrackingService.running) startService()
            return
        } catch (e: HttpException) {
            return
        }
        val id = t.attendanceId
        when {
            t.enabled && id != null -> {
                if (!prefs.active || prefs.attendanceId != id) start(id, t.intervalSec)
                else if (!LocationTrackingService.running && LocationUtils.hasPermission(context)) startService()
            }
            prefs.active -> stopLocal()
        }
    }

    fun recordFix(location: Location) {
        val id = prefs.attendanceId ?: return
        val mock = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) location.isMock
        else @Suppress("DEPRECATION") location.isFromMockProvider
        scope.launch {
            dao.insert(
                GpsPointEntity(
                    attendanceId = id, kind = FIX, lat = location.latitude, lng = location.longitude,
                    accuracy = if (location.hasAccuracy()) location.accuracy else null,
                    ts = location.time.takeIf { it > 0 } ?: System.currentTimeMillis(), mock = mock,
                ),
            )
            flush()
        }
    }

    /** GPS switched off / back on, or no permission. The same event twice in a row is recorded once. */
    fun recordEvent(kind: String) {
        val id = prefs.attendanceId ?: return
        if (prefs.lastEventKind == kind) return
        prefs.lastEventKind = kind
        scope.launch {
            dao.insert(GpsPointEntity(attendanceId = id, kind = kind, ts = System.currentTimeMillis()))
            flush()
        }
    }

    /**
     * Upload everything queued, oldest first. A network failure keeps the queue
     * for next time; a refusal (signed out, the day gone) drops that day's
     * points rather than retrying them forever.
     */
    suspend fun flush() = flushLock.withLock {
        for (attendanceId in dao.attendanceIds()) {
            while (true) {
                val batch = dao.oldest(attendanceId, BATCH)
                if (batch.isEmpty()) break
                val res = try {
                    api.gpsLog(
                        GpsBatchRequest(
                            attendanceId = attendanceId,
                            points = batch.filter { it.kind == FIX && it.lat != null && it.lng != null }.map {
                                GpsPointDto(Instant.ofEpochMilli(it.ts).toString(), it.lat!!, it.lng!!, it.accuracy, it.mock)
                            },
                            events = batch.filter { it.kind != FIX }.map {
                                GpsEventDto(Instant.ofEpochMilli(it.ts).toString(), it.kind)
                            },
                        ),
                    )
                } catch (e: IOException) {
                    return@withLock
                } catch (e: HttpException) {
                    if (e.code() in 400..499) {
                        dao.deleteFor(attendanceId)
                        if (prefs.attendanceId == attendanceId) stopLocal()
                    }
                    break
                }
                dao.deleteIds(batch.map { it.id })
                if (!res.tracking && prefs.attendanceId == attendanceId) stopLocal()
                if (batch.size < BATCH) break
            }
        }
    }

    private fun startService() {
        runCatching {
            ContextCompat.startForegroundService(context, Intent(context, LocationTrackingService::class.java))
        }
    }

    private fun stopLocal() {
        prefs.clear()
        _active.value = false
        context.stopService(Intent(context, LocationTrackingService::class.java))
    }

    companion object {
        const val FIX = "FIX"
        const val GPS_OFF = "GPS_OFF"
        const val GPS_ON = "GPS_ON"
        const val NO_PERMISSION = "NO_PERMISSION"
        private const val BATCH = 200
    }
}
