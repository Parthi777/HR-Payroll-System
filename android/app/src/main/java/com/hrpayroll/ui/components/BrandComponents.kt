package com.hrpayroll.ui.components

import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ColumnScope
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.ArrowBack
import androidx.compose.material3.Card
import androidx.compose.material3.CardDefaults
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
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
import com.hrpayroll.ui.theme.BrandGradient
import com.hrpayroll.ui.theme.BrandIndigo
import com.hrpayroll.ui.theme.Ink
import androidx.compose.animation.core.animateDpAsState
import androidx.compose.animation.core.animateFloatAsState
import androidx.compose.animation.core.tween
import androidx.compose.foundation.layout.offset
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.graphics.graphicsLayer
import com.hrpayroll.utils.Motion

/**
 * The shared look of the phone app.
 *
 * One header, one card, one stat tile, one chip — used by every screen,
 * employee and admin alike. Before this, the home screen wore the brand
 * gradient and the other twelve screens wore a pale wash, so the app looked
 * like two products stitched together and the admin side looked like the
 * afterthought. Anything visual that more than one screen needs belongs here
 * rather than in a screen, which is what keeps that from happening again.
 *
 * Colours come from ui/theme/Color.kt. Screens must not mix their own: see
 * docs/design-system.md.
 */

/**
 * Circular icon button that floats on the header.
 *
 * Translucent white on the gradient, solid white with a soft shadow when it
 * sits on a pale surface.
 */
@Composable
fun CircleIconButton(
    icon: ImageVector,
    contentDescription: String?,
    modifier: Modifier = Modifier,
    onGradient: Boolean = true,
    onClick: () -> Unit,
) {
    Box(
        modifier = modifier
            .size(44.dp)
            .then(if (onGradient) Modifier else Modifier.shadow(6.dp, CircleShape, spotColor = Color(0x33203070)))
            .clip(CircleShape)
            .background(if (onGradient) Color.White.copy(alpha = 0.18f) else Color.White)
            .clickable { onClick() },
        contentAlignment = Alignment.Center,
    ) {
        Icon(icon, contentDescription = contentDescription, tint = if (onGradient) Color.White else Ink)
    }
}

/**
 * The header every screen starts with: brand gradient, rounded bottom corners,
 * white title, and optional floating buttons either side.
 *
 * `content` is for a screen that needs more in the header than a title — the
 * home screen's avatar and name, for instance. It is laid out centred under
 * the title, and the whole block grows to fit rather than the screen inventing
 * its own header.
 */
