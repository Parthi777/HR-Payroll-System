package com.hrpayroll.ui.screens.shift

import androidx.compose.foundation.background
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
import androidx.compose.material.icons.automirrored.filled.Login
import androidx.compose.material.icons.filled.Coffee
import androidx.compose.material3.Card
import androidx.compose.material3.CardDefaults
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.hilt.navigation.compose.hiltViewModel
import com.hrpayroll.data.remote.dto.ScheduleDayDto
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.hrpayroll.ui.components.BrandHeader
import com.hrpayroll.ui.components.StatusChip
import com.hrpayroll.ui.theme.BrandGradient
import com.hrpayroll.ui.theme.StatusPresent
import com.hrpayroll.ui.theme.StatusPresentBg

/** Shift monitor: live timer, break tracker + 7-day schedule (GET /shifts/my-schedule). */
@Composable
fun ShiftScreen(viewModel: ShiftViewModel = hiltViewModel()) {
    val state by viewModel.uiState.collectAsState()
    Box(modifier = Modifier.fillMaxSize().background(MaterialTheme.colorScheme.background)) {
        Column(modifier = Modifier.fillMaxSize().verticalScroll(rememberScrollState())) {
            BrandHeader(title = "Shift Monitor")

            // Live timer card floating over the header.
            Card(
                modifier = Modifier
                    .fillMaxWidth()
                    .offset(y = (-24).dp)
                    .padding(horizontal = 16.dp),
                shape = MaterialTheme.shapes.large,
                colors = CardDefaults.cardColors(containerColor = Color.Transparent),
                elevation = CardDefaults.cardElevation(defaultElevation = 0.dp),
            ) {
                Box(
                    modifier = Modifier
                        .fillMaxWidth()
                        .background(BrandGradient, MaterialTheme.shapes.large)
                        .padding(20.dp),
                ) {
                    Column {
                        Row(verticalAlignment = Alignment.CenterVertically) {
                            Text("Today · General Shift", color = Color.White.copy(alpha = 0.85f), fontSize = 13.sp)
                            Spacer(Modifier.weight(1f))
                            StatusChip("On Duty", StatusPresent, StatusPresentBg)
                        }
                        Spacer(Modifier.height(10.dp))
                        Text("09 : 12 : 47", color = Color.White, fontSize = 38.sp, fontWeight = FontWeight.Bold)
                        Text("Hours worked so far", color = Color.White.copy(alpha = 0.8f), fontSize = 12.sp)
                        Spacer(Modifier.height(14.dp))
                        Row(horizontalArrangement = Arrangement.spacedBy(12.dp)) {
                            TimePill("Start", "09:00 AM")
                            TimePill("End", "06:00 PM")
                            TimePill("Overtime", "+12m")
                        }
                    }
                }
            }

            Column(modifier = Modifier.padding(horizontal = 16.dp)) {
                OutlinedButton(
                    onClick = { /* TODO: mark break start/end */ },
                    modifier = Modifier.fillMaxWidth().height(50.dp),
                    shape = MaterialTheme.shapes.medium,
                ) {
                    Icon(Icons.Filled.Coffee, contentDescription = null)
                    Text("   Start Break")
                }

                Spacer(Modifier.height(20.dp))
                Text(
                    "Upcoming Schedule",
                    fontSize = 16.sp,
                    fontWeight = FontWeight.Bold,
                    color = MaterialTheme.colorScheme.onBackground,
                )
                Spacer(Modifier.height(10.dp))
                if (state.schedule.isEmpty()) {
                    Text(
                        state.error ?: "No schedule available.",
                        fontSize = 13.sp,
                        color = MaterialTheme.colorScheme.onBackground.copy(alpha = 0.6f),
                    )
                } else {
                    state.schedule.forEach { ScheduleRow(it); Spacer(Modifier.height(10.dp)) }
                }
                Spacer(Modifier.height(24.dp))
            }
        }
    }
}

@Composable
private fun TimePill(label: String, value: String) {
    Column(
        modifier = Modifier
            .background(Color.White.copy(alpha = 0.15f), MaterialTheme.shapes.small)
            .padding(horizontal = 12.dp, vertical = 8.dp),
    ) {
        Text(label, color = Color.White.copy(alpha = 0.75f), fontSize = 10.sp)
        Text(value, color = Color.White, fontSize = 13.sp, fontWeight = FontWeight.SemiBold)
    }
}

@Composable
private fun ScheduleRow(day: ScheduleDayDto) {
    val detail = if (day.isOff == true) "Weekly Off"
    else "${day.shiftName ?: "Shift"} · ${day.startTime ?: ""}–${day.endTime ?: ""}"
    Card(
        shape = MaterialTheme.shapes.medium,
        colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.surface),
        elevation = CardDefaults.cardElevation(defaultElevation = 2.dp),
    ) {
        Row(
            modifier = Modifier.fillMaxWidth().padding(14.dp),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            Icon(Icons.AutoMirrored.Filled.Login, contentDescription = null, tint = MaterialTheme.colorScheme.primary)
            Column(modifier = Modifier.padding(start = 12.dp).weight(1f)) {
                Text(day.date ?: "", fontWeight = FontWeight.SemiBold, color = MaterialTheme.colorScheme.onSurface)
                Text(
                    detail,
                    fontSize = 12.sp,
                    color = MaterialTheme.colorScheme.onSurface.copy(alpha = 0.6f),
                )
            }
        }
    }
}
