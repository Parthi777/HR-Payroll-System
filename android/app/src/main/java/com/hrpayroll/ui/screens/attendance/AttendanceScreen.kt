package com.hrpayroll.ui.screens.attendance

import androidx.compose.foundation.background
import androidx.compose.material.icons.filled.ChevronLeft
import androidx.compose.material.icons.filled.ChevronRight
import androidx.compose.foundation.layout.size
import androidx.compose.ui.draw.clip
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.offset
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.CameraAlt
import androidx.compose.material.icons.filled.EditNote
import androidx.compose.material.icons.filled.Logout
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Button
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.Card
import androidx.compose.material3.CardDefaults
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.FilterChip
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
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
import com.hrpayroll.ui.components.BrandHeader
import com.hrpayroll.ui.components.StatusChip
import com.hrpayroll.ui.theme.StatusHalf
import com.hrpayroll.ui.theme.StatusHalfBg
import com.hrpayroll.ui.theme.StatusLeave
import com.hrpayroll.ui.theme.StatusLeaveBg
import com.hrpayroll.ui.theme.StatusOff
import com.hrpayroll.ui.theme.StatusOffBg
import com.hrpayroll.ui.theme.StatusPresent
import com.hrpayroll.ui.theme.StatusPresentBg

/**
 * Selfie attendance + records. Gradient header, record cards with status chips
 * (mirrors the UI reference). TODO: wire CameraX + ML Kit liveness + FusedLocation.
 */
private val sampleRecords = listOf(
    AttendanceRecordUi("Tue, Feb 10", "09:00 AM", "06:15 PM", "Present"),
    AttendanceRecordUi("Mon, Feb 09", "—", "—", "Leave"),
    AttendanceRecordUi("Sun, Feb 08", "—", "—", "Off Day"),
    AttendanceRecordUi("Sat, Feb 07", "08:55 AM", "06:10 PM", "Present"),
    AttendanceRecordUi("Fri, Feb 06", "08:55 AM", "01:00 PM", "Half Day"),
)