@Composable
fun BrandHeader(
    title: String? = null,
    modifier: Modifier = Modifier,
    subtitle: String? = null,
    onBack: (() -> Unit)? = null,
    leadingIcon: ImageVector? = null,
    leadingDescription: String? = null,
    onLeading: (() -> Unit)? = null,
    trailingIcon: ImageVector? = null,
    trailingDescription: String? = null,
    onTrailing: (() -> Unit)? = null,
    content: @Composable (ColumnScope.() -> Unit)? = null,
) {
    Box(
        modifier = modifier
            .fillMaxWidth()
            .clip(RoundedCornerShape(bottomStart = 28.dp, bottomEnd = 28.dp))
            .background(BrandGradient)
            .padding(horizontal = 20.dp),
    ) {
        // Top-left is the way back, or whatever else a screen puts there (the
        // home screen's alerts bell).
        if (onBack != null || (leadingIcon != null && onLeading != null)) {
            CircleIconButton(
                icon = leadingIcon ?: Icons.AutoMirrored.Filled.ArrowBack,
                contentDescription = leadingDescription ?: "Back",
                modifier = Modifier.align(Alignment.TopStart).padding(top = 16.dp),
                onClick = onLeading ?: onBack ?: {},
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

        Column(
            modifier = Modifier.fillMaxWidth().padding(top = 72.dp, bottom = 22.dp),
            horizontalAlignment = if (content != null) Alignment.CenterHorizontally else Alignment.Start,
        ) {
            if (title != null) {
                Text(
                    text = title,
                    color = Color.White,
                    fontSize = 26.sp,
                    fontWeight = FontWeight.Bold,
                )
            }
            if (subtitle != null) {
                Spacer(Modifier.height(4.dp))
                Text(subtitle, color = Color.White.copy(alpha = 0.8f), fontSize = 13.sp)
            }
            if (content != null) {
                if (title != null || subtitle != null) Spacer(Modifier.height(16.dp))
                content()
            }
        }
    }
}

/**
 * The white card everything sits in.
 *
 * `floating` is the one that overlaps the header — the reference design's first
 * card on a screen. Everything else is a flat list card.
 */
@Composable
fun SectionCard(
    modifier: Modifier = Modifier,
    floating: Boolean = false,
    content: @Composable ColumnScope.() -> Unit,
) {
    Card(
        modifier = modifier.fillMaxWidth(),
        shape = RoundedCornerShape(20.dp),
        colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.surface),
        elevation = CardDefaults.cardElevation(defaultElevation = if (floating) 6.dp else 2.dp),
    ) {
        Column(modifier = Modifier.padding(16.dp), content = content)
    }
}

/**
 * One figure with a label — the unit both dashboards are built from.
 *
 * The number carries the colour; the label stays quiet. Pass a status colour
 * from the theme, never a hex value.
 */
@Composable
fun StatTile(
    label: String,
    value: String,
    accent: Color = BrandIndigo,
    modifier: Modifier = Modifier,
    caption: String? = null,
) {
    SectionCard(modifier = modifier) {
        Text(
            text = value,
            color = accent,
            fontSize = 26.sp,
            fontWeight = FontWeight.Bold,
        )
        Spacer(Modifier.height(2.dp))
        Text(
            text = label,
            color = MaterialTheme.colorScheme.onSurface.copy(alpha = 0.7f),
            fontSize = 13.sp,
            fontWeight = FontWeight.Medium,
        )
        if (caption != null) {
            Spacer(Modifier.height(2.dp))
            Text(caption, color = MaterialTheme.colorScheme.onSurface.copy(alpha = 0.45f), fontSize = 11.sp)
        }
    }
}

/**
 * A figure and its label, side by side inside a card — the row of numbers on
 * the home screen and the attendance screen. Smaller sibling of [StatTile],
 * which brings its own card.
 */
@Composable
fun TodayStat(
    label: String,
    value: String,
    accent: Color,
    modifier: Modifier = Modifier,
) {
    Column(modifier = modifier, horizontalAlignment = Alignment.CenterHorizontally) {
        Text(value, fontSize = 18.sp, fontWeight = FontWeight.Bold, color = accent)
        Spacer(Modifier.height(2.dp))
        Text(
            label,
            fontSize = 11.sp,
            color = MaterialTheme.colorScheme.onSurface.copy(alpha = 0.6f),
        )
    }
}

/**
 * A card that arrives rather than appears.
 *
 * `index` staggers a column of them, so a screen assembles top-down instead of
 * flashing into place all at once. Off entirely when the phone asks for less
 * motion — and note the content is always composed and always ends in its final
 * state, so a screen is never blank waiting for an animation that did not run.
 */
@Composable
fun AnimatedEntrance(
    index: Int = 0,
    modifier: Modifier = Modifier,
    content: @Composable () -> Unit,
) {
    val animate = Motion.rememberEnabled()
    var shown by remember { mutableStateOf(!animate) }
    LaunchedEffect(Unit) { shown = true }

    val alpha by animateFloatAsState(
        targetValue = if (shown) 1f else 0f,
        animationSpec = tween(durationMillis = 320, delayMillis = if (animate) index * 40 else 0),
        label = "entranceAlpha",
    )
    val offset by animateDpAsState(
        targetValue = if (shown) 0.dp else 12.dp,
        animationSpec = tween(durationMillis = 320, delayMillis = if (animate) index * 40 else 0),
        label = "entranceOffset",
    )

    Box(modifier = modifier.offset(y = offset).graphicsLayer { this.alpha = alpha }) { content() }
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
            .background(if (filled) BrandIndigo else Color.White)
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
