package com.hrpayroll.ui.screens.leave

import androidx.compose.foundation.border
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.automirrored.filled.Send
import androidx.compose.material.icons.outlined.BeachAccess
import androidx.compose.material.icons.outlined.CalendarMonth
import androidx.compose.material.icons.outlined.HourglassTop
import androidx.compose.ui.graphics.vector.ImageVector
import com.hrpayroll.ui.components.ChoiceChip
import com.hrpayroll.ui.components.GradientButton
import com.hrpayroll.ui.components.IconBubble
import com.hrpayroll.ui.components.SectionCard
import com.hrpayroll.ui.components.SectionTitle
import com.hrpayroll.ui.theme.BrandGreen
import com.hrpayroll.ui.theme.BrandSurface
import com.hrpayroll.ui.theme.CardBorder
import com.hrpayroll.ui.theme.Ink
import com.hrpayroll.ui.theme.MutedText
import com.hrpayroll.ui.theme.StatusLeave
import androidx.compose.ui.draw.clip
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
import androidx.compose.foundation.layout.offset
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.CalendarMonth
import androidx.compose.material3.Button
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.Card
import androidx.compose.material3.CardDefaults
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Text
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
import com.hrpayroll.ui.components.BrandHeader
import com.hrpayroll.ui.components.StatusChip
import com.hrpayroll.ui.theme.StatusHalf
import com.hrpayroll.ui.theme.StatusHalfBg
import com.hrpayroll.ui.theme.StatusOff
import com.hrpayroll.ui.theme.StatusOffBg
import com.hrpayroll.ui.theme.StatusPresent
import com.hrpayroll.ui.theme.StatusPresentBg

// Company policy: Casual Leave only (no SL/EL), plus LOP and half day.
private val LEAVE_TYPES = listOf(
    "CL" to "Casual Leave",
    "LOP" to "Loss of Pay",
    "HALF_DAY" to "Half Day",
)

