package com.hrpayroll.ui.theme

import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Shapes
import androidx.compose.material3.darkColorScheme
import androidx.compose.material3.lightColorScheme
import androidx.compose.runtime.Composable
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.unit.dp

private val LightColors = lightColorScheme(
    primary = BrandGreen,
    onPrimary = Color.White,
    secondary = BrandGreenLight,
    onSecondary = Color.White,
    primaryContainer = BrandMint,
    onPrimaryContainer = BrandGreenDark,
    background = BrandSurface,
    onBackground = Ink,
    surface = Color.White,
    onSurface = Ink,
    surfaceVariant = BrandMint,
    // Selected filter chips, tonal buttons and badges: brand mint and green,
    // not Material's default lavender.
    secondaryContainer = BrandMint,
    onSecondaryContainer = BrandGreenDark,
    tertiary = BrandGold,
    onTertiary = Ink,
    tertiaryContainer = Color(0xFFFDF1D6),
    onTertiaryContainer = Color(0xFF6B4A00),
    // Field and divider outlines: a soft green-grey rather than Material's dark grey.
    outline = Color(0xFFCFDBD5),
    outlineVariant = CardBorder,
    error = StatusOff,
)

private val DarkColors = darkColorScheme(
    primary = Color(0xFF2DBE8E),
    onPrimary = CharcoalDeep,
    secondary = BrandGreenLight,
    background = CharcoalDeep,
    surface = Color(0xFF1C2328),
    error = StatusOff,
)

private val BrandShapes = Shapes(
    // Text fields and menus use extraSmall: rounded enough to feel modern.
    extraSmall = RoundedCornerShape(14.dp),
    small = RoundedCornerShape(14.dp),
    medium = RoundedCornerShape(20.dp),
    large = RoundedCornerShape(28.dp),
)

@Composable
fun HrPayrollTheme(
    // Always light by owner preference — the brand look is the light reference
    // design; system dark mode is intentionally ignored.
    darkTheme: Boolean = false,
    content: @Composable () -> Unit,
) {
    MaterialTheme(
        colorScheme = if (darkTheme) DarkColors else LightColors,
        shapes = BrandShapes,
        typography = BrandTypography,
        content = content,
    )
}
