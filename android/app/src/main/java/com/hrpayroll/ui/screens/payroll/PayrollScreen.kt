package com.hrpayroll.ui.screens.payroll

import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.outlined.BeachAccess
import androidx.compose.material.icons.outlined.CheckCircle
import androidx.compose.material.icons.outlined.Description
import androidx.compose.material.icons.outlined.Download
import androidx.compose.material.icons.outlined.EventBusy
import androidx.compose.material.icons.outlined.HourglassTop
import androidx.compose.material.icons.outlined.Payments
import androidx.compose.material.icons.outlined.Schedule
import androidx.compose.material.icons.outlined.Timelapse
import androidx.compose.material.icons.outlined.Timer
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.hilt.navigation.compose.hiltViewModel
import com.hrpayroll.data.remote.dto.PayslipDto
import com.hrpayroll.ui.components.AnimatedEntrance
import com.hrpayroll.ui.components.BrandHeader
import com.hrpayroll.ui.components.GradientButton
import com.hrpayroll.ui.components.IconBubble
import com.hrpayroll.ui.components.MonthDropdown
import com.hrpayroll.ui.components.SectionCard
import com.hrpayroll.ui.components.SectionTitle
import com.hrpayroll.ui.components.monthLabel
import com.hrpayroll.ui.theme.BrandGreen
import com.hrpayroll.ui.theme.BrandMint
import com.hrpayroll.ui.theme.CardBorder
import com.hrpayroll.ui.theme.Ink
import com.hrpayroll.ui.theme.MutedText
import com.hrpayroll.ui.theme.StatusHalf
import com.hrpayroll.ui.theme.StatusLeave
import com.hrpayroll.ui.theme.StatusOff
import com.hrpayroll.ui.theme.StatusPaid
import com.hrpayroll.ui.theme.StatusPresent
import com.hrpayroll.utils.days
import com.hrpayroll.utils.rupees

/**
 * Pay, and the days behind it: the month's attendance, a downloadable
 * statement of every punch and leave, the payslip, and earlier payslips.
 * Reachable only while the dealer shares payroll with staff.
 */
@Composable
fun PayrollScreen(viewModel: PayrollViewModel = hiltViewModel()) {
    val s by viewModel.uiState.collectAsState()
    val context = LocalContext.current

    // Downloads report back once, as a toast — the PDF has already opened.
    LaunchedEffect(s.notice) {
        s.notice?.let {
            android.widget.Toast.makeText(context, it, android.widget.Toast.LENGTH_LONG).show()
            viewModel.consumeNotice()
        }
    }

    Box(modifier = Modifier.fillMaxSize().background(MaterialTheme.colorScheme.background)) {
        Column(modifier = Modifier.fillMaxSize()) {
            BrandHeader(title = "Payroll", subtitle = "Your pay and the days behind it") {
                MonthDropdown(s.month, s.year, s.months, onSelect = viewModel::selectMonth)
            }

            LazyColumn(
                modifier = Modifier.fillMaxSize(),
                contentPadding = PaddingValues(start = 16.dp, end = 16.dp, bottom = 28.dp),
                verticalArrangement = Arrangement.spacedBy(12.dp),
            ) {
                s.error?.let { message ->
                    item {
                        SectionCard {
                            Text(message, color = StatusOff, fontSize = 13.sp, fontWeight = FontWeight.Medium)
                        }
                    }
                }

                // ── The month's days ──
                item {
                    AnimatedEntrance(index = 0) {
                        if (s.isLoading && s.summary == null) {
                            Box(Modifier.fillMaxWidth().padding(24.dp), contentAlignment = Alignment.Center) {
                                CircularProgressIndicator(color = BrandGreen, strokeWidth = 2.dp, modifier = Modifier.size(24.dp))
                            }
                        } else {
                            MonthStats(s)
                        }
                    }
                }

                // ── Statement download ──
                item {
                    AnimatedEntrance(index = 1) {
                        SectionCard(floating = true) {
                            Row(verticalAlignment = Alignment.CenterVertically) {
                                IconBubble(Icons.Outlined.Description, BrandGreen, size = 44.dp)
                                Spacer(Modifier.width(12.dp))
                                Column(Modifier.weight(1f)) {
                                    Text("Monthly statement", color = Ink, fontWeight = FontWeight.Bold, fontSize = 16.sp)
                                    Text(
                                        "Every punch-in, punch-out and leave for ${monthLabel(s.month, s.year)}",
                                        color = MutedText, fontSize = 12.sp,
                                    )
                                }
                            }
                            Spacer(Modifier.height(14.dp))
                            GradientButton(
                                text = "Download statement (PDF)",
                                icon = Icons.Outlined.Download,
                                loading = s.downloadingStatement,
                                onClick = viewModel::downloadStatement,
                            )
                        }
                    }
                }

                // ── This month's payslip ──
                item {
                    AnimatedEntrance(index = 2) {
                        val slip = s.slipForMonth
                        if (slip != null) {
                            PayslipCard(slip, downloading = s.downloadingSlipId == slip.id) { viewModel.downloadPayslip(slip) }
                        } else if (!s.isLoading) {
                            SectionCard {
                                Row(verticalAlignment = Alignment.CenterVertically) {
                                    IconBubble(Icons.Outlined.Payments, MutedText, size = 40.dp)
                                    Spacer(Modifier.width(12.dp))
                                    Text(
                                        if (s.month == java.time.LocalDate.now().monthValue && s.year == java.time.LocalDate.now().year) {
                                            "This month's payslip appears once payroll has been run."
                                        } else {
                                            "No payslip for ${monthLabel(s.month, s.year)}."
                                        },
                                        fontSize = 13.sp,
                                        color = MutedText,
                                    )
                                }
                            }
                        }
                    }
                }

                val earlier = s.payslips.filterNot { it.month == s.month && it.year == s.year }
                if (earlier.isNotEmpty()) {
                    item { SectionTitle("Earlier payslips", modifier = Modifier.padding(top = 10.dp, start = 4.dp)) }
                    items(earlier, key = { it.id ?: "${it.year}-${it.month}" }) { slip ->
                        PayslipRow(slip, downloading = s.downloadingSlipId == slip.id) { viewModel.downloadPayslip(slip) }
                    }
                }
            }
        }
    }
}

