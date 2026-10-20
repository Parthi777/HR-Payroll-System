package com.hrpayroll.ui.components

import androidx.compose.foundation.layout.heightIn
import androidx.compose.material.icons.filled.KeyboardArrowDown
import androidx.compose.material.icons.outlined.CalendarMonth
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
import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.Canvas
import androidx.compose.foundation.border
import androidx.compose.foundation.layout.width
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.unit.Dp
import com.hrpayroll.ui.theme.BrandGold
import com.hrpayroll.ui.theme.BrandGreen
import com.hrpayroll.ui.theme.BrandGreenBright
import com.hrpayroll.ui.theme.BrandSurface
import com.hrpayroll.ui.theme.CardBorder
import com.hrpayroll.ui.theme.Ink
import com.hrpayroll.ui.theme.MutedText
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
 * The brand's light wash: mint fading to the page colour, with a soft green
 * glow on the left and a yellow one on the right. Sits behind headers (and the
 * sign-in screen), so every screen opens with the same light, branded top.
 */
@Composable
fun BrandWash(modifier: Modifier = Modifier) {
    Canvas(modifier = modifier) {
        drawRect(Brush.verticalGradient(listOf(Color(0xFFE2F4EC), Color(0xFFEFF8F4), BrandSurface)))
        val green = Offset(size.width * 0.05f, size.height * 0.05f)
        drawCircle(
            brush = Brush.radialGradient(listOf(BrandGreenBright.copy(alpha = 0.16f), Color.Transparent), center = green, radius = size.width * 0.7f),
            radius = size.width * 0.7f,
            center = green,
        )
        val gold = Offset(size.width * 0.98f, size.height * 0.15f)
        drawCircle(
            brush = Brush.radialGradient(listOf(BrandGold.copy(alpha = 0.18f), Color.Transparent), center = gold, radius = size.width * 0.5f),
            radius = size.width * 0.5f,
            center = gold,
        )
    }
}

/**
 * Round icon button for headers.
 *
 * White with a hairline on the light header (the default). `onGradient` is for
 * the few that sit on a strong green surface, where it turns translucent white.
 */
@Composable
fun CircleIconButton(
    icon: ImageVector,
    contentDescription: String?,
    modifier: Modifier = Modifier,
    onGradient: Boolean = false,
    badge: Boolean = false,
    onClick: () -> Unit,
) {
    Box(modifier = modifier.size(44.dp)) {
        Box(
            modifier = Modifier
                .size(44.dp)
                .clip(CircleShape)
                .background(if (onGradient) Color.White.copy(alpha = 0.18f) else Color.White)
                .then(if (onGradient) Modifier else Modifier.border(1.dp, CardBorder, CircleShape))
                .clickable { onClick() },
            contentAlignment = Alignment.Center,
        ) {
            Icon(
                icon,
                contentDescription = contentDescription,
                tint = if (onGradient) Color.White else Ink,
                modifier = Modifier.size(22.dp),
            )
        }
        if (badge) {
            Box(
                modifier = Modifier
                    .align(Alignment.TopEnd)
                    .padding(top = 9.dp, end = 10.dp)
                    .size(9.dp)
                    .clip(CircleShape)
                    .background(BrandGold)
                    .border(1.5.dp, Color.White, CircleShape),
            )
        }
    }
}

/**
 * The header every screen starts with: the light brand wash, a bold charcoal
 * title with an optional line under it, and round buttons either side.
 *
 * `content` is for a screen that needs more in the header than a title; it is
 * laid out under the title, inside the same wash.
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
    Box(modifier = modifier.fillMaxWidth()) {
        BrandWash(Modifier.matchParentSize())
        Column(modifier = Modifier.fillMaxWidth().padding(start = 20.dp, end = 20.dp, top = 14.dp, bottom = 18.dp)) {
            Row(verticalAlignment = Alignment.CenterVertically) {
                if (onBack != null || (leadingIcon != null && onLeading != null)) {
                    CircleIconButton(
                        icon = leadingIcon ?: Icons.AutoMirrored.Filled.ArrowBack,
                        contentDescription = leadingDescription ?: "Back",
                        onClick = onLeading ?: onBack ?: {},
                    )
                    Spacer(Modifier.width(14.dp))
                }
                Column(modifier = Modifier.weight(1f)) {
                    if (title != null) {
                        Text(
                            text = title,
                            color = Ink,
                            fontSize = 26.sp,
                            fontWeight = FontWeight.Bold,
                            letterSpacing = (-0.3).sp,
                        )
                    }
                    if (subtitle != null) {
                        Spacer(Modifier.height(2.dp))
                        Text(subtitle, color = MutedText, fontSize = 13.sp)
                    }
                }
                if (trailingIcon != null && onTrailing != null) {
                    Spacer(Modifier.width(12.dp))
                    CircleIconButton(icon = trailingIcon, contentDescription = trailingDescription, onClick = onTrailing)
                }
            }
            if (content != null) {
                Spacer(Modifier.height(16.dp))
                content()
            }
        }
    }
}

/**
 * The white card everything sits in: generous corners, a hairline border and
 * a soft shadow, so it lifts off the page without looking heavy.
 *
 * `floating` gives it a little more lift — the first, most important card.
 */
