package com.hrpayroll.ui.screens.home

import androidx.compose.foundation.Canvas
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.Logout
import androidx.compose.material.icons.automirrored.outlined.ReceiptLong
import androidx.compose.material.icons.outlined.BeachAccess
import androidx.compose.material.icons.outlined.CheckCircle
import androidx.compose.material.icons.outlined.EventBusy
import androidx.compose.material.icons.outlined.Fingerprint
import androidx.compose.material.icons.outlined.HourglassTop
import androidx.compose.material.icons.outlined.LocationOn
import androidx.compose.material.icons.outlined.Notifications
import androidx.compose.material.icons.outlined.Payments
import androidx.compose.material.icons.outlined.Phone
import androidx.compose.material.icons.outlined.Schedule
import androidx.compose.material.icons.outlined.EventAvailable
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Switch
import androidx.compose.material3.SwitchDefaults
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.draw.shadow
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.StrokeCap
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.hilt.navigation.compose.hiltViewModel
import com.hrpayroll.ui.components.AnimatedEntrance
import com.hrpayroll.ui.components.BrandWash
import com.hrpayroll.ui.components.CircleIconButton
import com.hrpayroll.ui.components.IconBubble
import com.hrpayroll.ui.components.SectionCard
import com.hrpayroll.ui.components.SectionTitle
import com.hrpayroll.ui.theme.BrandGold
import com.hrpayroll.ui.theme.BrandGreen
import com.hrpayroll.ui.theme.BrandGreenBright
import com.hrpayroll.ui.theme.BrandGreenDark
import com.hrpayroll.ui.theme.BrandMint
import com.hrpayroll.ui.theme.BrandSurface
import com.hrpayroll.ui.theme.CardBorder
import com.hrpayroll.ui.theme.Ink
import com.hrpayroll.ui.theme.MutedText
import com.hrpayroll.ui.theme.StatusHalf
import com.hrpayroll.ui.theme.StatusLeave
import com.hrpayroll.ui.theme.StatusMuted
import com.hrpayroll.ui.theme.StatusOff
import com.hrpayroll.ui.theme.StatusPresent

/**
 * Employee home: who you are, where today stands (and the one button that
 * matters), this month at a glance, and shortcuts to everything else.
 */