/** Leave: balance + apply (POST /leaves/apply) + my-leaves list — wired to backend. */
@Composable
fun LeaveScreen(viewModel: LeaveViewModel = hiltViewModel()) {
    val state by viewModel.uiState.collectAsState()
    var leaveType by remember { mutableStateOf("CL") }
    var fromDate by remember { mutableStateOf("") }
    var toDate by remember { mutableStateOf("") }
    var reason by remember { mutableStateOf("") }
    var pickerFor by remember { mutableStateOf<String?>(null) } // "from" | "to"

    // Days auto-computed from the selected range (0.5 for half day).
    val days: Double = remember(leaveType, fromDate, toDate) {
        if (leaveType == "HALF_DAY") 0.5
        else runCatching {
            val f = java.time.LocalDate.parse(fromDate)
            val t = java.time.LocalDate.parse(toDate)
            (java.time.temporal.ChronoUnit.DAYS.between(f, t) + 1).coerceAtLeast(1).toDouble()
        }.getOrDefault(1.0)
    }

    fun balance(type: String): String {
        val b = state.balances.firstOrNull { it.type == type } ?: return "—"
        val remaining = (b.total ?: 0.0) - (b.used ?: 0.0)
        return remaining.toInt().toString()
    }

    Box(modifier = Modifier.fillMaxSize().background(MaterialTheme.colorScheme.background)) {
        Column(modifier = Modifier.fillMaxSize().verticalScroll(rememberScrollState())) {
            BrandHeader(title = "Leave", subtitle = "Plan time off and follow your requests")

            // Balance: casual leave is the only paid leave with a quota.
            Row(
                modifier = Modifier.fillMaxWidth().padding(horizontal = 16.dp),
                horizontalArrangement = Arrangement.spacedBy(12.dp),
            ) {
                BalanceCard("Casual leave left", balance("CL"), Icons.Outlined.BeachAccess, StatusLeave, Modifier.weight(1f))
                BalanceCard(
                    "Pending requests",
                    state.myLeaves.count { it.status == "PENDING" }.toString(),
                    Icons.Outlined.HourglassTop,
                    StatusHalf,
                    Modifier.weight(1f),
                )
            }

            Spacer(Modifier.height(16.dp))
            SectionCard(modifier = Modifier.padding(horizontal = 16.dp), floating = true) {
                Text("Request leave", fontSize = 17.sp, fontWeight = FontWeight.Bold, color = Ink)
                Spacer(Modifier.height(14.dp))

                FieldLabel("Type")
                Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                    LEAVE_TYPES.forEach { (code, name) ->
                        ChoiceChip(text = name, selected = leaveType == code, modifier = Modifier.weight(1f)) { leaveType = code }
                    }
                }
                Spacer(Modifier.height(16.dp))

                Row(horizontalArrangement = Arrangement.spacedBy(12.dp)) {
                    DateTile("From", fromDate, Modifier.weight(1f)) { pickerFor = "from" }
                    DateTile("To", toDate, Modifier.weight(1f)) { pickerFor = "to" }
                }
                Spacer(Modifier.height(16.dp))

                FieldLabel("Reason")
                OutlinedTextField(
                    value = reason,
                    onValueChange = { reason = it },
                    placeholder = { Text("A line for your manager…", color = MutedText) },
                    modifier = Modifier.fillMaxWidth().height(96.dp),
                    shape = RoundedCornerShape(16.dp),
                )
                Spacer(Modifier.height(18.dp))

                GradientButton(
                    text = "Send request · ${if (days == 0.5) "half day" else "${days.toInt()} day${if (days.toInt() == 1) "" else "s"}"}",
                    loading = state.isSubmitting,
                    icon = Icons.AutoMirrored.Filled.Send,
                    onClick = { viewModel.apply(leaveType, fromDate, toDate, days, reason) },
                )

                state.message?.let { Spacer(Modifier.height(10.dp)); Text(it, color = StatusPresent, fontWeight = FontWeight.SemiBold, fontSize = 13.sp) }
                state.error?.let { Spacer(Modifier.height(10.dp)); Text(it, color = MaterialTheme.colorScheme.error, fontWeight = FontWeight.Medium, fontSize = 13.sp) }
            }

            SectionTitle("My requests", modifier = Modifier.padding(start = 20.dp, end = 20.dp, top = 24.dp, bottom = 10.dp))
            Column(modifier = Modifier.padding(horizontal = 16.dp), verticalArrangement = Arrangement.spacedBy(10.dp)) {
                if (state.isLoading) {
                    CircularProgressIndicator(Modifier.padding(8.dp), color = BrandGreen)
                } else if (state.myLeaves.isEmpty()) {
                    Text("No leave requests yet.", fontSize = 13.sp, color = MutedText)
                } else {
                    state.myLeaves.forEach { lv -> LeaveRow(lv) }
                }
            }
            Spacer(Modifier.height(24.dp))
        }
    }

    // Material date picker for From / To.
    pickerFor?.let { which ->
        LeaveDatePicker(
            onPicked = { iso ->
                if (which == "from") {
                    fromDate = iso
                    if (toDate.isBlank()) toDate = iso
                } else {
                    toDate = iso
                }
                pickerFor = null
            },
            onDismiss = { pickerFor = null },
        )
    }
}

@OptIn(androidx.compose.material3.ExperimentalMaterial3Api::class)
@Composable
private fun LeaveDatePicker(onPicked: (String) -> Unit, onDismiss: () -> Unit) {
    val pickerState = androidx.compose.material3.rememberDatePickerState()
    androidx.compose.material3.DatePickerDialog(
        onDismissRequest = onDismiss,
        confirmButton = {
            androidx.compose.material3.TextButton(onClick = {
                pickerState.selectedDateMillis?.let { ms ->
                    // DatePicker millis are UTC-midnight based — format in UTC.
                    onPicked(java.time.Instant.ofEpochMilli(ms).atZone(java.time.ZoneOffset.UTC).toLocalDate().toString())
                } ?: onDismiss()
            }) { Text("OK") }
        },
        dismissButton = { androidx.compose.material3.TextButton(onClick = onDismiss) { Text("Cancel") } },
    ) {
        androidx.compose.material3.DatePicker(state = pickerState)
    }
}

