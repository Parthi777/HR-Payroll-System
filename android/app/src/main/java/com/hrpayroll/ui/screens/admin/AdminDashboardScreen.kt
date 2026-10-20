package com.hrpayroll.ui.screens.admin

import androidx.compose.foundation.Canvas
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.automirrored.outlined.ReceiptLong
import androidx.compose.material.icons.outlined.BeachAccess
import androidx.compose.material.icons.outlined.CalendarMonth
import androidx.compose.material.icons.outlined.CheckCircle
import androidx.compose.material.icons.outlined.HourglassTop
import androidx.compose.material.icons.outlined.Notifications
import androidx.compose.material.icons.outlined.PersonOff
import androidx.compose.material.icons.outlined.Schedule
import androidx.compose.ui.draw.clip
import androidx.compose.ui.draw.shadow
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.vector.ImageVector
import com.hrpayroll.ui.components.AnimatedEntrance
import com.hrpayroll.ui.components.CircleIconButton
import com.hrpayroll.ui.components.IconBubble
import com.hrpayroll.ui.components.SectionCard
import com.hrpayroll.ui.theme.BrandGold
import com.hrpayroll.ui.theme.BrandGreenDark
import com.hrpayroll.ui.theme.CardBorder
import com.hrpayroll.ui.theme.Ink
import com.hrpayroll.ui.theme.MutedText
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material3.IconButton
import androidx.compose.foundation.layout.size
import androidx.compose.material.icons.filled.ChevronRight
import androidx.compose.material.icons.filled.ChevronLeft
import androidx.compose.material.icons.automirrored.filled.Logout
import androidx.compose.material3.Card
import androidx.compose.material3.Icon
import androidx.compose.material3.CardDefaults
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.hilt.navigation.compose.hiltViewModel
import com.hrpayroll.data.remote.dto.DashboardStatsDto
import com.hrpayroll.ui.components.BrandHeader
import com.hrpayroll.ui.theme.BrandGreen
import com.hrpayroll.ui.theme.StatusHalf
import com.hrpayroll.ui.theme.StatusLeave
import com.hrpayroll.ui.theme.StatusOff
import com.hrpayroll.ui.theme.StatusPresent

