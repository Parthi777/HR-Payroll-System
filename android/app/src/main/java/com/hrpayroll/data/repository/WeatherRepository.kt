package com.hrpayroll.data.repository

import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.outlined.AcUnit
import androidx.compose.material.icons.outlined.Bedtime
import androidx.compose.material.icons.outlined.Cloud
import androidx.compose.material.icons.outlined.Dehaze
import androidx.compose.material.icons.outlined.Grain
import androidx.compose.material.icons.outlined.Thunderstorm
import androidx.compose.material.icons.outlined.Umbrella
import androidx.compose.material.icons.outlined.WbCloudy
import androidx.compose.material.icons.outlined.WbSunny
import androidx.compose.ui.graphics.vector.ImageVector
import com.hrpayroll.data.remote.WeatherApi
import javax.inject.Inject
import javax.inject.Singleton
import kotlin.math.roundToInt

/** Today's weather, ready for the Home card. */
data class Weather(
    val tempC: Int,
    val label: String,
    val icon: ImageVector,
    val highC: Int?,
    val lowC: Int?,
    val rainPct: Int?,
)

/**
 * Today's weather where the employee is, from Open-Meteo. Kept for half an hour
 * per place, so going back and forth to Home does not refetch it.
 */
@Singleton
class WeatherRepository @Inject constructor(private val api: WeatherApi) {

    private var cached: Triple<String, Long, Weather>? = null

    suspend fun today(lat: Double, lng: Double): Weather? {
        // ~1 km grid: the forecast does not change across a town.
        val key = "%.2f,%.2f".format(lat, lng)
        val now = System.currentTimeMillis()
        cached?.let { (k, at, w) -> if (k == key && now - at < CACHE_MS) return w }

        val res = api.forecast(lat, lng)
        val current = res.current ?: return null
        val temp = current.temperature ?: return null
        val (label, icon) = describe(current.code ?: -1, current.isDay != 0)
        val weather = Weather(
            tempC = temp.roundToInt(),
            label = label,
            icon = icon,
            highC = res.daily?.max?.firstOrNull()?.roundToInt(),
            lowC = res.daily?.min?.firstOrNull()?.roundToInt(),
            rainPct = res.daily?.rainChance?.firstOrNull(),
        )
        cached = Triple(key, now, weather)
        return weather
    }

    /** WMO weather code → a word and an icon. */
    private fun describe(code: Int, day: Boolean): Pair<String, ImageVector> = when (code) {
        0 -> "Clear" to if (day) Icons.Outlined.WbSunny else Icons.Outlined.Bedtime
        1, 2 -> "Partly cloudy" to Icons.Outlined.WbCloudy
        3 -> "Overcast" to Icons.Outlined.Cloud
        45, 48 -> "Fog" to Icons.Outlined.Dehaze
        in 51..57 -> "Drizzle" to Icons.Outlined.Grain
        in 61..67, in 80..82 -> "Rain" to Icons.Outlined.Umbrella
        in 71..77, 85, 86 -> "Snow" to Icons.Outlined.AcUnit
        in 95..99 -> "Thunderstorm" to Icons.Outlined.Thunderstorm
        else -> "Cloudy" to Icons.Outlined.Cloud
    }

    private companion object {
        const val CACHE_MS = 30 * 60 * 1000L
    }
}
