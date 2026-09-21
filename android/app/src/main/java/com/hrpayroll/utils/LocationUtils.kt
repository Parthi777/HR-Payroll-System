package com.hrpayroll.utils

import android.annotation.SuppressLint
import android.content.Context
import android.content.pm.PackageManager
import android.location.Geocoder
import android.os.Build
import androidx.core.content.ContextCompat
import com.google.android.gms.location.LocationServices
import com.google.android.gms.location.Priority
import com.google.android.gms.tasks.CancellationTokenSource
import kotlin.coroutines.resume
import kotlinx.coroutines.suspendCancellableCoroutine
import kotlinx.coroutines.withTimeoutOrNull

/**
 * Where the phone is, and what that place is called.
 *
 * One implementation for both punch paths. The camera screen had its own copy
 * and the manual punch had none at all, which is why a selfie punch used to
 * reach a manager with no location on it whatsoever.
 */
data class Fix(
    val lat: Double,
    val lng: Double,
    val accuracy: Float,
) {
    /** (0,0) is what the provider gives when it never got a fix — not Null Island. */
    val hasFix: Boolean get() = lat != 0.0 || lng != 0.0
}

object LocationUtils {

    /** Both kinds, so a caller can ask for whichever it is missing. */
    val PERMISSIONS = arrayOf(
        android.Manifest.permission.ACCESS_FINE_LOCATION,
        android.Manifest.permission.ACCESS_COARSE_LOCATION,
    )

    private fun granted(context: Context, permission: String) =
        ContextCompat.checkSelfPermission(context, permission) == PackageManager.PERMISSION_GRANTED

    /** Precise location — the only kind the geofence check-in can use. */
    fun hasPrecise(context: Context): Boolean =
        granted(context, android.Manifest.permission.ACCESS_FINE_LOCATION)

    /**
     * Any location at all, precise or approximate.
     *
     * Deliberately not `hasPrecise`. Android 12 lets a person answer the
     * permission dialog with "Approximate", which grants COARSE and denies
     * FINE — and a check for FINE alone then reads that as no permission and
     * stamps "Location unavailable" on a phone that knows perfectly well which
     * town it is in. For evidence on a photograph a coarse fix is worth far
     * more than nothing; the geofence, which needs metres, still asks for
     * [hasPrecise].
     */
    fun hasPermission(context: Context): Boolean = PERMISSIONS.any { granted(context, it) }

    /**
     * Whether the phone's location services are switched on at all.
     *
     * Separate from permission because the two failures need opposite advice:
     * a permission is fixed inside this app, and this is fixed in the phone's
     * own settings. Telling someone to turn on GPS when the app never asked for
     * the permission sends them to the one place that cannot help.
     */
    fun locationEnabled(context: Context): Boolean {
        val manager = context.getSystemService(Context.LOCATION_SERVICE) as? android.location.LocationManager
            ?: return false
        return runCatching {
            manager.isProviderEnabled(android.location.LocationManager.GPS_PROVIDER) ||
                manager.isProviderEnabled(android.location.LocationManager.NETWORK_PROVIDER)
        }.getOrDefault(false)
    }

    /**
     * A current fix, falling back to the last known one.
     *
     * Returns `Fix(0,0,0)` rather than throwing when there is nothing: a punch
     * made away from the branch is exactly when GPS is worst, and the punch
     * still has to be possible. The caller decides what to do about it — the
     * normal check-in refuses, the selfie punch carries on and says so.
     */
    @SuppressLint("MissingPermission")
    suspend fun current(context: Context, timeoutMs: Long = 8_000): Fix {
        if (!hasPermission(context)) return Fix(0.0, 0.0, 0f)
        val client = LocationServices.getFusedLocationProviderClient(context)

        // Asking for high accuracy while holding only the coarse permission is
        // refused rather than downgraded on several devices, which would turn an
        // approximate fix we are allowed to have into no fix at all.
        val priority =
            if (hasPrecise(context)) Priority.PRIORITY_HIGH_ACCURACY
            else Priority.PRIORITY_BALANCED_POWER_ACCURACY

        return withTimeoutOrNull(timeoutMs) {
            suspendCancellableCoroutine { cont ->
                val cancellation = CancellationTokenSource()
                cont.invokeOnCancellation { cancellation.cancel() }

                fun done(fix: Fix) {
                    if (!cont.isCompleted) cont.resume(fix)
                }

                client.getCurrentLocation(priority, cancellation.token)
                    .addOnSuccessListener { loc ->
                        if (loc != null) {
                            done(Fix(loc.latitude, loc.longitude, loc.accuracy))
                        } else {
                            client.lastLocation
                                .addOnSuccessListener { last ->
                                    done(
                                        if (last != null) Fix(last.latitude, last.longitude, last.accuracy)
                                        else Fix(0.0, 0.0, 0f),
                                    )
                                }
                                .addOnFailureListener { done(Fix(0.0, 0.0, 0f)) }
                        }
                    }
                    .addOnFailureListener { done(Fix(0.0, 0.0, 0f)) }
            }
        } ?: Fix(0.0, 0.0, 0f)
    }

    /**
     * A street address for a fix, or null.
     *
     * Best effort by design: this runs on a phone that may be offline in a
     * basement workshop, which is one of the reasons the punch is being raised
     * by hand in the first place. The coordinates are the evidence; the address
     * is the courtesy that makes them readable.
     */
    @Suppress("DEPRECATION") // the async overload only exists from API 33
    suspend fun addressOf(context: Context, fix: Fix, timeoutMs: Long = 4_000): String? {
        if (!fix.hasFix || !Geocoder.isPresent()) return null
        val geocoder = Geocoder(context)

        val address = withTimeoutOrNull(timeoutMs) {
            suspendCancellableCoroutine<android.location.Address?> { cont ->
                runCatching {
                    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
                        geocoder.getFromLocation(fix.lat, fix.lng, 1) { list ->
                            if (!cont.isCompleted) cont.resume(list.firstOrNull())
                        }
                    } else {
                        val list = geocoder.getFromLocation(fix.lat, fix.lng, 1)
                        if (!cont.isCompleted) cont.resume(list?.firstOrNull())
                    }
                }.onFailure { if (!cont.isCompleted) cont.resume(null) }
            }
        } ?: return null

        // Enough to recognise the place, not the whole postal address: this has
        // to fit across the bottom of a photograph.
        return listOfNotNull(
            address.subLocality ?: address.locality,
            address.locality.takeIf { it != null && it != address.subLocality },
            address.postalCode,
        ).joinToString(", ").ifBlank { address.getAddressLine(0) }
    }
}