/** Admin home: live overview cards (GET /admin/dashboard/stats). */
@OptIn(androidx.compose.material3.ExperimentalMaterial3Api::class)
@Composable
fun AdminDashboardScreen(
    onLogout: () -> Unit,
    viewModel: AdminDashboardViewModel = hiltViewModel(),
) {
    val state by viewModel.uiState.collectAsState()
    val s: DashboardStatsDto = state.stats ?: DashboardStatsDto()
    var confirmLogout by remember { mutableStateOf(false) }
    var showOverviewPicker by remember { mutableStateOf(false) }

    if (confirmLogout) {
        androidx.compose.material3.AlertDialog(
            onDismissRequest = { confirmLogout = false },
            title = { Text("Log out?") },
            text = { Text("You will need your admin email and password to sign in again.") },
            confirmButton = {
                TextButton(onClick = {
                    confirmLogout = false
                    viewModel.logout()
                    onLogout()
                }) { Text("Log out") }
            },
            dismissButton = { TextButton(onClick = { confirmLogout = false }) { Text("Cancel") } },
        )
    }

    if (showOverviewPicker) {
        val pickerState = androidx.compose.material3.rememberDatePickerState(
            initialSelectedDateMillis = state.overviewDate.atStartOfDay(java.time.ZoneOffset.UTC).toInstant().toEpochMilli(),
        )
        androidx.compose.material3.DatePickerDialog(
            onDismissRequest = { showOverviewPicker = false },
            confirmButton = {
                TextButton(onClick = {
                    pickerState.selectedDateMillis?.let { ms ->
                        viewModel.pickOverviewDate(
                            java.time.Instant.ofEpochMilli(ms).atZone(java.time.ZoneOffset.UTC).toLocalDate(),
                        )
                    }
                    showOverviewPicker = false
                }) { Text("OK") }
            },
            dismissButton = { TextButton(onClick = { showOverviewPicker = false }) { Text("Cancel") } },
        ) { androidx.compose.material3.DatePicker(state = pickerState) }
    }

    Box(modifier = Modifier.fillMaxSize().background(MaterialTheme.colorScheme.background)) {
        Column(modifier = Modifier.fillMaxSize().verticalScroll(rememberScrollState())) {
            BrandHeader(
                title = "Dashboard",
                subtitle = java.time.LocalDate.now().format(java.time.format.DateTimeFormatter.ofPattern("EEEE, d MMMM")),
                trailingIcon = Icons.AutoMirrored.Filled.Logout,
                trailingDescription = "Log out",
                onTrailing = { confirmLogout = true },
            )

            Column(modifier = Modifier.padding(horizontal = 16.dp)) {
                val isToday = state.overviewDate == java.time.LocalDate.now()
                val d = state.daySummary
                val present = if (isToday) s.presentNow else (d?.present ?: 0)
                val total = if (isToday) s.totalStaff else (d?.total ?: 0)

                AnimatedEntrance(index = 0) {
                    OverviewHero(
                        title = if (isToday) "Present today" else "Present on ${state.overviewDate.dayOfMonth} ${DASH_MONTHS[state.overviewDate.monthValue]}",
                        present = present,
                        total = total,
                        rate = if (isToday) s.attendanceRate else if (total > 0) present * 100 / total else 0,
                        footnote = if (isToday) "${s.branches} branch${if (s.branches == 1) "" else "es"} · ${s.totalStaff} staff" else "Past day",
                        onPickDate = { showOverviewPicker = true },
                        onToday = if (isToday) null else ({ viewModel.pickOverviewDate(java.time.LocalDate.now()) }),
                    )
                }

                AttentionCard(
                    pendingApprovals = if (isToday) s.pendingApprovals else 0,
                    notifications = state.notifications,
                    unread = state.unread,
                    onSeen = viewModel::markNotificationsRead,
                )

                Spacer(Modifier.height(14.dp))
                AnimatedEntrance(index = 1) { Column {
                    if (isToday) {
                        StatRow(
                            StatCardData("Absent", s.absent.toString(), StatusOff, Icons.Outlined.PersonOff),
                            StatCardData("Late arrivals", s.lateArrivals.toString(), StatusHalf, Icons.Outlined.Schedule),
                        )
                        Spacer(Modifier.height(12.dp))
                        StatRow(
                            StatCardData("On leave", s.onLeave.toString(), StatusLeave, Icons.Outlined.BeachAccess),
                            StatCardData("Awaiting approval", s.pendingApprovals.toString(), Color(0xFFB07D0C), Icons.Outlined.HourglassTop),
                        )
                    } else {
                        StatRow(
                            StatCardData("Late", (d?.late ?: 0).toString(), StatusHalf, Icons.Outlined.Schedule),
                            StatCardData("Absent", (d?.absent ?: 0).toString(), StatusOff, Icons.Outlined.PersonOff),
                        )
                        if (state.dayLoading) {
                            Spacer(Modifier.height(8.dp))
                            Text("Loading…", fontSize = 12.sp, color = MutedText)
                        }
                    }
                } }

                state.error?.let {
                    Spacer(Modifier.height(16.dp))
                    Text(it, color = StatusOff, fontSize = 13.sp)
                }

                // ── Monthly attendance analysis (month filter) ──
                Spacer(Modifier.height(24.dp))
                MonthlyAnalysis(state = state, onShift = viewModel::shiftMonth)

                // App details footer
                Spacer(Modifier.height(28.dp))
                val server = com.hrpayroll.BuildConfig.API_BASE_URL
                    .removePrefix("https://").removePrefix("http://").trimEnd('/')
                    .removeSuffix("/api").removeSuffix("api")
                Text(
                    "Kayaazh Payroll · v${com.hrpayroll.BuildConfig.VERSION_NAME}\nServer: $server",
                    fontSize = 11.sp,
                    lineHeight = 16.sp,
                    textAlign = androidx.compose.ui.text.style.TextAlign.Center,
                    color = MutedText.copy(alpha = 0.7f),
                    modifier = Modifier.fillMaxWidth(),
                )
                Spacer(Modifier.height(20.dp))
            }
        }
    }
}

private data class StatCardData(val label: String, val value: String, val accent: Color, val icon: ImageVector)

@Composable
private fun StatRow(left: StatCardData, right: StatCardData) {
    Row(horizontalArrangement = Arrangement.spacedBy(12.dp)) {
        listOf(left, right).forEach { c ->
            SectionCard(modifier = Modifier.weight(1f)) {
                Row(verticalAlignment = Alignment.CenterVertically) {
                    IconBubble(c.icon, c.accent, size = 42.dp)
                    Spacer(Modifier.width(12.dp))
                    Column {
                        Text(c.value, color = Ink, fontSize = 22.sp, fontWeight = FontWeight.Bold)
                        Text(c.label, color = MutedText, fontSize = 12.sp, maxLines = 1)
                    }
                }
            }
        }
    }
}

