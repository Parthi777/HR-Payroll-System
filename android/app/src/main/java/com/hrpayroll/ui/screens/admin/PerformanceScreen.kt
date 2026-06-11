package com.hrpayroll.ui.screens.admin

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
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.material3.Card
import androidx.compose.material3.CardDefaults
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
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
import com.hrpayroll.data.remote.dto.PerformanceRowDto
import com.hrpayroll.ui.components.BrandHeader
import com.hrpayroll.ui.theme.StatusOff
import com.hrpayroll.ui.theme.StatusPresent

/** Employee performance / monitoring for the current month (GET /admin/reports/performance). */
@Composable
fun PerformanceScreen(viewModel: PerformanceViewModel = hiltViewModel()) {
    val state by viewModel.uiState.collectAsState()

    Box(modifier = Modifier.fillMaxSize().background(MaterialTheme.colorScheme.background)) {
        Column(modifier = Modifier.fillMaxSize()) {
            BrandHeader(title = "Performance")

            Row(
                modifier = Modifier.fillMaxWidth().padding(horizontal = 16.dp, vertical = 8.dp),
                verticalAlignment = Alignment.CenterVertically,
            ) {
                Text(
                    "This month · ${state.rows.size} employees",
                    fontSize = 13.sp,
                    color = MaterialTheme.colorScheme.onBackground.copy(alpha = 0.7f),
                )
                Spacer(Modifier.weight(1f))
                TextButton(onClick = viewModel::refresh) { Text(if (state.isLoading) "…" else "Refresh") }
            }

            if (state.rows.isEmpty()) {
                Text(
                    state.error ?: "No employees yet.",
                    fontSize = 13.sp,
                    color = MaterialTheme.colorScheme.onBackground.copy(alpha = 0.6f),
                    modifier = Modifier.padding(16.dp),
                )
            } else {
                LazyColumn(
                    modifier = Modifier.fillMaxSize().padding(horizontal = 16.dp),
                    verticalArrangement = Arrangement.spacedBy(10.dp),
                ) {
                    items(state.rows) { PerformanceCard(it) }
                }
            }
        }
    }
}

@Composable
private fun PerformanceCard(row: PerformanceRowDto) {
    Card(
        shape = MaterialTheme.shapes.medium,
        colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.surface),
        elevation = CardDefaults.cardElevation(defaultElevation = 2.dp),
    ) {
        Column(modifier = Modifier.fillMaxWidth().padding(14.dp)) {
            Row(verticalAlignment = Alignment.CenterVertically) {
                Column(modifier = Modifier.weight(1f)) {
                    Text(row.name ?: "—", fontWeight = FontWeight.SemiBold, color = MaterialTheme.colorScheme.onSurface)
                    Text(
                        "${row.employeeCode ?: ""} · ${row.branch ?: ""}",
                        fontSize = 12.sp,
                        color = MaterialTheme.colorScheme.onSurface.copy(alpha = 0.6f),
                    )
                }
                val rateColor = if (row.attendanceRate >= 80) StatusPresent else StatusOff
                Text("${row.attendanceRate}%", fontSize = 22.sp, fontWeight = FontWeight.Bold, color = rateColor)
            }
            Spacer(Modifier.height(10.dp))
            Row(horizontalArrangement = Arrangement.spacedBy(16.dp)) {
                Metric("Present", row.presentDays.toString())
                Metric("Late", row.lateDays.toString())
                Metric("Absent", row.absentDays.toString())
                Metric("Leave", row.leaveDays.toString())
                Metric("Avg hrs", row.avgHours.toString())
            }
            if (row.flaggedCount > 0) {
                Spacer(Modifier.height(8.dp))
                Text(
                    "⚠ ${row.flaggedCount} flagged check-in(s)",
                    fontSize = 12.sp,
                    color = StatusOff,
                    fontWeight = FontWeight.Medium,
                )
            }
        }
    }
}

@Composable
private fun Metric(label: String, value: String) {
    Column {
        Text(value, fontSize = 15.sp, fontWeight = FontWeight.Bold, color = MaterialTheme.colorScheme.onSurface)
        Text(label, fontSize = 10.sp, color = MaterialTheme.colorScheme.onSurface.copy(alpha = 0.6f))
    }
}
