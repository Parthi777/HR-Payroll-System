package com.hrpayroll.ui.theme

import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color

// Brand palette — airy HR UI reference: royal blue accents on a soft pastel wash.
val BrandViolet = Color(0xFF4A69FF) // gradient top (lighter royal blue)
val BrandIndigo = Color(0xFF2F55F4) // primary royal blue
val BrandIndigoDark = Color(0xFF1F3BD6)
val BrandLavender = Color(0xFFE7ECFF) // selected chip / nav indicator tint
val BrandSurface = Color(0xFFF4F5F1) // soft warm-grey screen background
val Ink = Color(0xFF1C1B2E) // primary dark text on pale surfaces

// Status colors (attendance + claim chips) — see docs/design-system.md
val StatusPresent = Color(0xFF16A34A)
val StatusPresentBg = Color(0xFFDCFCE7)
val StatusLeave = Color(0xFF4F46E5)
val StatusLeaveBg = Color(0xFFE0E7FF)
val StatusOff = Color(0xFFE11D48)
val StatusOffBg = Color(0xFFFFE4E6)
val StatusHalf = Color(0xFFB45309)
val StatusHalfBg = Color(0xFFFEF3C7)
val StatusPaid = Color(0xFF0284C7) // claim disbursed (cashier)
val StatusPaidBg = Color(0xFFE0F2FE)

val MoneyGreen = Color(0xFF16A34A)
val DeductRed = Color(0xFFE11D48)

// Saturated blue gradient — hero cards, login backdrop, anything with white text on it.
val BrandGradient = Brush.verticalGradient(
    colors = listOf(BrandViolet, BrandIndigo, BrandIndigoDark),
)

// Soft pastel wash (pale lemon → mint → cool grey) behind headers, per the reference.
val SoftWash = Brush.linearGradient(
    colors = listOf(Color(0xFFF6F6E7), Color(0xFFEAF1E4), Color(0xFFF2F4F6)),
)
