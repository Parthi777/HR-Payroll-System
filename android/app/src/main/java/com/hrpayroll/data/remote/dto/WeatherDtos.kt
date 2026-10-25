package com.hrpayroll.data.remote.dto

import com.squareup.moshi.Json
import com.squareup.moshi.JsonClass

/** Open-Meteo's /v1/forecast answer — only the fields the Home weather card reads. */
@JsonClass(generateAdapter = true)
data class WeatherResponse(
    val current: CurrentWeatherDto? = null,
    val daily: DailyWeatherDto? = null,
)

@JsonClass(generateAdapter = true)
data class CurrentWeatherDto(
    @Json(name = "temperature_2m") val temperature: Double? = null,
    /** WMO weather code. */
    @Json(name = "weather_code") val code: Int? = null,
    @Json(name = "is_day") val isDay: Int? = null,
)

@JsonClass(generateAdapter = true)
data class DailyWeatherDto(
    @Json(name = "temperature_2m_max") val max: List<Double?> = emptyList(),
    @Json(name = "temperature_2m_min") val min: List<Double?> = emptyList(),
    @Json(name = "precipitation_probability_max") val rainChance: List<Int?> = emptyList(),
)