@Composable
fun SectionCard(
    modifier: Modifier = Modifier,
    floating: Boolean = false,
    content: @Composable ColumnScope.() -> Unit,
) {
    Card(
        modifier = modifier
            .fillMaxWidth()
            .shadow(
                elevation = if (floating) 10.dp else 4.dp,
                shape = RoundedCornerShape(24.dp),
                ambientColor = Color(0x14005A40),
                spotColor = Color(0x1F005A40),
            ),
        shape = RoundedCornerShape(24.dp),
        colors = CardDefaults.cardColors(containerColor = Color.White),
        border = BorderStroke(1.dp, CardBorder),
        elevation = CardDefaults.cardElevation(defaultElevation = 0.dp),
    ) {
        Column(modifier = Modifier.padding(18.dp), content = content)
    }
}

/** A tinted rounded square holding an icon — the accent beside stats, list rows and actions. */
@Composable
fun IconBubble(
    icon: ImageVector,
    tint: Color,
    modifier: Modifier = Modifier,
    size: Dp = 40.dp,
) {
    Box(
        modifier = modifier
            .size(size)
            .clip(RoundedCornerShape(size * 0.32f))
            .background(tint.copy(alpha = 0.12f)),
        contentAlignment = Alignment.Center,
    ) {
        Icon(icon, contentDescription = null, tint = tint, modifier = Modifier.size(size * 0.52f))
    }
}

