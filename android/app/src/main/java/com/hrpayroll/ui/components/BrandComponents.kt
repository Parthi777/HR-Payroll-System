package com.hrpayroll.ui.components

import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.ArrowBack
import androidx.compose.material3.Icon
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.draw.shadow
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.hrpayroll.ui.theme.Ink
import com.hrpayroll.ui.theme.SoftWash

/** Floating white circular icon button — the reference design's nav/action affordance. */
@Composable
fun CircleIconButton(
    icon: ImageVector,
    contentDescription: String?,
    modifier: Modifier = Modifier,
    onClick: () -> Unit,
) {
    Box(
        modifier = modifier
            .size(44.dp)
            .shadow(6.dp, CircleShape, spotColor = Color(0x33203070))
            .clip(CircleShape)
            .background(Color.White)
            .clickable { onClick() },
        contentAlignment = Alignment.Center,
    ) {
        Icon(icon, contentDescription = contentDescription, tint = Ink)
    }
}

/** Soft pastel header used on every screen: dark bold title over the pale wash,
 *  floating white circle buttons for back / trailing action (reference design). */
@Composable
fun BrandHeader(
    title: String,
    modifier: Modifier = Modifier,
    onBack: (() -> Unit)? = null,
    trailingIcon: ImageVector? = null,
    trailingDescription: String? = null,
    onTrailing: (() -> Unit)? = null,
) {
    val hasButtons = onBack != null || (trailingIcon != null && onTrailing != null)
    Box(
        modifier = modifier
            .fillMaxWidth()
            .background(SoftWash)
            .padding(horizontal = 20.dp)
            .height(if (hasButtons) 136.dp else 108.dp),
    ) {
        if (onBack != null) {
            CircleIconButton(
                icon = Icons.AutoMirrored.Filled.ArrowBack,
                contentDescription = "Back",
                modifier = Modifier.align(Alignment.TopStart).padding(top = 16.dp),
                onClick = onBack,
            )
        }
        if (trailingIcon != null && onTrailing != null) {
            CircleIconButton(
                icon = trailingIcon,
                contentDescription = trailingDescription,
                modifier = Modifier.align(Alignment.TopEnd).padding(top = 16.dp),
                onClick = onTrailing,
            )
        }
        Text(
            text = title,
            color = Ink,
            fontSize = 26.sp,
            fontWeight = FontWeight.Bold,
            modifier = Modifier.align(Alignment.BottomStart).padding(bottom = 18.dp),
        )
    }
}

/** Pill-shaped status chip (Present / Leave / Off Day / Half Day). */
@Composable
fun StatusChip(
    text: String,
    contentColor: Color,
    containerColor: Color,
    modifier: Modifier = Modifier,
) {
    Row(
        modifier = modifier
            .clip(CircleShape)
            .background(containerColor)
            .padding(horizontal = 12.dp, vertical = 5.dp),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.Center,
    ) {
        Text(
            text = text,
            color = contentColor,
            fontSize = 12.sp,
            fontWeight = FontWeight.SemiBold,
        )
    }
}

/** Reference-style stat pill: filled royal blue (white text) or plain white (dark text).
 *  e.g. Worked [105h] · Salary Tracked [200h]. */
@Composable
fun StatPill(
    text: String,
    filled: Boolean,
    modifier: Modifier = Modifier,
) {
    Box(
        modifier = modifier
            .clip(RoundedCornerShape(50))
            .background(if (filled) com.hrpayroll.ui.theme.BrandIndigo else Color.White)
            .padding(horizontal = 22.dp, vertical = 12.dp),
        contentAlignment = Alignment.Center,
    ) {
        Text(
            text = text,
            color = if (filled) Color.White else Ink,
            fontSize = 14.sp,
            fontWeight = FontWeight.SemiBold,
        )
    }
}
