package com.hrpayroll.ui.screens.leave

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
            BrandHeader(title = "Leave")

            Card(
                modifier = Modifier.fillMaxWidth().offset(y = (-24).dp).padding(horizontal = 16.dp),
                shape = MaterialTheme.shapes.large,
                colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.surface),
                elevation = CardDefaults.cardElevation(defaultElevation = 6.dp),
            ) {
                Column(modifier = Modifier.padding(18.dp)) {
                    BalancePill("Casual Leave remaining", balance("CL"), Modifier.fillMaxWidth())
                    Spacer(Modifier.height(20.dp))

                    Text("Apply for Leave", fontSize = 16.sp, fontWeight = FontWeight.Bold, color = MaterialTheme.colorScheme.onSurface)
                    Spacer(Modifier.height(14.dp))

                    LeaveTypeDropdown(selected = leaveType, onSelect = { leaveType = it })
                    Spacer(Modifier.height(12.dp))

                    Row(horizontalArrangement = Arrangement.spacedBy(12.dp)) {
                        Column(Modifier.weight(1f)) {
                            FieldLabel("From")
                            DateField(value = fromDate, onClick = { pickerFor = "from" })
                        }
                        Column(Modifier.weight(1f)) {
                            FieldLabel("To")
                            DateField(value = toDate, onClick = { pickerFor = "to" })
                        }
                    }
                    Spacer(Modifier.height(12.dp))

                    FieldLabel("Reason")
                    OutlinedTextField(value = reason, onValueChange = { reason = it }, placeholder = { Text("Enter reason…") }, modifier = Modifier.fillMaxWidth().height(90.dp), shape = MaterialTheme.shapes.small)
                    Spacer(Modifier.height(16.dp))

                    Button(
                        onClick = { viewModel.apply(leaveType, fromDate, toDate, days, reason) },
                        enabled = !state.isSubmitting,
                        modifier = Modifier.fillMaxWidth().height(52.dp),
                        shape = MaterialTheme.shapes.medium,
                        colors = ButtonDefaults.buttonColors(containerColor = MaterialTheme.colorScheme.primary),
                    ) {
                        if (state.isSubmitting) CircularProgressIndicator(Modifier.height(22.dp), color = Color.White, strokeWidth = 2.dp)
                        else Text(
                            "Submit  ·  ${if (days == 0.5) "Half day" else "${days.toInt()} day(s)"}",
                            color = Color.White,
                            fontWeight = FontWeight.SemiBold,
                        )
                    }

                    state.message?.let { Spacer(Modifier.height(10.dp)); Text(it, color = StatusPresent, fontWeight = FontWeight.SemiBold) }
                    state.error?.let { Spacer(Modifier.height(10.dp)); Text(it, color = MaterialTheme.colorScheme.error, fontWeight = FontWeight.Medium) }
                }
            }

            Column(modifier = Modifier.padding(horizontal = 16.dp)) {
                Text("My Leaves", fontSize = 16.sp, fontWeight = FontWeight.Bold, color = MaterialTheme.colorScheme.onBackground)
                Spacer(Modifier.height(10.dp))
                if (state.isLoading) {
                    CircularProgressIndicator(Modifier.padding(8.dp))
                } else if (state.myLeaves.isEmpty()) {
                    Text("No leave requests yet.", fontSize = 13.sp, color = MaterialTheme.colorScheme.onBackground.copy(alpha = 0.6f))
                } else {
                    state.myLeaves.forEach { lv ->
                        val (fg, bg) = when (lv.status) {
                            "APPROVED" -> StatusPresent to StatusPresentBg
                            "REJECTED" -> StatusOff to StatusOffBg
                            else -> StatusHalf to StatusHalfBg
                        }
                        Card(
                            modifier = Modifier.fillMaxWidth().padding(bottom = 10.dp),
                            shape = MaterialTheme.shapes.medium,
                            colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.surface),
                            elevation = CardDefaults.cardElevation(defaultElevation = 2.dp),
                        ) {
                            Row(modifier = Modifier.fillMaxWidth().padding(14.dp), verticalAlignment = Alignment.CenterVertically) {
                                Column(Modifier.weight(1f)) {
                                    Text("${lv.type} · ${lv.days?.toInt() ?: 1} day(s)", fontWeight = FontWeight.SemiBold, color = MaterialTheme.colorScheme.onSurface)
                                    Text(lv.reason ?: "", fontSize = 12.sp, color = MaterialTheme.colorScheme.onSurface.copy(alpha = 0.6f))
                                }
                                StatusChip(lv.status ?: "PENDING", fg, bg)
                            }
                        }
                    }
                }
                Spacer(Modifier.height(20.dp))
            }
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

/** Leave type dropdown with full names (matches the reference "Selected Leave Type"). */
@OptIn(androidx.compose.material3.ExperimentalMaterial3Api::class)
@Composable
private fun LeaveTypeDropdown(selected: String, onSelect: (String) -> Unit) {
    var expanded by remember { mutableStateOf(false) }
    val selectedLabel = LEAVE_TYPES.firstOrNull { it.first == selected }?.second ?: selected
    androidx.compose.material3.ExposedDropdownMenuBox(expanded = expanded, onExpandedChange = { expanded = it }) {
        OutlinedTextField(
            value = "$selectedLabel ($selected)",
            onValueChange = {},
            readOnly = true,
            label = { Text("Leave type") },
            trailingIcon = { androidx.compose.material3.ExposedDropdownMenuDefaults.TrailingIcon(expanded = expanded) },
            shape = MaterialTheme.shapes.small,
            modifier = Modifier.fillMaxWidth().menuAnchor(),
        )
        ExposedDropdownMenu(expanded = expanded, onDismissRequest = { expanded = false }) {
            LEAVE_TYPES.forEach { (code, name) ->
                androidx.compose.material3.DropdownMenuItem(
                    text = { Text("$name ($code)") },
                    onClick = {
                        onSelect(code)
                        expanded = false
                    },
                )
            }
        }
    }
}

/** Read-only date field that opens the Material date picker on tap. */
@Composable
private fun DateField(value: String, onClick: () -> Unit) {
    Box {
        OutlinedTextField(
            value = value,
            onValueChange = {},
            readOnly = true,
            placeholder = { Text("Select date") },
            trailingIcon = { androidx.compose.material3.Icon(Icons.Filled.CalendarMonth, "Pick date") },
            singleLine = true,
            shape = MaterialTheme.shapes.small,
            modifier = Modifier.fillMaxWidth(),
        )
        // Transparent overlay so the whole field is tappable (readOnly fields swallow clicks).
        Box(Modifier.matchParentSize().clickable(onClick = onClick))
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
    Text(text, fontSize = 12.sp, fontWeight = FontWeight.Medium, color = MaterialTheme.colorScheme.onSurface.copy(alpha = 0.7f), modifier = Modifier.padding(bottom = 4.dp))
}

@Composable
private fun BalancePill(label: String, value: String, modifier: Modifier = Modifier) {
    Column(
        modifier = modifier.background(MaterialTheme.colorScheme.primaryContainer, MaterialTheme.shapes.small).padding(vertical = 12.dp),
        horizontalAlignment = Alignment.CenterHorizontally,
    ) {
        Text(value, fontSize = 20.sp, fontWeight = FontWeight.Bold, color = MaterialTheme.colorScheme.primary)
        Text(label, fontSize = 11.sp, color = MaterialTheme.colorScheme.onSurface.copy(alpha = 0.7f))
    }
}
