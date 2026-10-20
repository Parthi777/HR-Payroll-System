package com.hrpayroll.ui.screens.admin

import androidx.compose.foundation.horizontalScroll
import com.hrpayroll.ui.components.ChoiceChip
import com.hrpayroll.ui.components.MonthDropdown
import com.hrpayroll.ui.theme.BrandGreen
import com.hrpayroll.ui.theme.MutedText
import com.hrpayroll.utils.days
import androidx.compose.material.icons.filled.Close
import androidx.compose.material.icons.filled.Search
import androidx.compose.ui.draw.clip
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
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

/** Employee performance for a chosen month (GET /admin/reports/performance): search, sort, tap for the month detail. */
@Composable
fun PerformanceScreen(
    onOpenEmployee: (employeeId: String, month: Int, year: Int) -> Unit = { _, _, _ -> },
    viewModel: PerformanceViewModel = hiltViewModel(),
) {
    val state by viewModel.uiState.collectAsState()
    val visible = state.visible

    Box(modifier = Modifier.fillMaxSize().background(MaterialTheme.colorScheme.background)) {
        Column(modifier = Modifier.fillMaxSize()) {
            BrandHeader(title = "Performance", subtitle = "Tap anyone to see their whole month") {
                Row(verticalAlignment = Alignment.CenterVertically) {
                    MonthDropdown(state.month, state.year, state.months, onSelect = viewModel::selectMonth)
                    Spacer(Modifier.weight(1f))
                    Text(
                        if (visible.size == state.rows.size) "${state.rows.size} employees" else "${visible.size} of ${state.rows.size}",
                        fontSize = 13.sp,
                        color = MutedText,
                        fontWeight = FontWeight.Medium,
                    )
                }
                Spacer(Modifier.height(12.dp))
                SearchField(state.query, viewModel::onQueryChange)
                Spacer(Modifier.height(10.dp))
                Row(
                    modifier = Modifier.horizontalScroll(androidx.compose.foundation.rememberScrollState()),
                    horizontalArrangement = Arrangement.spacedBy(8.dp),
                ) {
                    PerformanceSort.entries.forEach { sort ->
                        ChoiceChip(sort.label, selected = state.sort == sort) { viewModel.setSort(sort) }
                    }
                }
            }

            when {
                state.isLoading && state.rows.isEmpty() -> androidx.compose.material3.CircularProgressIndicator(
                    Modifier.padding(24.dp).align(Alignment.CenterHorizontally), color = BrandGreen,
                )
                state.rows.isEmpty() -> Text(
                    state.error ?: "No employees yet.",
                    fontSize = 13.sp,
                    color = MutedText,
                    modifier = Modifier.padding(16.dp),
                )
                visible.isEmpty() -> Text(
                    "No one matches “${state.query}”.",
                    fontSize = 13.sp,
                    color = MutedText,
                    modifier = Modifier.padding(16.dp),
                )
                else -> LazyColumn(
                    modifier = Modifier.fillMaxSize().padding(horizontal = 16.dp),
                    verticalArrangement = Arrangement.spacedBy(10.dp),
                    contentPadding = androidx.compose.foundation.layout.PaddingValues(bottom = 16.dp),
                ) {
                    items(visible, key = { it.employeeId ?: it.employeeCode ?: it.hashCode().toString() }) { row ->
                        PerformanceCard(row) { row.employeeId?.let { onOpenEmployee(it, state.month, state.year) } }
                    }
                }
            }
        }
    }
}