@Composable
private fun MonthStats(s: PayrollUiState) {
    val sum = s.summary
    val worked = sum?.workedMinutes ?: 0
    val tiles = listOf(
        Stat("Hours worked", "${worked / 60}h ${"%02d".format(worked % 60)}m", Icons.Outlined.Timer, BrandGreen),
        Stat("Present", (sum?.present ?: 0).toString(), Icons.Outlined.CheckCircle, StatusPresent),
        Stat("Absent", (sum?.absent ?: 0).toString(), Icons.Outlined.EventBusy, StatusOff),
        Stat("Late", (sum?.late ?: 0).toString(), Icons.Outlined.Schedule, StatusHalf),
        Stat("Half day", (sum?.half ?: 0).toString(), Icons.Outlined.Timelapse, StatusPaid),
        Stat("Leave", (sum?.leave ?: 0).toString(), Icons.Outlined.BeachAccess, StatusLeave),
    )
    Column(verticalArrangement = Arrangement.spacedBy(10.dp)) {
        tiles.chunked(2).forEach { pair ->
            Row(horizontalArrangement = Arrangement.spacedBy(10.dp)) {
                pair.forEach { t ->
                    SectionCard(modifier = Modifier.weight(1f)) {
                        Row(verticalAlignment = Alignment.CenterVertically) {
                            IconBubble(t.icon, t.tint, size = 38.dp)
                            Spacer(Modifier.width(10.dp))
                            Column {
                                Text(t.value, color = Ink, fontSize = 18.sp, fontWeight = FontWeight.Bold, maxLines = 1)
                                Text(t.label, color = MutedText, fontSize = 11.sp, maxLines = 1, overflow = TextOverflow.Ellipsis)
                            }
                        }
                    }
                }
            }
        }
        if ((sum?.pending ?: 0) > 0) {
            Row(
                Modifier.fillMaxWidth().clip(RoundedCornerShape(14.dp)).background(Color(0xFFFDF1D6)).padding(12.dp),
                verticalAlignment = Alignment.CenterVertically,
            ) {
                Icon(Icons.Outlined.HourglassTop, contentDescription = null, tint = Color(0xFF8A5A00), modifier = Modifier.size(18.dp))
                Spacer(Modifier.width(8.dp))
                Text(
                    "${sum?.pending} day${if (sum?.pending == 1) "" else "s"} waiting on your manager — not paid until approved.",
                    color = Color(0xFF8A5A00), fontSize = 12.sp, fontWeight = FontWeight.Medium,
                )
            }
        }
    }
}

private class Stat(val label: String, val value: String, val icon: ImageVector, val tint: Color)

