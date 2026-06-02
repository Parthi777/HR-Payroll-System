package com.hrpayroll.service

import android.app.Service
import android.content.Intent
import android.os.IBinder
import dagger.hilt.android.AndroidEntryPoint

/**
 * Foreground service for continuous (battery-efficient) GPS tracking during a shift.
 * Logs location every ~5 min and checks geofence; alerts on violation.
 * TODO: FusedLocationProvider with significant-change updates + WorkManager upload.
 */
@AndroidEntryPoint
class LocationTrackingService : Service() {
    override fun onBind(intent: Intent?): IBinder? = null

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        // TODO: startForeground(...) with a persistent notification; request location updates
        return START_STICKY
    }
}
