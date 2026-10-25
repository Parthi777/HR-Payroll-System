package com.hrpayroll.service

import android.annotation.SuppressLint
import android.app.Notification
import android.app.PendingIntent
import android.app.Service
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.content.IntentFilter
import android.content.pm.ServiceInfo
import android.location.LocationManager
import android.os.Build
import android.os.IBinder
import android.os.Looper
import androidx.core.app.NotificationCompat
import androidx.core.app.ServiceCompat
import androidx.core.content.ContextCompat
import com.google.android.gms.location.FusedLocationProviderClient
import com.google.android.gms.location.LocationAvailability
import com.google.android.gms.location.LocationCallback
import com.google.android.gms.location.LocationRequest
import com.google.android.gms.location.LocationResult
import com.google.android.gms.location.LocationServices
import com.google.android.gms.location.Priority
import com.hrpayroll.HrPayrollApp
import com.hrpayroll.MainActivity
import com.hrpayroll.R
import com.hrpayroll.data.local.TrackingPrefs
import com.hrpayroll.data.repository.TrackingController
import com.hrpayroll.utils.LocationUtils
import dagger.hilt.android.AndroidEntryPoint
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.cancel
import kotlinx.coroutines.delay
import kotlinx.coroutines.isActive
import kotlinx.coroutines.launch
import javax.inject.Inject

/**
 * Records the employee's location every two minutes from check-in to
 * check-out, for the dealer's Live Tracking page (docs/LIVE-TRACKING.md).
 *
 * A foreground service, so the phone shows a notification the whole time it
 * runs — nobody is followed without knowing it. Started and stopped only by
 * [TrackingController]; it does nothing if no tracked day is stored.
 */
@AndroidEntryPoint
class LocationTrackingService : Service() {

    @Inject lateinit var controller: TrackingController
    @Inject lateinit var prefs: TrackingPrefs

    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.IO)
    private lateinit var fused: FusedLocationProviderClient
    private var listening = false
    private var ticker: Job? = null

    private val callback = object : LocationCallback() {
        override fun onLocationResult(result: LocationResult) {
            result.locations.forEach(controller::recordFix)
        }

        override fun onLocationAvailability(availability: LocationAvailability) {
            if (!availability.isLocationAvailable && !LocationUtils.locationEnabled(this@LocationTrackingService)) {
                controller.recordEvent(TrackingController.GPS_OFF)
            }
        }
    }

    /** Location switched off or on in quick settings. */
    private val providers = object : BroadcastReceiver() {
        override fun onReceive(context: Context, intent: Intent) {
            controller.recordEvent(
                if (LocationUtils.locationEnabled(context)) TrackingController.GPS_ON else TrackingController.GPS_OFF,
            )
        }
    }

    override fun onBind(intent: Intent?): IBinder? = null

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        if (!prefs.active || prefs.isStale()) {
            stopSelf()
            return START_NOT_STICKY
        }
        try {
            ServiceCompat.startForeground(
                this, NOTIFICATION_ID, notification(),
                if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) ServiceInfo.FOREGROUND_SERVICE_TYPE_LOCATION else 0,
            )
        } catch (e: Exception) {
            // No location permission (Android 14 checks it here), or started
            // from the background where Android no longer allows it.
            controller.recordEvent(TrackingController.NO_PERMISSION)
            stopSelf()
            return START_NOT_STICKY
        }
        running = true
        if (!listening) listen()
        return START_STICKY
    }

    @SuppressLint("MissingPermission")
    private fun listen() {
        if (!LocationUtils.hasPermission(this)) {
            controller.recordEvent(TrackingController.NO_PERMISSION)
            return
        }
        listening = true
        fused = LocationServices.getFusedLocationProviderClient(this)
        val intervalMs = prefs.intervalSec * 1000L
        // High accuracy: fences are ~100 m, and a Wi-Fi/cell position is often
        // further off than that — it would show time away that never happened.
        val priority = if (LocationUtils.hasPrecise(this)) Priority.PRIORITY_HIGH_ACCURACY else Priority.PRIORITY_BALANCED_POWER_ACCURACY
        val request = LocationRequest.Builder(priority, intervalMs)
            .setMinUpdateIntervalMillis(intervalMs / 2)
            .setWaitForAccurateLocation(false)
            .build()
        fused.requestLocationUpdates(request, callback, Looper.getMainLooper())
        ContextCompat.registerReceiver(
            this, providers, IntentFilter(LocationManager.PROVIDERS_CHANGED_ACTION), ContextCompat.RECEIVER_NOT_EXPORTED,
        )
        // Drain anything queued while offline, even when no new fix arrives.
        ticker = scope.launch {
            while (isActive) {
                delay(intervalMs)
                runCatching { controller.flush() }
            }
        }
    }

    private fun notification(): Notification {
        val open = PendingIntent.getActivity(
            this, 0, Intent(this, MainActivity::class.java).addFlags(Intent.FLAG_ACTIVITY_SINGLE_TOP),
            PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT,
        )
        return NotificationCompat.Builder(this, HrPayrollApp.TRACKING_CHANNEL_ID)
            .setSmallIcon(R.drawable.ic_stat_kayaazh)
            .setColor(0xFF00A174.toInt())
            .setContentTitle("Location monitoring on")
            .setContentText("Kayaazh Payroll is recording your location until you check out.")
            .setOngoing(true)
            .setOnlyAlertOnce(true)
            .setCategory(NotificationCompat.CATEGORY_SERVICE)
            .setContentIntent(open)
            .build()
    }

    override fun onDestroy() {
        running = false
        if (listening) {
            fused.removeLocationUpdates(callback)
            runCatching { unregisterReceiver(providers) }
        }
        ticker?.cancel()
        scope.cancel()
        super.onDestroy()
    }

    companion object {
        private const val NOTIFICATION_ID = 4201

        /** Whether the service is up in this process — so a resume does not start a second one. */
        @Volatile var running: Boolean = false
            private set
    }
}
