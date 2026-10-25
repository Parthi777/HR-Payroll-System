package com.hrpayroll.utils

import java.time.Instant
import java.time.ZoneId
import java.time.format.DateTimeFormatter

private val HH_MM_A: DateTimeFormatter = DateTimeFormatter.ofPattern("hh:mm a").withZone(ZoneId.systemDefault())

/** ISO instant from the API → "08:57 AM" in the phone's timezone; null when absent or unreadable. */
fun formatIsoTime(iso: String?): String? = iso?.let { runCatching { HH_MM_A.format(Instant.parse(it)) }.getOrNull() }