@Composable
fun AttendanceScreen(
    onCheckIn: () -> Unit = {},
    onCheckOut: () -> Unit = {},
    viewModel: AttendanceViewModel = hiltViewModel(),
) {
    val state by viewModel.uiState.collectAsState()
    val context = androidx.compose.ui.platform.LocalContext.current

    LaunchedEffect(state.manualNotice) {
        state.manualNotice?.let {
            android.widget.Toast.makeText(context, it, android.widget.Toast.LENGTH_LONG).show()
            viewModel.consumeManualNotice()
        }
    }

    if (state.manualOpen) {
        ManualPunchDialog(
            busy = state.manualBusy,
            error = state.manualError,
            forDay = state.manualForDay,
            onDismiss = viewModel::closeManualPunch,
            onSubmit = viewModel::submitManualPunch,
        )
    }

    // Forgot to check out on an earlier day — that day has to be sent for
    // approval before a new check-in is allowed (the backend enforces it too).
    if (state.missingPromptOpen) {
        state.missingCheckout?.let { missing ->
            MissingCheckoutDialog(
                missing = missing,
                onDismiss = viewModel::dismissMissingPrompt,
                onEnter = viewModel::settleMissingCheckout,
            )
        }
    }

    // Refresh history whenever the screen resumes (e.g. returning from a successful check-in).
    val lifecycleOwner = androidx.compose.ui.platform.LocalLifecycleOwner.current
    androidx.compose.runtime.DisposableEffect(lifecycleOwner) {
        val observer = androidx.lifecycle.LifecycleEventObserver { _, event ->
            if (event == androidx.lifecycle.Lifecycle.Event.ON_RESUME) viewModel.loadHistory()
        }
        lifecycleOwner.lifecycle.addObserver(observer)
        onDispose { lifecycleOwner.lifecycle.removeObserver(observer) }
    }

    Box(modifier = Modifier.fillMaxSize().background(MaterialTheme.colorScheme.background)) {
        Column(modifier = Modifier.fillMaxSize()) {
            BrandHeader(title = "Attendance")

            // "Today" summary tiles float up over the header, like the reference.
            Card(
                modifier = Modifier
                    .fillMaxWidth()
                    .offset(y = (-22).dp)
                    .padding(horizontal = 16.dp),
                shape = MaterialTheme.shapes.large,
                colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.surface),
                elevation = CardDefaults.cardElevation(defaultElevation = 6.dp),
            ) {
                Column {
                    Row(modifier = Modifier.fillMaxWidth().padding(vertical = 14.dp)) {
                        TodayStat("Check In", state.todayCheckIn ?: "—", StatusPresent, Modifier.weight(1f))
                        TodayStat("Check Out", state.todayCheckOut ?: "—", StatusOff, Modifier.weight(1f))
                        TodayStat(
                            "Hours",
                            state.todayMinutes?.let { "%d:%02d".format(it / 60, it % 60) } ?: "—",
                            MaterialTheme.colorScheme.primary,
                            Modifier.weight(1f),
                        )
                    }
                    if (state.todayApproval == "PENDING") {
                        Text(
                            "Outside work zone — today's check-in is waiting for HR approval",
                            fontSize = 11.sp,
                            color = StatusHalf,
                            modifier = Modifier.fillMaxWidth().padding(bottom = 10.dp),
                            textAlign = androidx.compose.ui.text.style.TextAlign.Center,
                        )
                    }
                    state.missingCheckout?.let { missing ->
                        Text(
                            "You did not check out on ${missing.dateLabel ?: "an earlier day"} — " +
                                "enter that time before checking in again",
                            fontSize = 11.sp,
                            color = StatusHalf,
                            modifier = Modifier.fillMaxWidth().padding(horizontal = 12.dp, vertical = 10.dp),
                            textAlign = androidx.compose.ui.text.style.TextAlign.Center,
                        )
                    }
                }
            }

            // Records list fills the remaining space.
            Card(
                modifier = Modifier
                    .fillMaxWidth()
                    .weight(1f)
                    .offset(y = (-8).dp)
                    .padding(horizontal = 16.dp),
                shape = MaterialTheme.shapes.large,
                colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.surface),
                elevation = CardDefaults.cardElevation(defaultElevation = 2.dp),
            ) {
                Column(modifier = Modifier.padding(16.dp)) {
                    Text(
                        "Attendance Records",
                        fontSize = 16.sp,
                        fontWeight = FontWeight.Bold,
                        color = MaterialTheme.colorScheme.onSurface,
                    )
                    Spacer(Modifier.height(8.dp))

                    when {
                        state.isLoading -> CircularProgressIndicator(Modifier.padding(24.dp))
                        state.error != null -> Text(
                            "Error: ${state.error}",
                            color = MaterialTheme.colorScheme.error,
                            modifier = Modifier.padding(vertical = 12.dp),
                        )
                    }

                    val records = if (state.usingSampleData) sampleRecords else state.records
                    LazyColumn(
                        verticalArrangement = Arrangement.spacedBy(10.dp),
                        modifier = Modifier.fillMaxSize(),
                    ) {
                        item {
                            MonthCalendar(
                                month = state.calMonth,
                                year = state.calYear,
                                calendar = state.calendar,
                                onShift = viewModel::shiftMonth,
                            )
                        }
                        items(records) { record -> RecordRow(record) }
                    }
                }
            }

            Spacer(Modifier.height(10.dp))

            // One check-in and one check-out per day (the backend also enforces this):
            // Check In is disabled once done; Check Out unlocks after check-in.
            val checkedIn = state.todayCheckIn != null
            val checkedOut = state.todayCheckOut != null
            Row(
                modifier = Modifier.fillMaxWidth().padding(horizontal = 16.dp),
                horizontalArrangement = Arrangement.spacedBy(12.dp),
            ) {
                Button(
                    // An earlier day left open blocks the camera: ask for that
                    // check-out first instead of failing after the selfie.
                    onClick = { if (viewModel.onCheckInTapped()) onCheckIn() },
                    enabled = !checkedIn,
                    modifier = Modifier.weight(1f).height(54.dp),
                    shape = MaterialTheme.shapes.medium,
                    colors = ButtonDefaults.buttonColors(
                        containerColor = StatusPresent,
                        disabledContainerColor = StatusPresentBg,
                    ),
                ) {
                    Icon(
                        Icons.Filled.CameraAlt,
                        contentDescription = null,
                        tint = if (checkedIn) StatusPresent else Color.White,
                    )
                    Text(
                        if (checkedIn) "  Checked In ✓" else "  Check In",
                        color = if (checkedIn) StatusPresent else Color.White,
                        fontWeight = FontWeight.SemiBold,
                    )
                }
                Button(
                    onClick = onCheckOut,
                    enabled = checkedIn && !checkedOut,
                    modifier = Modifier.weight(1f).height(54.dp),
                    shape = MaterialTheme.shapes.medium,
                    colors = ButtonDefaults.buttonColors(
                        containerColor = StatusOff,
                        disabledContainerColor = StatusOffBg,
                    ),
                ) {
                    Icon(
                        Icons.Filled.Logout,
                        contentDescription = null,
                        tint = if (checkedIn && !checkedOut) Color.White else StatusOff,
                    )
                    Text(
                        if (checkedOut) "  Checked Out ✓" else "  Check Out",
                        color = if (checkedIn && !checkedOut) Color.White else StatusOff,
                        fontWeight = FontWeight.SemiBold,
                    )
                }
            }

            // Fallback when the normal gate can't be met — face check failing, or
            // working away from the branch zone. Always needs manager approval.
            TextButton(
                onClick = viewModel::openManualPunch,
                modifier = Modifier.fillMaxWidth().padding(horizontal = 16.dp, vertical = 2.dp),
            ) {
                Icon(Icons.Filled.EditNote, contentDescription = null, modifier = Modifier.size(18.dp))
                Text(
                    if (state.missingCheckout != null) {
                        "  Enter check-out for ${state.missingCheckout?.dateLabel ?: "the missed day"}"
                    } else {
                        "  Can't check in/out? Manual or selfie punch"
                    },
                    fontSize = 13.sp,
                    fontWeight = FontWeight.SemiBold,
                )
            }

            Text(
                "One check-in and one check-out per day",
                modifier = Modifier.fillMaxWidth().padding(bottom = 8.dp),
                fontSize = 11.sp,
                textAlign = androidx.compose.ui.text.style.TextAlign.Center,
                color = MaterialTheme.colorScheme.onBackground.copy(alpha = 0.45f),
            )
        }
    }
}