/** Search by name, code, branch or designation — filters as you type. */
@Composable
private fun SearchField(value: String, onChange: (String) -> Unit) {
    androidx.compose.material3.OutlinedTextField(
        value = value,
        onValueChange = onChange,
        placeholder = { Text("Search name, ID or branch", color = MutedText) },
        leadingIcon = { androidx.compose.material3.Icon(androidx.compose.material.icons.Icons.Filled.Search, contentDescription = null, tint = BrandGreen) },
        trailingIcon = if (value.isNotEmpty()) {
            {
                androidx.compose.material3.IconButton(onClick = { onChange("") }) {
                    androidx.compose.material3.Icon(androidx.compose.material.icons.Icons.Filled.Close, contentDescription = "Clear search", tint = MutedText)
                }
            }
        } else null,
        singleLine = true,
        shape = androidx.compose.foundation.shape.RoundedCornerShape(16.dp),
        colors = androidx.compose.material3.OutlinedTextFieldDefaults.colors(
            focusedBorderColor = BrandGreen,
            unfocusedBorderColor = com.hrpayroll.ui.theme.CardBorder,
            focusedContainerColor = Color.White,
            unfocusedContainerColor = Color.White,
            cursorColor = BrandGreen,
        ),
        modifier = Modifier.fillMaxWidth(),
    )
}

@Composable
private fun PerformanceCard(row: PerformanceRowDto, onClick: () -> Unit) {
    Card(
        onClick = onClick,
        shape = androidx.compose.foundation.shape.RoundedCornerShape(22.dp),
        colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.surface),
        border = androidx.compose.foundation.BorderStroke(1.dp, com.hrpayroll.ui.theme.CardBorder),
        elevation = CardDefaults.cardElevation(defaultElevation = 0.dp),
    ) {
        Column(modifier = Modifier.fillMaxWidth().padding(14.dp)) {
            Row(verticalAlignment = Alignment.CenterVertically) {
                val initials = (row.name ?: "?").split(" ").filter { it.isNotBlank() }.take(2).joinToString("") { it.first().uppercase() }
                androidx.compose.foundation.layout.Box(
                    Modifier.size(40.dp).clip(androidx.compose.foundation.shape.CircleShape).background(com.hrpayroll.ui.theme.BrandMint),
                    contentAlignment = Alignment.Center,
                ) { Text(initials, color = com.hrpayroll.ui.theme.BrandGreen, fontWeight = FontWeight.Bold, fontSize = 14.sp) }
                Spacer(Modifier.width(12.dp))
                Column(modifier = Modifier.weight(1f)) {
                    Text(row.name ?: "—", fontWeight = FontWeight.SemiBold, color = com.hrpayroll.ui.theme.Ink, fontSize = 15.sp)
                    Text(
                        listOfNotNull(row.employeeCode, row.designation, row.branch).joinToString(" · "),
                        fontSize = 12.sp,
                        color = MaterialTheme.colorScheme.onSurface.copy(alpha = 0.6f),
                    )
                }
                val rateColor = if (row.attendanceRate >= 80) StatusPresent else StatusOff
                Text("${row.attendanceRate}%", fontSize = 22.sp, fontWeight = FontWeight.Bold, color = rateColor)
            }
            Spacer(Modifier.height(10.dp))
            // The rate as a bar, so a list of people reads at a glance.
            androidx.compose.material3.LinearProgressIndicator(
                progress = { (row.attendanceRate / 100f).coerceIn(0f, 1f) },
                modifier = Modifier.fillMaxWidth().height(6.dp).clip(androidx.compose.foundation.shape.RoundedCornerShape(50)),
                color = if (row.attendanceRate >= 80) com.hrpayroll.ui.theme.BrandGreen else StatusOff,
                trackColor = com.hrpayroll.ui.theme.BrandMint,
                drawStopIndicator = {},
            )
            Spacer(Modifier.height(12.dp))
            Row(
                modifier = Modifier.fillMaxWidth().clip(androidx.compose.foundation.shape.RoundedCornerShape(14.dp)).background(com.hrpayroll.ui.theme.BrandSurface).padding(horizontal = 12.dp, vertical = 8.dp),
                horizontalArrangement = Arrangement.SpaceBetween,
            ) {
                Metric("Present", days(row.presentDays))
                Metric("Late", row.lateDays.toString())
                Metric("Absent", days(row.absentDays))
                Metric("Leave", days(row.leaveDays))
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
        Text(value, fontSize = 15.sp, fontWeight = FontWeight.Bold, color = com.hrpayroll.ui.theme.Ink)
        Text(label, fontSize = 10.sp, color = com.hrpayroll.ui.theme.MutedText)
    }
}
