package com.hrpayroll.service

import android.Manifest
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.os.Build
import androidx.core.content.ContextCompat
import com.hrpayroll.data.local.TrackingPrefs

/**
 * Picks live tracking back up after the phone restarts or the app updates
 * itself (an update kills the running service). Only when a tracked day is
 * still stored and the phone allows location "all the time" — starting a
 * location service from the background is refused without it.
 */
class TrackingBootReceiver : BroadcastReceiver() {
    override fun onReceive(context: Context, intent: Intent) {
        if (intent.action != Intent.ACTION_BOOT_COMPLETED && intent.action != Intent.ACTION_MY_PACKAGE_REPLACED) return
        val prefs = TrackingPrefs(context.applicationContext)
        if (!prefs.active) return
        if (prefs.isStale()) {
            prefs.clear()
            return
        }
        val fine = granted(context, Manifest.permission.ACCESS_FINE_LOCATION) ||
            granted(context, Manifest.permission.ACCESS_COARSE_LOCATION)
        val background = Build.VERSION.SDK_INT < Build.VERSION_CODES.Q ||
            granted(context, Manifest.permission.ACCESS_BACKGROUND_LOCATION)
        if (!fine || !background) return
        runCatching {
            ContextCompat.startForegroundService(context, Intent(context, LocationTrackingService::class.java))
        }
    }

    private fun granted(context: Context, permission: String) =
        ContextCompat.checkSelfPermission(context, permission) == PackageManager.PERMISSION_GRANTED
}