/** One tile of the floating "Today" summary card. */
@Composable
private fun TodayStat(label: String, value: String, color: Color, modifier: Modifier = Modifier) {
    Column(modifier = modifier, horizontalAlignment = Alignment.CenterHorizontally) {
        Text(value, fontSize = 18.sp, fontWeight = FontWeight.Bold, color = color)
        Spacer(Modifier.height(2.dp))
        Text(
            label,
            fontSize = 11.sp,
            color = MaterialTheme.colorScheme.onSurface.copy(alpha = 0.55f),
        )
    }
}

@Composable
private fun RecordRow(record: AttendanceRecordUi) {
    val (fg, bg) = when (record.status) {
        "Present" -> StatusPresent to StatusPresentBg
        "Leave" -> StatusLeave to StatusLeaveBg
        "Off Day" -> StatusOff to StatusOffBg
        else -> StatusHalf to StatusHalfBg
    }
    Card(
        shape = MaterialTheme.shapes.medium,
        colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.surfaceVariant),
        elevation = CardDefaults.cardElevation(defaultElevation = 0.dp),
    ) {
        Row(
            modifier = Modifier.fillMaxWidth().padding(14.dp),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            Box(
                modifier = Modifier
                    .padding(end = 12.dp)
                    .height(10.dp)
                    .width(10.dp)
                    .background(fg, androidx.compose.foundation.shape.CircleShape),
            )
            Column(modifier = Modifier.weight(1f)) {
                Text(
                    record.date,
                    fontWeight = FontWeight.SemiBold,
                    color = MaterialTheme.colorScheme.onSurface,
                )
                Spacer(Modifier.height(4.dp))
                Text(
                    "In ${record.checkIn}   ·   Out ${record.checkOut}",
                    fontSize = 12.sp,
                    color = MaterialTheme.colorScheme.onSurface.copy(alpha = 0.6f),
                )
            }
            StatusChip(text = record.status, contentColor = fg, containerColor = bg)
        }
    }
}


