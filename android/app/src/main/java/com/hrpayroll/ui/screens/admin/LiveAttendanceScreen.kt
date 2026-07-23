package com.hrpayroll.ui.screens.admin

import androidx.compose.foundation.background
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
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.CalendarMonth
import androidx.compose.material.icons.filled.ChevronLeft
import androidx.compose.material.icons.filled.ChevronRight
import androidx.compose.material3.Card
import androidx.compose.material3.CardDefaults
import androidx.compose.material3.DatePicker
import androidx.compose.material3.DatePickerDialog
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.FilterChip
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.material3.rememberDatePickerState
import androidx.compose.runtime.Composable
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.hilt.navigation.compose.hiltViewModel
import com.hrpayroll.data.remote.dto.DailyRowDto
import com.hrpayroll.data.remote.dto.MonthDayDto
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
import java.time.LocalDate

private val MONTHS = arrayOf("", "January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December")

/** Attendance monitor with date filter (Today/Yesterday/pick) + month calendar of late/absent. */
@Composable
fun LiveAttendanceScreen(viewModel: LiveAttendanceViewModel = hiltViewModel()) {
    val state by viewModel.uiState.collectAsState()
    val today = LocalDate.now()
    var showPicker by remember { mutableStateOf(false) }

    Box(modifier = Modifier.fillMaxSize().background(MaterialTheme.colorScheme.background)) {
        Column(modifier = Modifier.fillMaxSize()) {
            BrandHeader(title = "Attendance")

            // Quick date filters
            Row(
                modifier = Modifier.fillMaxWidth().padding(horizontal = 16.dp, vertical = 8.dp),
                horizontalArrangement = Arrangement.spacedBy(8.dp),
                verticalAlignment = Alignment.CenterVertically,
            ) {
                FilterChip(selected = state.date == today, onClick = viewModel::today, label = { Text("Today") })
                FilterChip(selected = state.date == today.minusDays(1), onClick = viewModel::yesterday, label = { Text("Yesterday") })
                FilterChip(
                    selected = state.date != today && state.date != today.minusDays(1),
                    onClick = { showPicker = true },
                    label = { Text("Pick date") },
                    leadingIcon = { Icon(Icons.Filled.CalendarMonth, contentDescription = null, modifier = Modifier.size(16.dp)) },
                )
                Spacer(Modifier.weight(1f))
                IconButton(onClick = viewModel::toggleCalendar) {
                    Icon(Icons.Filled.CalendarMonth, contentDescription = "Month calendar",
                        tint = if (state.showCalendar) MaterialTheme.colorScheme.primary else MaterialTheme.colorScheme.onBackground.copy(alpha = 0.6f))
                }
            }

            LazyColumn(
                modifier = Modifier.fillMaxSize().padding(horizontal = 16.dp),
                verticalArrangement = Arrangement.spacedBy(10.dp),
            ) {
                // Month calendar (late / absent) — collapsible.
                if (state.showCalendar) {
                    item {
                        MonthCalendar(
                            month = state.calMonth, year = state.calYear,
                            days = state.monthSummary?.days ?: emptyList(),
                            selectedDay = if (state.date.monthValue == state.calMonth && state.date.year == state.calYear) state.date.dayOfMonth else -1,
                            onShift = viewModel::shiftCalMonth,
                            onPick = viewModel::pickCalendarDay,
                        )
                    }
                }

                // Selected-date header + summary
                item {
                    Row(verticalAlignment = Alignment.CenterVertically, modifier = Modifier.padding(top = 4.dp)) {
                        val label = when (state.date) {
                            today -> "Today"
                            today.minusDays(1) -> "Yesterday"
                            else -> "${state.date.dayOfMonth} ${MONTHS[state.date.monthValue]}"
                        }
                        Text(label, fontWeight = FontWeight.Bold, fontSize = 15.sp, color = MaterialTheme.colorScheme.onBackground)
                        Spacer(Modifier.weight(1f))
                        state.summary?.let {
                            Text("P ${it.present} · L ${it.late} · A ${it.absent}", fontSize = 12.sp,
                                color = MaterialTheme.colorScheme.onBackground.copy(alpha = 0.65f))
                        }
                        TextButton(onClick = viewModel::refresh) { Text(if (state.isLoading) "…" else "Refresh") }
                    }
                }

                if (state.rows.isEmpty()) {
                    item {
                        Text(state.error ?: "No attendance for this date.", fontSize = 13.sp,
                            color = MaterialTheme.colorScheme.onBackground.copy(alpha = 0.6f), modifier = Modifier.padding(8.dp))
                    }
                } else {
                    items(state.rows) { DailyRow(it) }
                }
                item { Spacer(Modifier.height(16.dp)) }
            }
        }
    }

    if (showPicker) {
        DatePicker0(
            initial = state.date,
            onPicked = { viewModel.loadDate(it); showPicker = false },
            onDismiss = { showPicker = false },
        )
    }
}

@Composable
private fun DailyRow(row: DailyRowDto) {
    Card(
        shape = MaterialTheme.shapes.medium,
        colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.surface),
        elevation = CardDefaults.cardElevation(defaultElevation = 2.dp),
    ) {
        Row(modifier = Modifier.fillMaxWidth().padding(14.dp), verticalAlignment = Alignment.CenterVertically) {
            Column(modifier = Modifier.weight(1f)) {
                Text(row.name ?: "—", fontWeight = FontWeight.SemiBold, color = MaterialTheme.colorScheme.onSurface)
                Text("${row.employeeCode ?: ""}  ·  ${row.branch ?: ""}", fontSize = 12.sp,
                    color = MaterialTheme.colorScheme.onSurface.copy(alpha = 0.6f))
                Spacer(Modifier.height(4.dp))
                Text("In ${row.checkIn ?: "—"}   ·   Out ${row.checkOut ?: "—"}", fontSize = 12.sp,
                    color = MaterialTheme.colorScheme.onSurface.copy(alpha = 0.75f))
            }
            val (fg, bg) = statusColors(row.status)
            StatusChip(row.status?.replace("_", " ") ?: "—", fg, bg)
        }
    }
}

