package com.hrpayroll.ui.screens.home

import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.horizontalScroll
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
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.Logout
import androidx.compose.material.icons.filled.AccessTime
import androidx.compose.material.icons.filled.Bolt
import androidx.compose.material.icons.filled.Call
import androidx.compose.material.icons.filled.Description
import androidx.compose.material.icons.filled.Email
import androidx.compose.material.icons.filled.LocationOn
import androidx.compose.material.icons.filled.NorthEast
import androidx.compose.material.icons.filled.Notifications
import androidx.compose.material.icons.filled.Person
import androidx.compose.material3.Card
import androidx.compose.material3.CardDefaults
import androidx.compose.material3.Icon
import androidx.compose.material3.LinearProgressIndicator
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Switch
import androidx.compose.material3.Text
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
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.hilt.navigation.compose.hiltViewModel
import com.hrpayroll.ui.theme.BrandGradient
import com.hrpayroll.ui.theme.BrandIndigo
import com.hrpayroll.ui.theme.MoneyGreen
import com.hrpayroll.ui.theme.StatusOff
import com.hrpayroll.ui.theme.StatusPresent

/** Employee home dashboard (profile, today's attendance, overview, quick actions). */
@Composable
fun HomeScreen(
    onCheckIn: () -> Unit,
    onPayslip: () -> Unit,
    onLogout: () -> Unit = {},
    viewModel: HomeViewModel = hiltViewModel(),
) {
    val s by viewModel.uiState.collectAsState()
    var locationOn by remember { mutableStateOf(true) }
    var confirmLogout by remember { mutableStateOf(false) }

    if (confirmLogout) {
        androidx.compose.material3.AlertDialog(
            onDismissRequest = { confirmLogout = false },
            title = { Text("Log out?") },
            text = { Text("You will need your phone number and password to sign in again.") },
            confirmButton = {
                androidx.compose.material3.TextButton(onClick = {
                    confirmLogout = false
                    viewModel.logout()
                    onLogout()
                }) { Text("Log out") }
            },
            dismissButton = {
                androidx.compose.material3.TextButton(onClick = { confirmLogout = false }) { Text("Cancel") }
            },
        )
    }

    Box(modifier = Modifier.fillMaxSize().background(MaterialTheme.colorScheme.background)) {
        Column(modifier = Modifier.fillMaxSize().verticalScroll(rememberScrollState())) {

            // ── Gradient header with profile ──
            Box(
                modifier = Modifier
                    .fillMaxWidth()
                    .clip(RoundedCornerShape(bottomStart = 28.dp, bottomEnd = 28.dp))
                    .background(BrandGradient)
                    .padding(20.dp),
            ) {
                Box(
                    modifier = Modifier.size(40.dp).clip(RoundedCornerShape(12.dp)).background(Color.White.copy(alpha = 0.18f)),
                    contentAlignment = Alignment.Center,
                ) { Icon(Icons.Filled.Notifications, contentDescription = "Alerts", tint = Color.White) }

                Box(
                    modifier = Modifier
                        .align(Alignment.TopEnd)
                        .size(40.dp)
                        .clip(RoundedCornerShape(12.dp))
                        .background(Color.White.copy(alpha = 0.18f))
                        .clickable { confirmLogout = true },
                    contentAlignment = Alignment.Center,
                ) { Icon(Icons.AutoMirrored.Filled.Logout, contentDescription = "Logout", tint = Color.White) }

                Column(
                    modifier = Modifier.fillMaxWidth().padding(top = 8.dp),
                    horizontalAlignment = Alignment.CenterHorizontally,
                ) {
                    // Profile photo (enrolled face / latest selfie); person icon shows until it loads.
                    Box(
                        modifier = Modifier.size(86.dp).clip(CircleShape).background(Color.White.copy(alpha = 0.18f)),
                        contentAlignment = Alignment.Center,
                    ) {
                        Icon(Icons.Filled.Person, contentDescription = null, tint = Color.White, modifier = Modifier.size(46.dp))
                        if (s.photoUrl.isNotBlank()) {
                            coil.compose.AsyncImage(
                                model = coil.request.ImageRequest.Builder(androidx.compose.ui.platform.LocalContext.current)
                                    .data(s.photoUrl)
                                    .apply { viewModel.authToken?.let { addHeader("Authorization", "Bearer $it") } }
                                    // Never persist to disk — a wrong photo must not survive a re-login
                                    // on a shared phone or an employee re-enrollment.
                                    .diskCachePolicy(coil.request.CachePolicy.DISABLED)
                                    .crossfade(true)
                                    .build(),
                                contentDescription = "Profile photo",
                                contentScale = androidx.compose.ui.layout.ContentScale.Crop,
                                modifier = Modifier.size(86.dp).clip(CircleShape),
                            )
                        }
                    }
                    Spacer(Modifier.height(10.dp))
                    Text(s.name, color = Color.White, fontSize = 20.sp, fontWeight = FontWeight.Bold)
                    Text(
                        s.designation.ifBlank { "Employee" },
                        color = Color.White.copy(alpha = 0.8f),
                        fontSize = 13.sp,
                    )
                    Spacer(Modifier.height(28.dp))
                }
            }

            // ── Today Attendance card (overlaps the header) ──
            Card(
                modifier = Modifier.fillMaxWidth().padding(horizontal = 16.dp).offset(y = (-24).dp),
                shape = RoundedCornerShape(20.dp),
                colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.surface),
                elevation = CardDefaults.cardElevation(defaultElevation = 6.dp),
            ) {
                Column(modifier = Modifier.padding(18.dp)) {
                    Row(verticalAlignment = Alignment.CenterVertically) {
                        Icon(Icons.Filled.AccessTime, contentDescription = null, tint = BrandIndigo, modifier = Modifier.size(18.dp))
                        Text("  Today Attendance", fontWeight = FontWeight.SemiBold, color = MaterialTheme.colorScheme.onSurface)
                        Spacer(Modifier.weight(1f))
                        Text(
                            if (s.employeeCode.isNotBlank()) "ID# ${s.employeeCode}" else "",
                            fontSize = 11.sp,
                            color = MaterialTheme.colorScheme.onSurface.copy(alpha = 0.5f),
                        )
                    }
                    Spacer(Modifier.height(16.dp))
                    Row(modifier = Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween) {
                        TodayStat("Today", s.todayWorked, BrandIndigo)
                        TodayStat("Present", s.presentDays.toString(), StatusPresent)
                        TodayStat("Absent", s.absentDays.toString(), StatusOff)
                    }
                }
            }

            // ── Overview ──
            SectionLabel("Overview")
            Row(
                modifier = Modifier.fillMaxWidth().horizontalScroll(rememberScrollState()).padding(horizontal = 16.dp),
                horizontalArrangement = Arrangement.spacedBy(12.dp),
            ) {
                StatCard("Attendance", "${s.attendanceRate}%", "This month", s.attendanceRate / 100f)
                StatCard("Leave Balance", s.leaveBalance.toInt().toString(), "Days left", null)
            }

            // ── Quick actions ──
            SectionLabel("Other Detail")
            Card(
                modifier = Modifier.fillMaxWidth().padding(horizontal = 16.dp),
                shape = RoundedCornerShape(20.dp),
                colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.surface),
                elevation = CardDefaults.cardElevation(defaultElevation = 2.dp),
            ) {
                Column(modifier = Modifier.padding(16.dp)) {
                    Row(verticalAlignment = Alignment.CenterVertically) {
                        Icon(Icons.Filled.Bolt, contentDescription = null, tint = BrandIndigo)
                        Text("  Quick Actions", fontWeight = FontWeight.SemiBold, color = MaterialTheme.colorScheme.onSurface)
                    }
                    Spacer(Modifier.height(14.dp))
                    Row(horizontalArrangement = Arrangement.spacedBy(12.dp)) {
                        QuickAction(Icons.Filled.AccessTime, "Clock In/Out", Color(0xFF2563EB), Modifier.weight(1f), onCheckIn)
                        QuickAction(Icons.Filled.Email, "Messages", Color(0xFF7C3AED), Modifier.weight(1f)) {}
                    }
                    Spacer(Modifier.height(12.dp))
                    Row(horizontalArrangement = Arrangement.spacedBy(12.dp)) {
                        QuickAction(Icons.Filled.Call, "Contact HR", Color(0xFFEA580C), Modifier.weight(1f)) {}
                        Spacer(Modifier.weight(1f))
                    }
                }
            }

            // ── Location toggle ──
            Spacer(Modifier.height(14.dp))
            Card(
                modifier = Modifier.fillMaxWidth().padding(horizontal = 16.dp),
                shape = RoundedCornerShape(20.dp),
                colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.surface),
                elevation = CardDefaults.cardElevation(defaultElevation = 2.dp),
            ) {
                Row(modifier = Modifier.fillMaxWidth().padding(16.dp), verticalAlignment = Alignment.CenterVertically) {
                    Icon(Icons.Filled.LocationOn, contentDescription = null, tint = StatusOff)
                    Column(modifier = Modifier.weight(1f).padding(start = 12.dp)) {
                        Text("Location", fontWeight = FontWeight.SemiBold, color = MaterialTheme.colorScheme.onSurface)
                        Text(
                            "Enable location for attendance tracking",
                            fontSize = 11.sp,
                            color = MaterialTheme.colorScheme.onSurface.copy(alpha = 0.6f),
                        )
                    }
                    Switch(checked = locationOn, onCheckedChange = { locationOn = it })
                }
            }
            Spacer(Modifier.height(24.dp))
        }
    }
}