@Composable
fun HomeScreen(
    onCheckIn: () -> Unit,
    onLogout: () -> Unit = {},
    onCheckOut: () -> Unit = {},
    onOpenAttendance: () -> Unit = {},
    onApplyLeave: () -> Unit = {},
    onNewVoucher: () -> Unit = {},
    onOpenPayroll: () -> Unit = {},
    viewModel: HomeViewModel = hiltViewModel(),
) {
    val s by viewModel.uiState.collectAsState()
    val context = androidx.compose.ui.platform.LocalContext.current
    var locationOn by remember { mutableStateOf(true) }
    var confirmLogout by remember { mutableStateOf(false) }
    var showHr by remember { mutableStateOf(false) }

    if (showHr) {
        androidx.compose.material3.AlertDialog(
            onDismissRequest = { showHr = false },
            title = { Text(s.hrName.ifBlank { "Contact HR" }) },
            text = {
                Column {
                    Text(s.hrPhone, fontSize = 20.sp, fontWeight = FontWeight.Bold, color = MaterialTheme.colorScheme.onSurface)
                    Spacer(Modifier.height(6.dp))
                    Text(
                        "For anything about your attendance, leave or salary.",
                        fontSize = 13.sp,
                        color = MaterialTheme.colorScheme.onSurface.copy(alpha = 0.6f),
                    )
                }
            },
            confirmButton = {
                androidx.compose.material3.TextButton(onClick = {
                    showHr = false
                    // ACTION_DIAL opens the dialer with the number filled in rather
                    // than placing the call — it needs no permission, and the person
                    // still decides. A handset with no dialler (a tablet) simply has
                    // nothing to resolve, so the failure is caught rather than crashing.
                    runCatching {
                        context.startActivity(
                            android.content.Intent(
                                android.content.Intent.ACTION_DIAL,
                                android.net.Uri.parse("tel:${s.hrPhone}"),
                            ),
                        )
                    }
                }) { Text("Call") }
            },
            dismissButton = {
                androidx.compose.material3.TextButton(onClick = { showHr = false }) { Text("Close") }
            },
        )
    }

    if (confirmLogout) {
        androidx.compose.material3.AlertDialog(
            onDismissRequest = { confirmLogout = false },
            title = { Text("Log out?") },
            text = { Text("You will need your employee ID and password to sign in again.") },
            confirmButton = {
                androidx.compose.material3.TextButton(onClick = {
                    confirmLogout = false
                    viewModel.logout()
                    onLogout()
                }) { Text("Log out") }
            },
            dismissButton = {
                androidx.compose.material3.TextButton(onClick = { confirmLogout = false }) { Text("Cancel") }
            },
        )
    }

    Box(modifier = Modifier.fillMaxSize().background(BrandSurface)) {
        BrandWash(Modifier.fillMaxWidth().height(300.dp))
        Column(modifier = Modifier.fillMaxSize().verticalScroll(rememberScrollState())) {

            // ── Greeting ──
            Row(
                modifier = Modifier.fillMaxWidth().padding(start = 20.dp, end = 20.dp, top = 16.dp),
                verticalAlignment = Alignment.CenterVertically,
            ) {
                Avatar(name = s.name, photoUrl = s.photoUrl, token = viewModel.authToken)
                Spacer(Modifier.width(12.dp))
                Column(modifier = Modifier.weight(1f)) {
                    Text(greeting(), color = MutedText, fontSize = 13.sp)
                    Text(
                        s.name,
                        color = Ink,
                        fontSize = 21.sp,
                        fontWeight = FontWeight.Bold,
                        maxLines = 1,
                        overflow = TextOverflow.Ellipsis,
                    )
                }
                CircleIconButton(Icons.Outlined.Notifications, contentDescription = "Alerts", onClick = {})
                Spacer(Modifier.width(10.dp))
                CircleIconButton(Icons.AutoMirrored.Filled.Logout, contentDescription = "Log out", onClick = { confirmLogout = true })
            }
            Row(
                modifier = Modifier.padding(start = 20.dp, top = 12.dp),
                horizontalArrangement = Arrangement.spacedBy(8.dp),
            ) {
                if (s.designation.isNotBlank()) InfoPill(s.designation)
                if (s.employeeCode.isNotBlank()) InfoPill("ID ${s.employeeCode}")
            }

            // ── Today ──
            AnimatedEntrance(index = 0) {
                TodayCard(
                    checkIn = s.checkInTime,
                    checkOut = s.checkOutTime,
                    worked = s.todayWorked,
                    onCheckIn = onCheckIn,
                    onCheckOut = onCheckOut,
                    onDetails = onOpenAttendance,
                    modifier = Modifier.padding(start = 16.dp, end = 16.dp, top = 18.dp),
                )
            }

            // ── This month ──
            SectionTitle(
                text = if (s.monthLabel.isBlank()) "This month" else "${s.monthLabel} at a glance",
                action = "Calendar",
                onAction = onOpenAttendance,
                modifier = Modifier.padding(start = 20.dp, end = 14.dp, top = 24.dp, bottom = 10.dp),
            )
            AnimatedEntrance(index = 1) {
                Column(modifier = Modifier.padding(horizontal = 16.dp), verticalArrangement = Arrangement.spacedBy(12.dp)) {
                    Row(horizontalArrangement = Arrangement.spacedBy(12.dp)) {
                        MiniStat("Present", s.presentDays.toString(), Icons.Outlined.CheckCircle, StatusPresent, Modifier.weight(1f))
                        MiniStat("Late", s.lateDays.toString(), Icons.Outlined.Schedule, StatusHalf, Modifier.weight(1f))
                    }
                    Row(horizontalArrangement = Arrangement.spacedBy(12.dp)) {
                        MiniStat("Absent", formatDays(s.absentDays + s.halfDays * 0.5), Icons.Outlined.EventBusy, StatusOff, Modifier.weight(1f))
                        MiniStat("On leave", s.leaveDays.toString(), Icons.Outlined.BeachAccess, StatusLeave, Modifier.weight(1f))
                    }
                    RateCard(rate = s.attendanceRate, pending = s.pendingDays, leaveBalance = s.leaveBalance)
                }
            }

            // ── Shortcuts ──
            SectionTitle("Quick actions", modifier = Modifier.padding(start = 20.dp, end = 20.dp, top = 24.dp, bottom = 10.dp))
            AnimatedEntrance(index = 2) {
                // Three to a row, so five shortcuts never squeeze their labels.
                val actions = buildList {
                    add(Shortcut(Icons.Outlined.Fingerprint, "Attendance", BrandGreen, onOpenAttendance))
                    add(Shortcut(Icons.Outlined.EventAvailable, "Apply leave", StatusLeave, onApplyLeave))
                    add(Shortcut(Icons.AutoMirrored.Outlined.ReceiptLong, "New voucher", Color(0xFFB07D0C), onNewVoucher))
                    // Only while the dealer shares payroll with staff.
                    if (s.payrollVisible) add(Shortcut(Icons.Outlined.Payments, "Payslips", BrandGreenDark, onOpenPayroll))
                    // Only offered when the dealership named someone: a button that
                    // dials nothing is worse than no button.
                    if (s.hrPhone.isNotBlank()) add(Shortcut(Icons.Outlined.Phone, "Call HR", StatusOff) { showHr = true })
                }
                Column(modifier = Modifier.padding(horizontal = 16.dp), verticalArrangement = Arrangement.spacedBy(10.dp)) {
                    actions.chunked(3).forEach { row ->
                        Row(horizontalArrangement = Arrangement.spacedBy(10.dp)) {
                            row.forEach { QuickAction(it.icon, it.label, it.tint, Modifier.weight(1f), it.onClick) }
                            repeat(3 - row.size) { Spacer(Modifier.weight(1f)) }
                        }
                    }
                }
            }

            // ── Location ──
            AnimatedEntrance(index = 3) {
                SectionCard(modifier = Modifier.padding(start = 16.dp, end = 16.dp, top = 16.dp)) {
                    Row(verticalAlignment = Alignment.CenterVertically) {
                        IconBubble(Icons.Outlined.LocationOn, StatusOff)
                        Column(modifier = Modifier.weight(1f).padding(start = 14.dp)) {
                            Text("Location", fontWeight = FontWeight.SemiBold, color = Ink, fontSize = 15.sp)
                            Text("Used to verify you are at your branch when you check in", fontSize = 12.sp, color = MutedText)
                        }
                        Switch(
                            checked = locationOn,
                            onCheckedChange = { locationOn = it },
                            colors = SwitchDefaults.colors(checkedTrackColor = BrandGreen, checkedThumbColor = Color.White),
                        )
                    }
                }
            }
            Spacer(Modifier.height(28.dp))
        }
    }
}