private val CAL_MONTHS = arrayOf("", "January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December")

private fun dayColors(status: String?): Pair<Color, Color> = when (status) {
    "PRESENT" -> Color(0xFF16A34A) to Color(0xFFDCFCE7)
    "LATE" -> Color(0xFFB45309) to Color(0xFFFEF3C7)
    "HALF_DAY" -> Color(0xFF0284C7) to Color(0xFFE0F2FE)
    "ABSENT" -> Color(0xFFE11D48) to Color(0xFFFFE4E6)
    "LEAVE" -> Color(0xFF4F46E5) to Color(0xFFE0E7FF)
    "PENDING_APPROVAL" -> Color(0xFFB45309) to Color(0xFFFFF7ED)
    "OFF" -> Color(0xFF64748B) to Color(0xFFF1F5F9)
    else -> Color(0xFFB6B6C3) to Color(0xFFF7F7FA) // FUTURE
}

/** Month view of the employee's own attendance — present/absent at a glance. */
@Composable
private fun MonthCalendar(
    month: Int,
    year: Int,
    calendar: com.hrpayroll.data.remote.dto.AttendanceCalendarResponse?,
    onShift: (Int) -> Unit,
) {
    Column(modifier = Modifier.fillMaxWidth().padding(bottom = 6.dp)) {
        Row(verticalAlignment = Alignment.CenterVertically) {
            androidx.compose.material3.IconButton(onClick = { onShift(-1) }) {
                Icon(Icons.Filled.ChevronLeft, contentDescription = "Previous month")
            }
            Text(
                "${CAL_MONTHS.getOrElse(month) { "" }} $year",
                fontWeight = FontWeight.Bold,
                fontSize = 15.sp,
                modifier = Modifier.weight(1f),
                textAlign = androidx.compose.ui.text.style.TextAlign.Center,
            )
            androidx.compose.material3.IconButton(onClick = { onShift(1) }) {
                Icon(Icons.Filled.ChevronRight, contentDescription = "Next month")
            }
        }

        // Weekday header (Sun-first to match weekday indexes from the backend).
        Row(modifier = Modifier.fillMaxWidth()) {
            listOf("S", "M", "T", "W", "T", "F", "S").forEach {
                Text(
                    it,
                    modifier = Modifier.weight(1f),
                    textAlign = androidx.compose.ui.text.style.TextAlign.Center,
                    fontSize = 11.sp,
                    color = MaterialTheme.colorScheme.onSurface.copy(alpha = 0.5f),
                )
            }
        }
        Spacer(Modifier.height(4.dp))

        val days = calendar?.days ?: emptyList()
        if (days.isEmpty()) {
            CircularProgressIndicator(Modifier.padding(20.dp).size(22.dp), strokeWidth = 2.dp)
        } else {
            val firstWeekday = days.firstOrNull()?.weekday ?: 0
            val cells: List<com.hrpayroll.data.remote.dto.CalendarDayDto?> =
                List(firstWeekday) { null } + days
            cells.chunked(7).forEach { week ->
                Row(modifier = Modifier.fillMaxWidth().padding(vertical = 2.dp)) {
                    week.forEach { d ->
                        Box(modifier = Modifier.weight(1f).padding(2.dp), contentAlignment = Alignment.Center) {
                            if (d != null) {
                                val (fg, bg) = dayColors(d.status)
                                Box(
                                    modifier = Modifier
                                        .size(34.dp)
                                        .clip(androidx.compose.foundation.shape.CircleShape)
                                        .background(bg),
                                    contentAlignment = Alignment.Center,
                                ) {
                                    Text("${d.day}", fontSize = 12.sp, fontWeight = FontWeight.SemiBold, color = fg)
                                }
                            }
                        }
                    }
                    repeat(7 - week.size) { Box(Modifier.weight(1f)) }
                }
            }
            Spacer(Modifier.height(6.dp))
            // Legend + month summary
            Row(modifier = Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(10.dp)) {
                LegendDot(Color(0xFF16A34A), "Present ${calendar?.summary?.present ?: 0}")
                LegendDot(Color(0xFFB45309), "Late ${calendar?.summary?.late ?: 0}")
                LegendDot(Color(0xFFE11D48), "Absent ${calendar?.summary?.absent ?: 0}")
                LegendDot(Color(0xFF4F46E5), "Leave ${calendar?.summary?.leave ?: 0}")
            }
        }
        Spacer(Modifier.height(4.dp))
        androidx.compose.material3.HorizontalDivider(color = MaterialTheme.colorScheme.onSurface.copy(alpha = 0.08f))
    }
}

