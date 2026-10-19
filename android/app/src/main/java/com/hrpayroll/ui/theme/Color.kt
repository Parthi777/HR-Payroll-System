package com.hrpayroll.ui.theme

import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color

// Kayaazh Payroll palette (brand kit): green #00A174, yellow #F0B323, charcoal #171C20.
// BrandGreen is a shade deeper than the brand green on purpose — it is what
// carries white text and icons, and white on #00A174 is too faint to read
// (3.3:1). The exact brand green is BrandGreenBright, for accents and the logo.
val BrandGreenBright = Color(0xFF00A174) // the brand green itself
val BrandGreenLight = Color(0xFF2FB58A) // gradient top
val BrandGreen = Color(0xFF00835E) // primary: buttons, selected tabs, white text on it
val BrandGreenDark = Color(0xFF006A4C)
val BrandMint = Color(0xFFE8F7F2) // selected chip / nav indicator tint
val BrandGold = Color(0xFFF0B323) // brand yellow — accents only, never behind white text
val Charcoal = Color(0xFF171C20) // brand charcoal: ink, and the reversed-logo backdrop
val CharcoalDeep = Color(0xFF11161D)
val BrandSurface = Color(0xFFF4F5F1) // soft warm-grey screen background
val Ink = Charcoal // primary dark text on pale surfaces

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
// Nothing to report: a day still in the future, an off day, a cell with no
// data. Screens had grown three slightly different greys for this; it is one.
val StatusMuted = Color(0xFF64748B)
val StatusMutedBg = Color(0xFFF1F5F9)
val StatusPaidBg = Color(0xFFE0F2FE)

val MoneyGreen = Color(0xFF16A34A)
val DeductRed = Color(0xFFE11D48)

// Green gradient — hero cards and headers, anything with white text on it.
// Never behind the coloured logo (brand rule): that goes on white or charcoal.
val BrandGradient = Brush.verticalGradient(
    colors = listOf(BrandGreenLight, BrandGreen, BrandGreenDark),
)

// Charcoal backdrop for the sign-in screen, where the reversed lockup sits.
val CharcoalGradient = Brush.verticalGradient(
    colors = listOf(Color(0xFF1C2328), Charcoal, CharcoalDeep),
)

// Soft pastel wash (pale lemon → mint → cool grey) behind headers, per the reference.
val SoftWash = Brush.linearGradient(
    colors = listOf(Color(0xFFF6F6E7), Color(0xFFEAF1E4), Color(0xFFF2F4F6)),
)