/** A section heading on the page, with an optional action on the right ("See all"). */
@Composable
fun SectionTitle(
    text: String,
    modifier: Modifier = Modifier,
    action: String? = null,
    onAction: (() -> Unit)? = null,
) {
    Row(modifier = modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically) {
        Text(text, color = Ink, fontSize = 17.sp, fontWeight = FontWeight.Bold, modifier = Modifier.weight(1f))
        if (action != null && onAction != null) {
            Text(
                action,
                color = BrandGreen,
                fontSize = 13.sp,
                fontWeight = FontWeight.SemiBold,
                modifier = Modifier.clip(RoundedCornerShape(8.dp)).clickable(onClick = onAction).padding(6.dp),
            )
        }
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
    accent: Color = BrandGreen,
    modifier: Modifier = Modifier,
    caption: String? = null,
    icon: ImageVector? = null,
) {
    SectionCard(modifier = modifier) {
        if (icon != null) {
            IconBubble(icon, accent, size = 36.dp)
            Spacer(Modifier.height(12.dp))
        }
        Text(
            text = value,
            color = if (icon != null) Ink else accent,
            fontSize = 26.sp,
            fontWeight = FontWeight.Bold,
            letterSpacing = (-0.5).sp,
        )
        Spacer(Modifier.height(2.dp))
        Text(
            text = label,
            color = MutedText,
            fontSize = 13.sp,
            fontWeight = FontWeight.Medium,
        )
        if (caption != null) {
            Spacer(Modifier.height(2.dp))
            Text(caption, color = MutedText.copy(alpha = 0.8f), fontSize = 11.sp)
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

/** Stat pill: filled brand green (white text) or plain white (dark text).
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
            .background(if (filled) BrandGreen else Color.White)
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

/**
 * The screen's main action: a green pill, shaded from the deeper brand green so
 * the white label stays readable. The same button the sign-in screen uses.
 */
@Composable
fun GradientButton(
    text: String,
    modifier: Modifier = Modifier,
    loading: Boolean = false,
    enabled: Boolean = true,
    icon: ImageVector? = null,
    onClick: () -> Unit,
) {
    val active = enabled && !loading
    Box(
        modifier = modifier
            .fillMaxWidth()
            .height(54.dp)
            .shadow(if (active) 8.dp else 0.dp, RoundedCornerShape(18.dp), ambientColor = BrandGreen, spotColor = BrandGreen)
            .clip(RoundedCornerShape(18.dp))
            .background(
                if (enabled) Brush.horizontalGradient(listOf(BrandGreen, com.hrpayroll.ui.theme.BrandGreenDark))
                else Brush.horizontalGradient(listOf(CardBorder, CardBorder)),
            )
            .clickable(enabled = active, onClick = onClick),
        contentAlignment = Alignment.Center,
    ) {
        if (loading) {
            androidx.compose.material3.CircularProgressIndicator(modifier = Modifier.size(22.dp), color = Color.White, strokeWidth = 2.dp)
        } else {
            Row(verticalAlignment = Alignment.CenterVertically) {
                if (icon != null) {
                    Icon(icon, contentDescription = null, tint = if (enabled) Color.White else MutedText, modifier = Modifier.size(20.dp))
                    Spacer(Modifier.width(8.dp))
                }
                Text(text, color = if (enabled) Color.White else MutedText, fontSize = 15.sp, fontWeight = FontWeight.Bold)
            }
        }
    }
}

/** One choice in a row of options (leave type, status filter): mint and green when picked. */
@Composable
fun ChoiceChip(
    text: String,
    selected: Boolean,
    modifier: Modifier = Modifier,
    onClick: () -> Unit,
) {
    Box(
        modifier = modifier
            .clip(RoundedCornerShape(14.dp))
            .background(if (selected) com.hrpayroll.ui.theme.BrandMint else Color.White)
            .border(if (selected) 1.5.dp else 1.dp, if (selected) BrandGreen else CardBorder, RoundedCornerShape(14.dp))
            .clickable(onClick = onClick)
            .padding(horizontal = 14.dp, vertical = 10.dp),
        contentAlignment = Alignment.Center,
    ) {
        Text(
            text,
            color = if (selected) BrandGreen else Ink,
            fontSize = 13.sp,
            fontWeight = if (selected) FontWeight.Bold else FontWeight.Medium,
            maxLines = 1,
        )
    }
}

/** "October 2026" for a month and year. */
fun monthLabel(month: Int, year: Int): String =
    java.time.YearMonth.of(year, month).format(java.time.format.DateTimeFormatter.ofPattern("MMMM yyyy"))

/**
 * A month picker: a white pill showing the chosen month, opening a list of the
 * months offered (newest first). Used wherever a screen covers one month.
 */
@Composable
fun MonthDropdown(
    month: Int,
    year: Int,
    options: List<Pair<Int, Int>>,
    onSelect: (month: Int, year: Int) -> Unit,
    modifier: Modifier = Modifier,
) {
    var open by remember { mutableStateOf(false) }
    Box(modifier = modifier) {
        Row(
            modifier = Modifier
                .clip(RoundedCornerShape(16.dp))
                .background(Color.White)
                .border(1.dp, CardBorder, RoundedCornerShape(16.dp))
                .clickable { open = true }
                .padding(horizontal = 14.dp, vertical = 11.dp),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            Icon(androidx.compose.material.icons.Icons.Outlined.CalendarMonth, contentDescription = null, tint = BrandGreen, modifier = Modifier.size(18.dp))
            Spacer(Modifier.width(8.dp))
            Text(monthLabel(month, year), color = Ink, fontSize = 14.sp, fontWeight = FontWeight.SemiBold)
            Spacer(Modifier.width(6.dp))
            Icon(androidx.compose.material.icons.Icons.Filled.KeyboardArrowDown, contentDescription = "Choose month", tint = MutedText, modifier = Modifier.size(20.dp))
        }
        androidx.compose.material3.DropdownMenu(
            expanded = open,
            onDismissRequest = { open = false },
            modifier = Modifier.background(Color.White).heightIn(max = 360.dp),
        ) {
            options.forEach { (m, y) ->
                val selected = m == month && y == year
                androidx.compose.material3.DropdownMenuItem(
                    text = {
                        Text(
                            monthLabel(m, y),
                            color = if (selected) BrandGreen else Ink,
                            fontWeight = if (selected) FontWeight.Bold else FontWeight.Normal,
                        )
                    },
                    onClick = { open = false; onSelect(m, y) },
                )
            }
        }
    }
}