@Composable
private fun LegendDot(color: Color, label: String) {
    Row(verticalAlignment = Alignment.CenterVertically) {
        Box(Modifier.size(8.dp).clip(androidx.compose.foundation.shape.CircleShape).background(color))
        Text("  $label", fontSize = 11.sp, color = MaterialTheme.colorScheme.onSurface.copy(alpha = 0.7f))
    }
}

/**
 * "You forgot to check out" alert. Raised when Check In is tapped while an
 * earlier day is still open — the employee has to send that day's check-out for
 * approval before a new check-in is allowed.
 */
@Composable
private fun MissingCheckoutDialog(
    missing: com.hrpayroll.data.remote.dto.MissingCheckoutDto,
    onDismiss: () -> Unit,
    onEnter: () -> Unit,
) {
    AlertDialog(
        onDismissRequest = onDismiss,
        title = { Text("Please enter previous day check-out time", fontWeight = FontWeight.Bold, fontSize = 17.sp) },
        text = {
            Column {
                Text(
                    "You checked in on ${missing.dateLabel ?: "an earlier day"}" +
                        (missing.checkIn?.let { " at $it" } ?: "") +
                        " but never checked out. Enter that day's check-out time and send it to your " +
                        "reporting manager — then you can check in today.",
                    fontSize = 13.sp,
                    color = MaterialTheme.colorScheme.onSurface.copy(alpha = 0.8f),
                )
                if (missing.openDays > 1) {
                    Spacer(Modifier.height(8.dp))
                    Text(
                        "${missing.openDays} days are still open — start with the oldest.",
                        fontSize = 12.sp,
                        color = StatusHalf,
                    )
                }
            }
        },
        confirmButton = { Button(onClick = onEnter) { Text("Enter check-out time") } },
        dismissButton = { TextButton(onClick = onDismiss) { Text("Not now") } },
    )
}

/** "18:00" (or "9:5") → minutes since midnight; null when unparseable. */
private fun parseHhMm(t: String?): Pair<Int, Int>? {
    val parts = t?.split(":") ?: return null
    if (parts.size < 2) return null
    val h = parts[0].trim().toIntOrNull() ?: return null
    val m = parts[1].trim().toIntOrNull() ?: return null
    return if (h in 0..23 && m in 0..59) h to m else null
}

/** 18, 0 → "06:00 PM" for display (the API always receives 24-hour "HH:MM"). */
private fun display12h(hour: Int, minute: Int): String {
    val h12 = when {
        hour == 0 -> 12
        hour > 12 -> hour - 12
        else -> hour
    }
    val suffix = if (hour < 12) "AM" else "PM"
    return "%02d:%02d %s".format(h12, minute, suffix)
}

/**
 * 12-hour clock picker. Times are typed nowhere — the employee dials them in,
 * so a punch can't arrive as "25:70" or in the wrong half of the day.
 */