private class Shortcut(val icon: ImageVector, val label: String, val tint: Color, val onClick: () -> Unit)

/** "Good morning" / "Good afternoon" / "Good evening", by the phone's clock. */
private fun greeting(): String = when (java.time.LocalTime.now().hour) {
    in 0..11 -> "Good morning,"
    in 12..16 -> "Good afternoon,"
    else -> "Good evening,"
}

/** 2.0 → "2", 2.5 → "2.5": half days count half. */
private fun formatDays(d: Double): String = if (d % 1.0 == 0.0) d.toInt().toString() else d.toString()

@Composable
private fun Avatar(name: String, photoUrl: String, token: String?) {
    val initials = name.split(" ").filter { it.isNotBlank() }.take(2).joinToString("") { it.first().uppercase() }.ifBlank { "?" }
    Box(
        modifier = Modifier
            .size(52.dp)
            .clip(CircleShape)
            .background(Brush.linearGradient(listOf(BrandGreenBright, BrandGold)))
            .padding(2.dp)
            .clip(CircleShape)
            .background(Color.White)
            .padding(2.dp)
            .clip(CircleShape)
            .background(BrandMint),
        contentAlignment = Alignment.Center,
    ) {
        Text(initials, color = BrandGreen, fontWeight = FontWeight.Bold, fontSize = 17.sp)
        if (photoUrl.isNotBlank()) {
            coil.compose.AsyncImage(
                model = coil.request.ImageRequest.Builder(androidx.compose.ui.platform.LocalContext.current)
                    .data(photoUrl)
                    .apply { token?.let { addHeader("Authorization", "Bearer $it") } }
                    // Never persist to disk — a wrong photo must not survive a re-login
                    // on a shared phone or an employee re-enrollment.
                    .diskCachePolicy(coil.request.CachePolicy.DISABLED)
                    .crossfade(true)
                    .build(),
                contentDescription = "Profile photo",
                contentScale = androidx.compose.ui.layout.ContentScale.Crop,
                modifier = Modifier.fillMaxSize().clip(CircleShape),
            )
        }
    }
}