/** Who is in today, on the brand green — the one number an owner opens the app for. */
@Composable
private fun OverviewHero(
    title: String,
    present: Int,
    total: Int,
    rate: Int,
    footnote: String,
    onPickDate: () -> Unit,
    onToday: (() -> Unit)?,
) {
    Box(
        modifier = Modifier
            .fillMaxWidth()
            .shadow(14.dp, RoundedCornerShape(28.dp), ambientColor = BrandGreen, spotColor = BrandGreen)
            .clip(RoundedCornerShape(28.dp))
            .background(Brush.linearGradient(listOf(BrandGreen, BrandGreenDark))),
    ) {
        Canvas(Modifier.matchParentSize()) {
            val c = Offset(size.width * 0.95f, size.height * 0.0f)
            drawCircle(Brush.radialGradient(listOf(BrandGold.copy(alpha = 0.35f), Color.Transparent), center = c, radius = size.width * 0.55f), radius = size.width * 0.55f, center = c)
        }
        Column(Modifier.padding(20.dp)) {
            Row(verticalAlignment = Alignment.CenterVertically) {
                Text(title, color = Color.White.copy(alpha = 0.85f), fontSize = 13.sp, fontWeight = FontWeight.SemiBold, modifier = Modifier.weight(1f))
                if (onToday != null) {
                    Text(
                        "Today",
                        color = Color.White,
                        fontSize = 12.sp,
                        fontWeight = FontWeight.Bold,
                        modifier = Modifier.clip(RoundedCornerShape(50)).background(Color.White.copy(alpha = 0.18f)).clickable(onClick = onToday).padding(horizontal = 12.dp, vertical = 6.dp),
                    )
                    Spacer(Modifier.width(8.dp))
                }
                CircleIconButton(Icons.Outlined.CalendarMonth, contentDescription = "Pick a date", onGradient = true, onClick = onPickDate)
            }
            Row(verticalAlignment = Alignment.Bottom) {
                Text("$present", color = Color.White, fontSize = 44.sp, fontWeight = FontWeight.Bold, letterSpacing = (-1).sp)
                Text(" / $total", color = Color.White.copy(alpha = 0.75f), fontSize = 20.sp, fontWeight = FontWeight.SemiBold, modifier = Modifier.padding(bottom = 8.dp))
                Spacer(Modifier.weight(1f))
                Text("$rate%", color = BrandGold, fontSize = 22.sp, fontWeight = FontWeight.Bold, modifier = Modifier.padding(bottom = 6.dp))
            }
            Spacer(Modifier.height(10.dp))
            Box(Modifier.fillMaxWidth().height(8.dp).clip(RoundedCornerShape(50)).background(Color.White.copy(alpha = 0.22f))) {
                Box(
                    Modifier
                        .fillMaxWidth(if (total > 0) (present.toFloat() / total).coerceIn(0f, 1f) else 0f)
                        .height(8.dp)
                        .clip(RoundedCornerShape(50))
                        .background(Color.White),
                )
            }
            Spacer(Modifier.height(10.dp))
            Text(footnote, color = Color.White.copy(alpha = 0.8f), fontSize = 12.sp)
        }
    }
}

/**
 * What needs the admin: punches waiting for sign-off, and the newest unread
 * notifications (three at most — the rest are a "Mark all read" away).
 */