@OptIn(androidx.compose.material3.ExperimentalMaterial3Api::class)
@Composable
private fun TimePickerDialog(
    title: String,
    initial: Pair<Int, Int>,
    onDismiss: () -> Unit,
    onPick: (hour: Int, minute: Int) -> Unit,
) {
    val stateTp = androidx.compose.material3.rememberTimePickerState(
        initialHour = initial.first,
        initialMinute = initial.second,
        is24Hour = false,
    )
    AlertDialog(
        onDismissRequest = onDismiss,
        title = { Text(title, fontWeight = FontWeight.Bold, fontSize = 16.sp) },
        text = {
            Box(modifier = Modifier.fillMaxWidth(), contentAlignment = Alignment.Center) {
                androidx.compose.material3.TimePicker(state = stateTp)
            }
        },
        confirmButton = { Button(onClick = { onPick(stateTp.hour, stateTp.minute) }) { Text("Set") } },
        dismissButton = { TextButton(onClick = onDismiss) { Text("Cancel") } },
    )
}

/**
 * One read-only time field that opens the 12-hour picker. `value` is the
 * 24-hour "HH:MM" sent to the API; the field shows it as "06:00 PM".
 */
@Composable
private fun TimeField(
    label: String,
    value: String,
    fallback: Pair<Int, Int>,
    modifier: Modifier = Modifier,
    onChange: (String) -> Unit,
) {
    var picking by remember { mutableStateOf(false) }
    val picked = parseHhMm(value)

    if (picking) {
        TimePickerDialog(
            title = "Select $label",
            initial = picked ?: fallback,
            onDismiss = { picking = false },
            onPick = { h, m ->
                onChange("%02d:%02d".format(h, m))
                picking = false
            },
        )
    }

    OutlinedButton(
        onClick = { picking = true },
        modifier = modifier.height(56.dp),
        shape = MaterialTheme.shapes.small,
    ) {
        Column(horizontalAlignment = Alignment.CenterHorizontally) {
            Text(label, fontSize = 10.sp, color = MaterialTheme.colorScheme.onSurface.copy(alpha = 0.6f))
            Text(
                picked?.let { display12h(it.first, it.second) } ?: "Tap to set",
                fontSize = 14.sp,
                fontWeight = FontWeight.SemiBold,
            )
        }
    }
}

/**
 * Manual / selfie punch sheet.
 *
 * The escape hatch for a day that can't go through the normal gate — face
 * verification failing, or the employee working away from the branch geofence.
 * Geofence and shift-time checks are skipped; the punch is held for the
 * reporting manager, so it counts for payroll only once they approve it.
 *
 * When `forDay` is set the sheet is settling a day that was left open: the date
 * is fixed, and only the missing check-out is asked for.
 */