private fun statusColors(status: String?): Pair<Color, Color> = when {
    status == null -> StatusLeave to StatusLeaveBg
    status.startsWith("PRESENT") -> StatusPresent to StatusPresentBg
    status.startsWith("LATE") -> StatusHalf to StatusHalfBg
    status.startsWith("ABSENT") -> StatusOff to StatusOffBg
    status.contains("approval") -> StatusHalf to StatusHalfBg
    else -> StatusLeave to StatusLeaveBg
}

/** Month grid — each day tinted by attendance health (red = absentees, amber = lates, green = clean). */
@Composable
private fun MonthCalendar(
    month: Int, year: Int, days: List<MonthDayDto>, selectedDay: Int,
    onShift: (Int) -> Unit, onPick: (Int) -> Unit,
) {
    Card(
        shape = MaterialTheme.shapes.medium,
        colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.surface),
        elevation = CardDefaults.cardElevation(defaultElevation = 2.dp),
    ) {
        Column(Modifier.padding(12.dp)) {
            Row(verticalAlignment = Alignment.CenterVertically) {
                IconButton(onClick = { onShift(-1) }) { Icon(Icons.Filled.ChevronLeft, contentDescription = "Previous month") }
                Text("${MONTHS.getOrElse(month) { "" }} $year", fontWeight = FontWeight.Bold, fontSize = 14.sp,
                    modifier = Modifier.weight(1f), textAlign = TextAlign.Center)
                IconButton(onClick = { onShift(1) }) { Icon(Icons.Filled.ChevronRight, contentDescription = "Next month") }
            }
            Row(Modifier.fillMaxWidth()) {
                listOf("S", "M", "T", "W", "T", "F", "S").forEach {
                    Text(it, Modifier.weight(1f), textAlign = TextAlign.Center, fontSize = 11.sp,
                        color = MaterialTheme.colorScheme.onSurface.copy(alpha = 0.5f))
                }
            }
            Spacer(Modifier.height(4.dp))
            if (days.isEmpty()) {
                androidx.compose.material3.CircularProgressIndicator(Modifier.padding(16.dp).size(20.dp), strokeWidth = 2.dp)
            } else {
                val firstWeekday = days.first().weekday
                val cells: List<MonthDayDto?> = List(firstWeekday) { null } + days
                cells.chunked(7).forEach { week ->
                    Row(Modifier.fillMaxWidth().padding(vertical = 2.dp)) {
                        week.forEach { d ->
                            Box(Modifier.weight(1f).padding(2.dp), contentAlignment = Alignment.Center) {
                                if (d != null) {
                                    val (fg, bg) = dayColors(d)
                                    Box(
                                        Modifier.size(34.dp).clip(CircleShape).background(bg)
                                            .clickable { onPick(d.day) },
                                        contentAlignment = Alignment.Center,
                                    ) {
                                        Text("${d.day}", fontSize = 12.sp,
                                            fontWeight = if (d.day == selectedDay) FontWeight.Bold else FontWeight.SemiBold, color = fg)
                                    }
                                }
                            }
                        }
                        repeat(7 - week.size) { Box(Modifier.weight(1f)) }
                    }
                }
                Spacer(Modifier.height(6.dp))
                Row(horizontalArrangement = Arrangement.spacedBy(12.dp)) {
                    LegendDot(Color(0xFFE11D48), "Absentees")
                    LegendDot(Color(0xFFB45309), "Lates")
                    LegendDot(Color(0xFF16A34A), "All present")
                }
            }
        }
    }
}

private fun dayColors(d: MonthDayDto): Pair<Color, Color> = when {
    d.future -> Color(0xFFB6B6C3) to Color(0xFFF7F7FA)
    d.absent > 0 -> Color(0xFFE11D48) to Color(0xFFFFE4E6)
    d.late > 0 -> Color(0xFFB45309) to Color(0xFFFEF3C7)
    d.present > 0 -> Color(0xFF16A34A) to Color(0xFFDCFCE7)
    else -> Color(0xFF64748B) to Color(0xFFF1F5F9) // off / no data
}

@Composable
private fun LegendDot(color: Color, label: String) {
    Row(verticalAlignment = Alignment.CenterVertically) {
        Box(Modifier.size(8.dp).clip(CircleShape).background(color))
        Text("  $label", fontSize = 11.sp, color = MaterialTheme.colorScheme.onSurface.copy(alpha = 0.7f))
    }
}

@OptIn(ExperimentalMaterial3Api::class)
@Composable
private fun DatePicker0(initial: LocalDate, onPicked: (LocalDate) -> Unit, onDismiss: () -> Unit) {
    val startMillis = initial.atStartOfDay(java.time.ZoneOffset.UTC).toInstant().toEpochMilli()
    val pickerState = rememberDatePickerState(initialSelectedDateMillis = startMillis)
    DatePickerDialog(
        onDismissRequest = onDismiss,
        confirmButton = {
            TextButton(onClick = {
                pickerState.selectedDateMillis?.let { ms ->
                    onPicked(java.time.Instant.ofEpochMilli(ms).atZone(java.time.ZoneOffset.UTC).toLocalDate())
                } ?: onDismiss()
            }) { Text("OK") }
        },
        dismissButton = { TextButton(onClick = onDismiss) { Text("Cancel") } },
    ) { DatePicker(state = pickerState) }
}