/** The money for one month: what was earned, what came off, what is left. */
@Composable
private fun PayslipCard(slip: PayslipDto, downloading: Boolean, onDownload: () -> Unit) {
    SectionCard {
        Row(verticalAlignment = Alignment.CenterVertically) {
            IconBubble(Icons.Outlined.Payments, BrandGreen, size = 44.dp)
            Spacer(Modifier.width(12.dp))
            Column(Modifier.weight(1f)) {
                Text("Payslip · ${monthLabel(slip.month ?: 1, slip.year ?: 2026)}", color = MutedText, fontSize = 12.sp)
                Text(money(slip.netSalary), color = Ink, fontWeight = FontWeight.Bold, fontSize = 26.sp)
            }
        }
        // Enough late punches move the pay date out — the payslip says so rather
        // than leaving someone to wonder where their salary is.
        slip.payDate?.let { date ->
            Spacer(Modifier.height(6.dp))
            Text(
                "Salary date ${date.take(10)}" +
                    if ((slip.lateDays ?: 0) >= 5) " · moved (${slip.lateDays} late punches)" else "",
                fontSize = 12.sp,
                color = MutedText,
            )
        }
        Spacer(Modifier.height(12.dp))
        HorizontalDivider(color = CardBorder)
        Spacer(Modifier.height(8.dp))
        MoneyRow("Days paid for", days(slip.presentDays ?: 0.0))
        MoneyRow("Earned salary", money(slip.basicSalary))
        if ((slip.otHours ?: 0.0) > 0.0) {
            MoneyRow("Overtime (${days(slip.otHours ?: 0.0)}h) and Sunday duty", "+ " + money(slip.otherAllowances))
        } else if ((slip.otherAllowances ?: 0.0) > 0.0) {
            MoneyRow("Sunday duty and allowances", "+ " + money(slip.otherAllowances))
        }
        if ((slip.pfDeduction ?: 0.0) > 0.0) MoneyRow("PF", "− " + money(slip.pfDeduction))
        if ((slip.esiDeduction ?: 0.0) > 0.0) MoneyRow("ESI", "− " + money(slip.esiDeduction))
        HorizontalDivider(color = CardBorder, modifier = Modifier.padding(vertical = 6.dp))
        MoneyRow("Net salary", money(slip.netSalary), bold = true)
        Spacer(Modifier.height(12.dp))
        DownloadButton("Download payslip (PDF)", downloading, onDownload)
    }
}

/** A past month: net pay and a download. */
@Composable
private fun PayslipRow(slip: PayslipDto, downloading: Boolean, onDownload: () -> Unit) {
    SectionCard {
        Row(verticalAlignment = Alignment.CenterVertically) {
            IconBubble(Icons.Outlined.Payments, BrandGreen, size = 40.dp)
            Spacer(Modifier.width(12.dp))
            Column(Modifier.weight(1f)) {
                Text(monthLabel(slip.month ?: 1, slip.year ?: 2026), color = Ink, fontWeight = FontWeight.SemiBold, fontSize = 15.sp)
                Text("${days(slip.presentDays ?: 0.0)} days paid · ${money(slip.netSalary)}", color = MutedText, fontSize = 12.sp)
            }
            Box(
                Modifier.size(42.dp).clip(RoundedCornerShape(14.dp)).background(BrandMint)
                    .clickable(enabled = !downloading, onClick = onDownload),
                contentAlignment = Alignment.Center,
            ) {
                if (downloading) CircularProgressIndicator(Modifier.size(18.dp), color = BrandGreen, strokeWidth = 2.dp)
                else Icon(Icons.Outlined.Download, contentDescription = "Download payslip", tint = BrandGreen)
            }
        }
    }
}

@Composable
private fun DownloadButton(text: String, downloading: Boolean, onClick: () -> Unit) {
    Row(
        Modifier.fillMaxWidth().height(48.dp)
            .clip(RoundedCornerShape(16.dp))
            .background(BrandMint)
            .border(1.dp, BrandGreen.copy(alpha = 0.3f), RoundedCornerShape(16.dp))
            .clickable(enabled = !downloading, onClick = onClick),
        horizontalArrangement = Arrangement.Center,
        verticalAlignment = Alignment.CenterVertically,
    ) {
        if (downloading) {
            CircularProgressIndicator(Modifier.size(18.dp), color = BrandGreen, strokeWidth = 2.dp)
        } else {
            Icon(Icons.Outlined.Download, contentDescription = null, tint = BrandGreen, modifier = Modifier.size(18.dp))
            Spacer(Modifier.width(8.dp))
            Text(text, color = BrandGreen, fontWeight = FontWeight.Bold, fontSize = 14.sp)
        }
    }
}

@Composable
private fun MoneyRow(label: String, value: String, bold: Boolean = false) {
    Row(modifier = Modifier.fillMaxWidth().padding(vertical = 4.dp)) {
        Text(label, fontSize = 13.sp, color = MutedText, modifier = Modifier.weight(1f))
        Text(
            value,
            fontSize = if (bold) 15.sp else 13.sp,
            fontWeight = if (bold) FontWeight.Bold else FontWeight.Medium,
            color = if (bold) BrandGreen else Ink,
        )
    }
}

private fun money(amount: Double?): String = rupees(Math.round(amount ?: 0.0).toDouble())