@Composable
private fun AttentionCard(
    pendingApprovals: Int,
    notifications: List<com.hrpayroll.data.remote.dto.NotificationDto>,
    unread: Int,
    onSeen: () -> Unit,
) {
    val unreadItems = notifications.filter { it.isRead == false }
    if (pendingApprovals == 0 && (unread == 0 || unreadItems.isEmpty())) return
    Spacer(Modifier.height(16.dp))
    SectionCard {
        Row(verticalAlignment = Alignment.CenterVertically) {
            Text("Needs your attention", fontSize = 16.sp, fontWeight = FontWeight.Bold, color = Ink, modifier = Modifier.weight(1f))
            if (unread > 0) {
                Text(
                    "$unread new",
                    color = Color(0xFF8A5A00),
                    fontSize = 12.sp,
                    fontWeight = FontWeight.Bold,
                    modifier = Modifier.clip(RoundedCornerShape(50)).background(Color(0xFFFDF1D6)).padding(horizontal = 10.dp, vertical = 4.dp),
                )
            }
        }
        if (pendingApprovals > 0) {
            Spacer(Modifier.height(12.dp))
            AttentionRow(Icons.Outlined.HourglassTop, Color(0xFFB07D0C), "$pendingApprovals punch${if (pendingApprovals == 1) "" else "es"} awaiting approval", "Open the Live tab to approve or reject")
        }
        unreadItems.take(3).forEach { n ->
            Spacer(Modifier.height(12.dp))
            val title = (n.title ?: "").lowercase()
            AttentionRow(
                when {
                    "voucher" in title -> Icons.AutoMirrored.Outlined.ReceiptLong
                    "punch" in title -> Icons.Outlined.Schedule
                    else -> Icons.Outlined.Notifications
                },
                when {
                    "voucher" in title -> BrandGreen
                    "punch" in title -> StatusHalf
                    else -> StatusLeave
                },
                n.title ?: "",
                n.body ?: "",
            )
        }
        if (unread > 0) {
            Spacer(Modifier.height(6.dp))
            TextButton(onClick = onSeen, modifier = Modifier.align(Alignment.End)) {
                Text("Mark all read", fontSize = 13.sp, fontWeight = FontWeight.SemiBold, color = BrandGreen)
            }
        }
    }
}

@Composable
private fun AttentionRow(icon: ImageVector, tint: Color, title: String, body: String) {
    Row(verticalAlignment = Alignment.CenterVertically) {
        IconBubble(icon, tint, size = 38.dp)
        Spacer(Modifier.width(12.dp))
        Column(Modifier.weight(1f)) {
            Text(title, fontSize = 14.sp, fontWeight = FontWeight.SemiBold, color = Ink, maxLines = 1, overflow = androidx.compose.ui.text.style.TextOverflow.Ellipsis)
            if (body.isNotBlank()) Text(body, fontSize = 12.sp, color = MutedText, maxLines = 1, overflow = androidx.compose.ui.text.style.TextOverflow.Ellipsis)
        }
    }
}

private val DASH_MONTHS = arrayOf("", "Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec")

/** Month-filtered attendance totals across all staff (for the admin to analyze). */
@Composable
private fun MonthlyAnalysis(state: AdminDashboardUiState, onShift: (Int) -> Unit) {
    Row(verticalAlignment = Alignment.CenterVertically) {
        Text("This month", fontSize = 17.sp, fontWeight = FontWeight.Bold, color = Ink, modifier = Modifier.weight(1f))
        Row(
            modifier = Modifier.clip(RoundedCornerShape(50)).background(Color.White).border(1.dp, CardBorder, RoundedCornerShape(50)),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            IconButton(onClick = { onShift(-1) }, modifier = Modifier.size(36.dp)) {
                Icon(Icons.Filled.ChevronLeft, contentDescription = "Previous month", tint = Ink)
            }
            Text(
                "${DASH_MONTHS.getOrElse(state.filterMonth) { "" }} ${state.filterYear}",
                fontSize = 13.sp, fontWeight = FontWeight.SemiBold, color = Ink,
            )
            IconButton(onClick = { onShift(1) }, modifier = Modifier.size(36.dp)) {
                Icon(Icons.Filled.ChevronRight, contentDescription = "Next month", tint = Ink)
            }
        }
    }
    Spacer(Modifier.height(12.dp))
    val m = state.monthSummary
    if (state.monthLoading && m == null) {
        androidx.compose.material3.CircularProgressIndicator(Modifier.padding(12.dp).size(22.dp), strokeWidth = 2.dp, color = BrandGreen)
    } else if (m != null) {
        StatRow(
            StatCardData("Present days", com.hrpayroll.utils.days(m.present), StatusPresent, Icons.Outlined.CheckCircle),
            StatCardData("Late days", m.late.toString(), StatusHalf, Icons.Outlined.Schedule),
        )
        Spacer(Modifier.height(12.dp))
        StatRow(
            StatCardData("Absent days", com.hrpayroll.utils.days(m.absent), StatusOff, Icons.Outlined.PersonOff),
            StatCardData("Leave days", com.hrpayroll.utils.days(m.leave), StatusLeave, Icons.Outlined.BeachAccess),
        )
    }
}