@Composable
private fun FieldLabel(text: String) {
    Text(text, fontSize = 12.sp, fontWeight = FontWeight.SemiBold, color = MutedText, modifier = Modifier.padding(bottom = 6.dp))
}

@Composable
private fun BalanceCard(label: String, value: String, icon: ImageVector, tint: Color, modifier: Modifier) {
    SectionCard(modifier = modifier) {
        Row(verticalAlignment = Alignment.CenterVertically) {
            IconBubble(icon, tint, size = 42.dp)
            Spacer(Modifier.width(12.dp))
            Column {
                Text(value, fontSize = 22.sp, fontWeight = FontWeight.Bold, color = Ink)
                Text(label, fontSize = 12.sp, color = MutedText, maxLines = 1)
            }
        }
    }
}

/** A date to tap: the label above, the picked day (or a prompt) below, a calendar icon. */
@Composable
private fun DateTile(label: String, iso: String, modifier: Modifier, onClick: () -> Unit) {
    val shown = runCatching {
        java.time.LocalDate.parse(iso).format(java.time.format.DateTimeFormatter.ofPattern("EEE, d MMM"))
    }.getOrNull()
    Row(
        modifier = modifier
            .clip(RoundedCornerShape(16.dp))
            .background(BrandSurface)
            .border(1.dp, CardBorder, RoundedCornerShape(16.dp))
            .clickable(onClick = onClick)
            .padding(12.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        IconBubble(Icons.Outlined.CalendarMonth, BrandGreen, size = 34.dp)
        Spacer(Modifier.width(10.dp))
        Column {
            Text(label, fontSize = 11.sp, color = MutedText)
            Text(shown ?: "Pick a day", fontSize = 14.sp, fontWeight = FontWeight.SemiBold, color = if (shown != null) Ink else MutedText)
        }
    }
}

@Composable
private fun LeaveRow(lv: com.hrpayroll.data.remote.dto.LeaveDto) {
    val (fg, bg) = when (lv.status) {
        "APPROVED" -> StatusPresent to StatusPresentBg
        "REJECTED" -> StatusOff to StatusOffBg
        else -> StatusHalf to StatusHalfBg
    }
    val name = LEAVE_TYPES.firstOrNull { it.first == lv.type }?.second ?: when (lv.type) {
        "SL" -> "Sick Leave"
        "EL" -> "Earned Leave"
        else -> lv.type ?: "Leave"
    }
    fun day(iso: String?) = runCatching {
        java.time.LocalDate.parse(iso?.take(10)).format(java.time.format.DateTimeFormatter.ofPattern("d MMM"))
    }.getOrNull()
    val from = day(lv.fromDate)
    val to = day(lv.toDate)
    val range = when {
        from == null -> ""
        to == null || to == from -> from
        else -> "$from – $to"
    }
    val d = lv.days ?: 1.0
    SectionCard {
        Row(verticalAlignment = Alignment.CenterVertically) {
            IconBubble(Icons.Outlined.BeachAccess, StatusLeave, size = 42.dp)
            Spacer(Modifier.width(12.dp))
            Column(Modifier.weight(1f)) {
                Text(name, fontWeight = FontWeight.SemiBold, color = Ink, fontSize = 15.sp)
                Text(
                    listOf(range, if (d == 0.5) "half day" else "${d.toInt()} day${if (d.toInt() == 1) "" else "s"}").filter { it.isNotBlank() }.joinToString(" · "),
                    fontSize = 12.sp,
                    color = MutedText,
                )
                if (!lv.reason.isNullOrBlank()) Text(lv.reason, fontSize = 12.sp, color = MutedText.copy(alpha = 0.8f), maxLines = 1)
            }
            StatusChip((lv.status ?: "PENDING").lowercase().replaceFirstChar { it.uppercase() }, fg, bg)
        }
    }
}
