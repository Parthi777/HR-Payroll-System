package com.hrpayroll.ui.theme

import androidx.compose.foundation.isSystemInDarkTheme
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Shapes
import androidx.compose.material3.darkColorScheme
import androidx.compose.material3.lightColorScheme
import androidx.compose.runtime.Composable
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.unit.dp

private val LightColors = lightColorScheme(
    primary = BrandIndigo,
    onPrimary = Color.White,
    secondary = BrandViolet,
    onSecondary = Color.White,
    primaryContainer = BrandLavender,
    onPrimaryContainer = BrandIndigoDark,
    background = BrandSurface,
    onBackground = Color(0xFF1C1B2E),
    surface = Color.White,
    onSurface = Color(0xFF1C1B2E),
    surfaceVariant = BrandLavender,
    error = StatusOff,
)

private val DarkColors = darkColorScheme(
    primary = Color(0xFF9D90F0),
    onPrimary = Color(0xFF1C1633),
    secondary = BrandViolet,
    background = Color(0xFF13111F),
    surface = Color(0xFF1C1A2B),
    error = StatusOff,
)

private val BrandShapes = Shapes(
    small = RoundedCornerShape(12.dp),
    medium = RoundedCornerShape(20.dp),
    large = RoundedCornerShape(28.dp),
)

@Composable
fun HrPayrollTheme(
    darkTheme: Boolean = isSystemInDarkTheme(),
    content: @Composable () -> Unit,
) {
    MaterialTheme(
        colorScheme = if (darkTheme) DarkColors else LightColors,
        shapes = BrandShapes,
        content = content,
    )
}
