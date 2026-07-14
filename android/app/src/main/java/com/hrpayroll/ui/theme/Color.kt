package com.hrpayroll.ui.theme

import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color

// Brand palette — matches the HR & Payroll UI reference (indigo/violet gradient).
val BrandViolet = Color(0xFF6C5CE7)
val BrandIndigo = Color(0xFF5B4FC4)
val BrandIndigoDark = Color(0xFF463AA8)
val BrandLavender = Color(0xFFEFEEFB)
val BrandSurface = Color(0xFFF7F6FC)

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

// Signature top-to-bottom header gradient used across screens.
val BrandGradient = Brush.verticalGradient(
    colors = listOf(BrandViolet, BrandIndigo, BrandIndigoDark),
)
