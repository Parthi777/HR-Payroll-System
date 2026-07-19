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
import androidx.compose.material.icons.filled.Logout
import androidx.compose.material3.Button
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.Card
import androidx.compose.material3.CardDefaults
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
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

            Text(
                "One check-in and one check-out per day",
                modifier = Modifier.fillMaxWidth().padding(vertical = 8.dp),
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
