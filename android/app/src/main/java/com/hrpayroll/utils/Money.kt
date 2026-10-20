package com.hrpayroll.utils

import java.text.NumberFormat
import java.util.Locale

/**
 * A rupee amount as people read it: Indian digit grouping, no ".0" on whole
 * rupees — "₹1,850", "₹1,25,000", "₹640.50". The one formatter for every screen,
 * so the same voucher never reads "₹1850.0" in one place and "₹1,850" in another.
 */
fun rupees(amount: Double?): String {
    val v = amount ?: 0.0
    val f = NumberFormat.getNumberInstance(Locale("en", "IN")).apply {
        minimumFractionDigits = if (v % 1.0 == 0.0) 0 else 2
        maximumFractionDigits = 2
    }
    return "₹" + f.format(v)
}

/** A count of days: 3.0 → "3", 2.5 → "2.5" (a half day counts half). */
fun days(d: Double): String = if (d % 1.0 == 0.0) d.toLong().toString() else "%.1f".format(d)
