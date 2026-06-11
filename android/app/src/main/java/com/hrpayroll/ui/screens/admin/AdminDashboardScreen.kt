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
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
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
import com.hrpayroll.data.remote.dto.DashboardStatsDto
import com.hrpayroll.ui.components.BrandHeader
import com.hrpayroll.ui.theme.BrandIndigo

/** Admin home: live overview cards (GET /admin/dashboard/stats). */
@Composable
fun AdminDashboardScreen(
    onLogout: () -> Unit,
    viewModel: AdminDashboardViewModel = hiltViewModel(),
) {
    val state by viewModel.uiState.collectAsState()
    val s: DashboardStatsDto = state.stats ?: DashboardStatsDto()

    Box(modifier = Modifier.fillMaxSize().background(MaterialTheme.colorScheme.background)) {
        Column(modifier = Modifier.fillMaxSize().verticalScroll(rememberScrollState())) {
            BrandHeader(title = "Admin Dashboard")

            Column(modifier = Modifier.padding(16.dp)) {
                Row(modifier = Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically) {
                    Text(
                        "Today's Overview",
                        fontSize = 16.sp,
                        fontWeight = FontWeight.Bold,
                        color = MaterialTheme.colorScheme.onBackground,
                    )
                    Spacer(Modifier.weight(1f))
                    TextButton(onClick = viewModel::refresh) { Text(if (state.isLoading) "…" else "Refresh") }
                }
                Spacer(Modifier.height(8.dp))

                StatRow(
                    StatCardData("Present Now", s.presentNow.toString(), Color(0xFF16A34A)),
                    StatCardData("Absent", s.absent.toString(), Color(0xFFE11D48)),
                )
                Spacer(Modifier.height(12.dp))
                StatRow(
                    StatCardData("Late Arrivals", s.lateArrivals.toString(), Color(0xFFB45309)),
                    StatCardData("On Leave", s.onLeave.toString(), Color(0xFF4F46E5)),
                )
                Spacer(Modifier.height(12.dp))
                StatRow(
                    StatCardData("Total Staff", s.totalStaff.toString(), BrandIndigo),
                    StatCardData("Branches", s.branches.toString(), BrandIndigo),
                )
                Spacer(Modifier.height(12.dp))
                StatRow(
                    StatCardData("Pending Approvals", s.pendingApprovals.toString(), Color(0xFFB45309)),
                    StatCardData("Attendance", "${s.attendanceRate}%", Color(0xFF16A34A)),
                )

                state.error?.let {
                    Spacer(Modifier.height(16.dp))
                    Text(it, color = Color(0xFFE11D48), fontSize = 13.sp)
                }

                Spacer(Modifier.height(24.dp))
                TextButton(onClick = { viewModel.logout(); onLogout() }) {
                    Text("Log out", color = Color(0xFFE11D48), fontWeight = FontWeight.SemiBold)
                }
                Spacer(Modifier.height(24.dp))
            }
        }
    }
}

private data class StatCardData(val label: String, val value: String, val accent: Color)

@Composable
private fun StatRow(left: StatCardData, right: StatCardData) {
    Row(horizontalArrangement = Arrangement.spacedBy(12.dp)) {
        StatCard(left, Modifier.weight(1f))
        StatCard(right, Modifier.weight(1f))
    }
}

@Composable
private fun StatCard(data: StatCardData, modifier: Modifier = Modifier) {
    Card(
        modifier = modifier,
        shape = MaterialTheme.shapes.medium,
        colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.surface),
        elevation = CardDefaults.cardElevation(defaultElevation = 2.dp),
    ) {
        Column(modifier = Modifier.padding(16.dp)) {
            Text(data.value, fontSize = 26.sp, fontWeight = FontWeight.Bold, color = data.accent)
            Spacer(Modifier.height(4.dp))
            Text(
                data.label,
                fontSize = 12.sp,
                color = MaterialTheme.colorScheme.onSurface.copy(alpha = 0.6f),
            )
        }
    }
}