@Composable
private fun InfoPill(text: String) {
    Text(
        text,
        color = BrandGreenDark,
        fontSize = 12.sp,
        fontWeight = FontWeight.SemiBold,
        modifier = Modifier
            .clip(RoundedCornerShape(50))
            .background(Color.White.copy(alpha = 0.85f))
            .border(1.dp, CardBorder, RoundedCornerShape(50))
            .padding(horizontal = 12.dp, vertical = 5.dp),
    )
}

/**
 * Today, on the brand green: where the day stands and the one action that
 * matters right now. White text sits on the deeper greens only.
 */
@Composable
private fun TodayCard(
    checkIn: String?,
    checkOut: String?,
    worked: String,
    onCheckIn: () -> Unit,
    onCheckOut: () -> Unit,
    onDetails: () -> Unit,
    modifier: Modifier = Modifier,
) {
    val date = java.time.LocalDate.now().format(java.time.format.DateTimeFormatter.ofPattern("EEEE, d MMMM"))
    val (headline, action) = when {
        checkIn == null -> "You haven't checked in yet" to "Check in now"
        checkOut == null -> "You're on duty" to "Check out"
        else -> "Day complete — well done" to "View attendance"
    }
    Box(
        modifier = modifier
            .fillMaxWidth()
            .shadow(14.dp, RoundedCornerShape(28.dp), ambientColor = BrandGreen, spotColor = BrandGreen)
            .clip(RoundedCornerShape(28.dp))
            .background(Brush.linearGradient(listOf(BrandGreen, BrandGreenDark))),
    ) {
        // A soft yellow glow in the corner, the brand's second colour.
        Canvas(Modifier.matchParentSize()) {
            val c = Offset(size.width * 0.95f, size.height * 0.05f)
            drawCircle(Brush.radialGradient(listOf(BrandGold.copy(alpha = 0.35f), Color.Transparent), center = c, radius = size.width * 0.55f), radius = size.width * 0.55f, center = c)
            val g = Offset(size.width * 0.0f, size.height * 1.0f)
            drawCircle(Brush.radialGradient(listOf(BrandGreenBright.copy(alpha = 0.45f), Color.Transparent), center = g, radius = size.width * 0.6f), radius = size.width * 0.6f, center = g)
        }
        Column(modifier = Modifier.padding(20.dp)) {
            Row(verticalAlignment = Alignment.CenterVertically) {
                Box(Modifier.size(8.dp).clip(CircleShape).background(if (checkIn != null && checkOut == null) BrandGold else Color.White.copy(alpha = 0.6f)))
                Spacer(Modifier.width(8.dp))
                Text("TODAY · ${date.uppercase()}", color = Color.White.copy(alpha = 0.85f), fontSize = 11.sp, fontWeight = FontWeight.SemiBold, letterSpacing = 0.8.sp)
            }
            Spacer(Modifier.height(10.dp))
            Text(headline, color = Color.White, fontSize = 22.sp, fontWeight = FontWeight.Bold)
            Spacer(Modifier.height(16.dp))
            Row(
                modifier = Modifier
                    .fillMaxWidth()
                    .clip(RoundedCornerShape(18.dp))
                    .background(Color.White.copy(alpha = 0.12f))
                    .padding(vertical = 12.dp),
            ) {
                TimeCell("Check in", checkIn ?: "--:--", Modifier.weight(1f))
                Box(Modifier.width(1.dp).height(34.dp).background(Color.White.copy(alpha = 0.2f)).align(Alignment.CenterVertically))
                TimeCell("Check out", checkOut ?: "--:--", Modifier.weight(1f))
                Box(Modifier.width(1.dp).height(34.dp).background(Color.White.copy(alpha = 0.2f)).align(Alignment.CenterVertically))
                TimeCell("Worked", if (worked == "—" || worked == "On duty") "--" else worked, Modifier.weight(1f))
            }
            Spacer(Modifier.height(16.dp))
            Row(
                modifier = Modifier
                    .fillMaxWidth()
                    .height(50.dp)
                    .clip(RoundedCornerShape(16.dp))
                    .background(Color.White)
                    .clickable(onClick = when {
                        checkIn == null -> onCheckIn
                        checkOut == null -> onCheckOut
                        else -> onDetails
                    }),
                horizontalArrangement = Arrangement.Center,
                verticalAlignment = Alignment.CenterVertically,
            ) {
                Icon(Icons.Outlined.Fingerprint, contentDescription = null, tint = BrandGreen, modifier = Modifier.size(20.dp))
                Spacer(Modifier.width(8.dp))
                Text(action, color = BrandGreen, fontWeight = FontWeight.Bold, fontSize = 15.sp)
            }
        }
    }
}

