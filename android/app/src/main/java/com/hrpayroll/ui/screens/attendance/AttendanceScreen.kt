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
            onDismiss = viewModel::closeManualPunch,
            onSubmit = viewModel::submitManualPunch,
        )
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
                    onClick = onCheckIn,
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
                Text("  Can't check in/out? Manual or selfie punch", fontSize = 13.sp, fontWeight = FontWeight.SemiBold)
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
 * Manual / selfie punch sheet.
 *
 * The escape hatch for a day that can't go through the normal gate — face
 * verification failing, or the employee working away from the branch geofence.
 * Geofence and shift-time checks are skipped; the punch is held for the
 * reporting manager, so it counts for payroll only once they approve it.
 */
@Composable
private fun ManualPunchDialog(
    busy: Boolean,
    error: String?,
    onDismiss: () -> Unit,
    onSubmit: (mode: String, reason: String, checkIn: String?, checkOut: String?, selfie: ByteArray?) -> Unit,
) {
    val context = androidx.compose.ui.platform.LocalContext.current
    var mode by remember { mutableStateOf("MANUAL") }
    var checkIn by remember { mutableStateOf("") }
    var checkOut by remember { mutableStateOf("") }
    var reason by remember { mutableStateOf("") }
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
        title = { Text("Manual / selfie punch", fontWeight = FontWeight.Bold) },
        text = {
            Column {
                Text(
                    "Use this when you could not check in or out normally. Your reporting manager has to approve it " +
                        "before it counts for payroll.",
                    fontSize = 12.sp,
                    color = MaterialTheme.colorScheme.onSurface.copy(alpha = 0.7f),
                )
                Spacer(Modifier.height(12.dp))

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

                Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                    OutlinedTextField(
                        value = checkIn,
                        onValueChange = { checkIn = it },
                        label = { Text("Check-in", fontSize = 12.sp) },
                        placeholder = { Text("09:30") },
                        singleLine = true,
                        modifier = Modifier.weight(1f),
                    )
                    OutlinedTextField(
                        value = checkOut,
                        onValueChange = { checkOut = it },
                        label = { Text("Check-out", fontSize = 12.sp) },
                        placeholder = { Text("18:00") },
                        singleLine = true,
                        modifier = Modifier.weight(1f),
                    )
                }
                Text(
                    "24-hour time, e.g. 09:30 / 18:00. Fill only the punch you missed.",
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
