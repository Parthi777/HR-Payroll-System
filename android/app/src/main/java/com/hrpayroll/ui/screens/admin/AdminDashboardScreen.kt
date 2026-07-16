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
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.Logout
import androidx.compose.material3.Card
import androidx.compose.material3.CardDefaults
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
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
    var confirmLogout by remember { mutableStateOf(false) }

    if (confirmLogout) {
        androidx.compose.material3.AlertDialog(
            onDismissRequest = { confirmLogout = false },
            title = { Text("Log out?") },
            text = { Text("You will need your admin email and password to sign in again.") },
            confirmButton = {
                TextButton(onClick = {
                    confirmLogout = false
                    viewModel.logout()
                    onLogout()
                }) { Text("Log out") }
            },
            dismissButton = { TextButton(onClick = { confirmLogout = false }) { Text("Cancel") } },
        )
    }

    Box(modifier = Modifier.fillMaxSize().background(MaterialTheme.colorScheme.background)) {
        Column(modifier = Modifier.fillMaxSize().verticalScroll(rememberScrollState())) {
            BrandHeader(
                title = "Admin Dashboard",
                trailingIcon = Icons.AutoMirrored.Filled.Logout,
                trailingDescription = "Log out",
                onTrailing = { confirmLogout = true },
            )

            Column(modifier = Modifier.padding(16.dp)) {
                NotificationsCard(
                    notifications = state.notifications,
                    unread = state.unread,
                    onSeen = viewModel::markNotificationsRead,
                )

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

                // App details footer
                Spacer(Modifier.height(28.dp))
                val server = com.hrpayroll.BuildConfig.API_BASE_URL
                    .removePrefix("https://").removePrefix("http://").trimEnd('/')
                    .removeSuffix("/api").removeSuffix("api")
                Text(
                    "HR & Payroll · v${com.hrpayroll.BuildConfig.VERSION_NAME}\nServer: $server",
                    fontSize = 11.sp,
                    lineHeight = 16.sp,
                    textAlign = androidx.compose.ui.text.style.TextAlign.Center,
                    color = MaterialTheme.colorScheme.onBackground.copy(alpha = 0.45f),
                    modifier = Modifier.fillMaxWidth(),
                )
                Spacer(Modifier.height(20.dp))
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


/** Claims-workflow notifications: new claims to approve / approved claims to pay.
 *  Hidden when empty; "Mark read" clears the unread badge. */
@Composable
private fun NotificationsCard(
    notifications: List<com.hrpayroll.data.remote.dto.NotificationDto>,
    unread: Int,
    onSeen: () -> Unit,
) {
    if (notifications.isEmpty()) return
    androidx.compose.material3.Card(
        modifier = Modifier.fillMaxWidth().padding(bottom = 14.dp),
        shape = MaterialTheme.shapes.medium,
        colors = androidx.compose.material3.CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.surface),
        elevation = androidx.compose.material3.CardDefaults.cardElevation(defaultElevation = 2.dp),
    ) {
        Column(Modifier.padding(14.dp)) {
            Row(verticalAlignment = Alignment.CenterVertically) {
                Text(
                    if (unread > 0) "Notifications ($unread new)" else "Notifications",
                    fontSize = 15.sp,
                    fontWeight = FontWeight.Bold,
                    color = if (unread > 0) MaterialTheme.colorScheme.primary else MaterialTheme.colorScheme.onSurface,
                )
                Spacer(Modifier.weight(1f))
                if (unread > 0) TextButton(onClick = onSeen) { Text("Mark read", fontSize = 12.sp) }
            }
            notifications.take(5).forEach { n ->
                Column(Modifier.padding(vertical = 5.dp)) {
                    Text(
                        (if (n.type == "CLAIM_APPROVED") "\u2713 " else "\u25CF ") + (n.title ?: ""),
                        fontSize = 13.sp,
                        fontWeight = if (n.isRead == false) FontWeight.Bold else FontWeight.SemiBold,
                        color = MaterialTheme.colorScheme.onSurface,
                    )
                    Text(
                        n.body ?: "",
                        fontSize = 12.sp,
                        color = MaterialTheme.colorScheme.onSurface.copy(alpha = 0.65f),
                    )
                }
            }
        }
    }
}