@Composable
private fun TodayStat(label: String, value: String, accent: Color) {
    Column(horizontalAlignment = Alignment.CenterHorizontally) {
        Text(value, fontSize = 18.sp, fontWeight = FontWeight.Bold, color = accent)
        Spacer(Modifier.height(2.dp))
        Text(label, fontSize = 11.sp, color = MaterialTheme.colorScheme.onSurface.copy(alpha = 0.6f))
    }
}

@Composable
private fun SectionLabel(text: String) {
    Text(
        text,
        fontSize = 15.sp,
        fontWeight = FontWeight.Bold,
        color = MaterialTheme.colorScheme.onBackground,
        modifier = Modifier.padding(start = 16.dp, top = 20.dp, bottom = 10.dp),
    )
}

@Composable
private fun StatCard(label: String, value: String, caption: String, progress: Float?) {
    Card(
        modifier = Modifier.width(160.dp),
        shape = RoundedCornerShape(18.dp),
        colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.surface),
        elevation = CardDefaults.cardElevation(defaultElevation = 2.dp),
    ) {
        Column(modifier = Modifier.padding(16.dp)) {
            Row(verticalAlignment = Alignment.CenterVertically) {
                Text(label, fontSize = 12.sp, color = MaterialTheme.colorScheme.onSurface.copy(alpha = 0.6f), modifier = Modifier.weight(1f))
                Box(
                    modifier = Modifier.size(26.dp).clip(CircleShape).background(BrandIndigo.copy(alpha = 0.12f)),
                    contentAlignment = Alignment.Center,
                ) { Icon(Icons.Filled.NorthEast, contentDescription = null, tint = BrandIndigo, modifier = Modifier.size(15.dp)) }
            }
            Spacer(Modifier.height(10.dp))
            Text(value, fontSize = 22.sp, fontWeight = FontWeight.Bold, color = MaterialTheme.colorScheme.onSurface)
            Text(caption, fontSize = 11.sp, color = MaterialTheme.colorScheme.onSurface.copy(alpha = 0.55f))
            if (progress != null) {
                Spacer(Modifier.height(10.dp))
                LinearProgressIndicator(
                    progress = { progress.coerceIn(0f, 1f) },
                    modifier = Modifier.fillMaxWidth().height(6.dp).clip(RoundedCornerShape(3.dp)),
                    color = BrandIndigo,
                    trackColor = BrandIndigo.copy(alpha = 0.15f),
                )
            }
        }
    }
}

@Composable
private fun QuickAction(icon: ImageVector, label: String, tint: Color, modifier: Modifier = Modifier, onClick: () -> Unit) {
    Card(
        modifier = modifier.clickable(onClick = onClick),
        shape = RoundedCornerShape(16.dp),
        colors = CardDefaults.cardColors(containerColor = tint.copy(alpha = 0.08f)),
        elevation = CardDefaults.cardElevation(defaultElevation = 0.dp),
    ) {
        Row(modifier = Modifier.padding(14.dp), verticalAlignment = Alignment.CenterVertically) {
            Box(
                modifier = Modifier.size(36.dp).clip(RoundedCornerShape(10.dp)).background(tint.copy(alpha = 0.15f)),
                contentAlignment = Alignment.Center,
            ) { Icon(icon, contentDescription = null, tint = tint, modifier = Modifier.size(20.dp)) }
            Text("  $label", fontSize = 13.sp, fontWeight = FontWeight.Medium, color = MaterialTheme.colorScheme.onSurface)
        }
    }
}