@Composable
private fun TimeCell(label: String, value: String, modifier: Modifier) {
    Column(modifier = modifier, horizontalAlignment = Alignment.CenterHorizontally) {
        Text(value, color = Color.White, fontSize = 15.sp, fontWeight = FontWeight.Bold, maxLines = 1)
        Spacer(Modifier.height(2.dp))
        Text(label, color = Color.White.copy(alpha = 0.75f), fontSize = 11.sp)
    }
}

@Composable
private fun MiniStat(label: String, value: String, icon: ImageVector, tint: Color, modifier: Modifier) {
    SectionCard(modifier = modifier) {
        Row(verticalAlignment = Alignment.CenterVertically) {
            IconBubble(icon, tint, size = 42.dp)
            Spacer(Modifier.width(12.dp))
            Column {
                Text(value, color = Ink, fontSize = 22.sp, fontWeight = FontWeight.Bold, letterSpacing = (-0.4).sp)
                Text(label, color = MutedText, fontSize = 12.sp, fontWeight = FontWeight.Medium)
            }
        }
    }
}

/** Attendance rate as a ring, with what is waiting on a manager and the leave left. */
@Composable
private fun RateCard(rate: Int, pending: Int, leaveBalance: Double) {
    SectionCard {
        Row(verticalAlignment = Alignment.CenterVertically) {
            Box(contentAlignment = Alignment.Center, modifier = Modifier.size(78.dp)) {
                CircularProgressIndicator(
                    progress = { 1f },
                    modifier = Modifier.fillMaxSize(),
                    color = BrandMint,
                    strokeWidth = 8.dp,
                )
                CircularProgressIndicator(
                    progress = { (rate / 100f).coerceIn(0f, 1f) },
                    modifier = Modifier.fillMaxSize(),
                    color = BrandGreen,
                    strokeWidth = 8.dp,
                    strokeCap = StrokeCap.Round,
                    trackColor = Color.Transparent,
                )
                Text("$rate%", color = Ink, fontWeight = FontWeight.Bold, fontSize = 17.sp)
            }
            Spacer(Modifier.width(18.dp))
            Column(modifier = Modifier.weight(1f)) {
                Text("Attendance rate", color = Ink, fontWeight = FontWeight.SemiBold, fontSize = 15.sp)
                Spacer(Modifier.height(8.dp))
                Row(verticalAlignment = Alignment.CenterVertically) {
                    Icon(Icons.Outlined.HourglassTop, contentDescription = null, tint = StatusMuted, modifier = Modifier.size(15.dp))
                    Text(
                        if (pending == 0) "  Nothing awaiting approval" else "  $pending day${if (pending == 1) "" else "s"} awaiting approval",
                        color = MutedText,
                        fontSize = 12.sp,
                    )
                }
                Spacer(Modifier.height(4.dp))
                Row(verticalAlignment = Alignment.CenterVertically) {
                    Icon(Icons.Outlined.BeachAccess, contentDescription = null, tint = StatusLeave, modifier = Modifier.size(15.dp))
                    Text("  ${formatDays(leaveBalance)} days of leave left", color = MutedText, fontSize = 12.sp)
                }
            }
        }
    }
}

@Composable
private fun QuickAction(icon: ImageVector, label: String, tint: Color, modifier: Modifier = Modifier, onClick: () -> Unit) {
    Column(
        modifier = modifier
            .clip(RoundedCornerShape(20.dp))
            .background(Color.White)
            .border(1.dp, CardBorder, RoundedCornerShape(20.dp))
            .clickable(onClick = onClick)
            .padding(vertical = 14.dp, horizontal = 6.dp),
        horizontalAlignment = Alignment.CenterHorizontally,
    ) {
        IconBubble(icon, tint, size = 44.dp)
        Spacer(Modifier.height(8.dp))
        Text(label, color = Ink, fontSize = 12.sp, fontWeight = FontWeight.SemiBold, maxLines = 1, overflow = TextOverflow.Ellipsis)
    }
}