@Composable
private fun ManualPunchDialog(
    busy: Boolean,
    error: String?,
    forDay: com.hrpayroll.data.remote.dto.MissingCheckoutDto?,
    onDismiss: () -> Unit,
    onSubmit: (mode: String, reason: String, checkIn: String?, checkOut: String?, selfie: ByteArray?) -> Unit,
) {
    val context = androidx.compose.ui.platform.LocalContext.current
    var mode by remember { mutableStateOf("MANUAL") }
    var checkIn by remember { mutableStateOf("") }
    // Settling an open day: default the picker to that shift's closing time.
    var checkOut by remember { mutableStateOf(if (forDay != null) forDay.shiftEnd.orEmpty() else "") }
    var reason by remember { mutableStateOf(if (forDay != null) "Forgot to check out" else "") }
    var selfie by remember { mutableStateOf<ByteArray?>(null) }
    var selfieUri by remember { mutableStateOf<android.net.Uri?>(null) }

    val cameraLauncher = androidx.activity.compose.rememberLauncherForActivityResult(
        androidx.activity.result.contract.ActivityResultContracts.TakePicture(),
    ) { ok ->
        val uri = selfieUri
        if (ok && uri != null) selfie = com.hrpayroll.utils.MediaUtils.compressImage(context, uri)
    }

    fun takeSelfie() {
        val file = java.io.File(context.cacheDir, "manual-punch-${System.currentTimeMillis()}.jpg")
        val uri = androidx.core.content.FileProvider.getUriForFile(
            context,
            "${context.packageName}.fileprovider",
            file,
        )
        selfieUri = uri
        cameraLauncher.launch(uri)
    }

    AlertDialog(
        onDismissRequest = { if (!busy) onDismiss() },
        title = {
            Text(
                if (forDay != null) "Check-out for ${forDay.dateLabel ?: "the missed day"}" else "Manual / selfie punch",
                fontWeight = FontWeight.Bold,
            )
        },
        text = {
            Column {
                Text(
                    if (forDay != null) {
                        "You checked in at ${forDay.checkIn ?: "—"} that day but never checked out. " +
                            "Set the time you left — your reporting manager has to approve it before it is paid."
                    } else {
                        "Use this when you could not check in or out normally. Your reporting manager has to approve it " +
                            "before it counts for payroll."
                    },
                    fontSize = 12.sp,
                    color = MaterialTheme.colorScheme.onSurface.copy(alpha = 0.7f),
                )
                Spacer(Modifier.height(12.dp))

                // A selfie taken today proves nothing about a day already past,
                // so settling an open day is always a plain manual punch.
                if (forDay == null) {
                    Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                        FilterChip(
                            selected = mode == "MANUAL",
                            onClick = { mode = "MANUAL" },
                            label = { Text("Manual", fontSize = 13.sp) },
                        )
                        FilterChip(
                            selected = mode == "SELFIE",
                            onClick = { mode = "SELFIE" },
                            label = { Text("With selfie", fontSize = 13.sp) },
                        )
                    }
                    Spacer(Modifier.height(12.dp))
                }

                Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                    if (forDay == null) {
                        TimeField(
                            label = "Check-in",
                            value = checkIn,
                            fallback = 9 to 0,
                            modifier = Modifier.weight(1f),
                            onChange = { checkIn = it },
                        )
                    }
                    TimeField(
                        label = "Check-out",
                        value = checkOut,
                        fallback = parseHhMm(forDay?.shiftEnd) ?: (18 to 0),
                        modifier = Modifier.weight(1f),
                        onChange = { checkOut = it },
                    )
                }
                Text(
                    if (forDay != null) {
                        "Tap to pick the time you actually left."
                    } else {
                        "Tap a field to pick the time. Set only the punch you missed."
                    },
                    fontSize = 11.sp,
                    color = MaterialTheme.colorScheme.onSurface.copy(alpha = 0.55f),
                )
                Spacer(Modifier.height(10.dp))

                OutlinedTextField(
                    value = reason,
                    onValueChange = { reason = it },
                    label = { Text("Reason", fontSize = 12.sp) },
                    placeholder = { Text("e.g. Customer site visit, outside the branch zone") },
                    modifier = Modifier.fillMaxWidth(),
                    minLines = 2,
                )

                if (mode == "SELFIE") {
                    Spacer(Modifier.height(10.dp))
                    OutlinedButton(onClick = { takeSelfie() }, modifier = Modifier.fillMaxWidth()) {
                        Icon(Icons.Filled.CameraAlt, contentDescription = null, modifier = Modifier.size(18.dp))
                        Text(if (selfie != null) "  Selfie captured ✓ — retake" else "  Take selfie")
                    }
                }

                if (error != null) {
                    Spacer(Modifier.height(10.dp))
                    Text(error, fontSize = 12.sp, color = MaterialTheme.colorScheme.error)
                }
            }
        },
        confirmButton = {
            Button(
                onClick = { onSubmit(mode, reason, checkIn, checkOut, selfie) },
                enabled = !busy,
            ) {
                if (busy) {
                    CircularProgressIndicator(Modifier.size(16.dp), strokeWidth = 2.dp, color = Color.White)
                } else {
                    Text("Send for approval")
                }
            }
        },
        dismissButton = {
            TextButton(onClick = onDismiss, enabled = !busy) { Text("Cancel") }
        },
    )
}
