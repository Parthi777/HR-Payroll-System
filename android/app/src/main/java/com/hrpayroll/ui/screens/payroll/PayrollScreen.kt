package com.hrpayroll.ui.screens.payroll

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
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.ChevronLeft
import androidx.compose.material.icons.filled.ChevronRight
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.hilt.navigation.compose.hiltViewModel
import com.hrpayroll.data.remote.dto.PayslipDto
import com.hrpayroll.ui.components.BrandHeader
import com.hrpayroll.ui.components.AnimatedEntrance
import com.hrpayroll.ui.components.SectionCard
import com.hrpayroll.ui.components.TodayStat
import com.hrpayroll.ui.theme.BrandIndigo
import com.hrpayroll.ui.theme.MoneyGreen
import com.hrpayroll.ui.theme.StatusHalf
import com.hrpayroll.ui.theme.StatusLeave
import com.hrpayroll.ui.theme.StatusMuted
import com.hrpayroll.ui.theme.StatusOff
import com.hrpayroll.ui.theme.StatusPresent
import java.time.LocalDate
import java.time.format.TextStyle
import java.util.Locale

/**
 * Pay, and the days behind it.
 *
 * Deliberately one screen rather than two: "how many hours did I work" and
 * "what am I being paid" are the same question asked twice, and the payslip
 * screen this replaces was unreachable from the app anyway.
 */
@Composable
fun PayrollScreen(viewModel: PayrollViewModel = hiltViewModel()) {
    val s by viewModel.uiState.collectAsState()
    val monthName = LocalDate.of(s.year, s.month, 1).month
        .getDisplayName(TextStyle.FULL, Locale.getDefault())

    Box(modifier = Modifier.fillMaxSize().background(MaterialTheme.colorScheme.background)) {
        Column(modifier = Modifier.fillMaxSize()) {
            BrandHeader(title = "Payroll")

            LazyColumn(
                modifier = Modifier.fillMaxSize().offset(y = (-22).dp),
                contentPadding = androidx.compose.foundation.layout.PaddingValues(
                    start = 16.dp, end = 16.dp, bottom = 24.dp,
                ),
                verticalArrangement = Arrangement.spacedBy(12.dp),
            ) {
                item {
                    AnimatedEntrance(index = 0) {
                    SectionCard(floating = true) {
                        MonthPicker(
                            label = "$monthName ${s.year}",
                            onPrevious = { viewModel.shiftMonth(-1) },
                            onNext = { viewModel.shiftMonth(1) },
                            canGoForward = !s.isCurrentMonth,
                        )
                        Spacer(Modifier.height(14.dp))

                        if (s.isLoading && s.summary == null) {
                            Row(
                                modifier = Modifier.fillMaxWidth().padding(vertical = 18.dp),
                                horizontalArrangement = Arrangement.Center,
                            ) { CircularProgressIndicator(Modifier.size(22.dp), strokeWidth = 2.dp) }
                        } else {
                            val sum = s.summary
                            val worked = sum?.workedMinutes ?: 0
                            Row(modifier = Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween) {
                                TodayStat("Hours worked", "%d:%02d".format(worked / 60, worked % 60), BrandIndigo, Modifier.weight(1f))
                                TodayStat("Present", (sum?.present ?: 0).toString(), StatusPresent, Modifier.weight(1f))
                                TodayStat("Absent", (sum?.absent ?: 0).toString(), StatusOff, Modifier.weight(1f))
                            }
                            Spacer(Modifier.height(14.dp))
                            HorizontalDivider(color = MaterialTheme.colorScheme.onSurface.copy(alpha = 0.08f))
                            Spacer(Modifier.height(12.dp))
                            Row(modifier = Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween) {
                                TodayStat("Late", (sum?.late ?: 0).toString(), StatusHalf, Modifier.weight(1f))
                                TodayStat("Half day", (sum?.half ?: 0).toString(), StatusHalf, Modifier.weight(1f))
                                TodayStat("Leave", (sum?.leave ?: 0).toString(), StatusLeave, Modifier.weight(1f))
                                TodayStat("Awaiting", (sum?.pending ?: 0).toString(), StatusMuted, Modifier.weight(1f))
                            }
                            if ((sum?.pending ?: 0) > 0) {
                                Spacer(Modifier.height(10.dp))
                                Text(
                                    "Days waiting on your manager are not paid until they are approved.",
                                    fontSize = 11.sp,
                                    color = StatusHalf,
                                )
                            }
                        }
                        s.error?.let {
                            Spacer(Modifier.height(10.dp))
                            Text(it, fontSize = 12.sp, color = MaterialTheme.colorScheme.error)
                        }
                    }
                    }
                }

                // The payslip for the month on screen, when payroll has been run.
                item {
                    val slip = s.slipForMonth
                    AnimatedEntrance(index = 1) {
                    if (slip != null) {
                        PayslipCard(slip, monthName)
                    } else if (!s.isLoading) {
                        SectionCard {
                            Text(
                                if (s.isCurrentMonth) {
                                    "This month's payslip appears once payroll has been run for $monthName."
                                } else {
                                    "No payslip for $monthName ${s.year}."
                                },
                                fontSize = 13.sp,
                                color = MaterialTheme.colorScheme.onSurface.copy(alpha = 0.6f),
                            )
                        }
                    }
                    }
                }

                val earlier = s.payslips.filterNot { it.month == s.month && it.year == s.year }
                if (earlier.isNotEmpty()) {
                    item {
                        Text(
                            "Earlier payslips",
                            fontSize = 15.sp,
                            fontWeight = FontWeight.Bold,
                            color = MaterialTheme.colorScheme.onBackground,
                            modifier = Modifier.padding(top = 8.dp, bottom = 2.dp),
                        )
                    }
                    items(earlier) { slip ->
                        PayslipRow(slip)
                    }
                }
            }
        }
    }
}

@Composable
private fun MonthPicker(
    label: String,
    onPrevious: () -> Unit,
    onNext: () -> Unit,
    canGoForward: Boolean,
) {
    Row(modifier = Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically) {
        MonthArrow(Icons.Filled.ChevronLeft, "Previous month", true, onPrevious)
        Text(
            label,
            modifier = Modifier.weight(1f),
            textAlign = androidx.compose.ui.text.style.TextAlign.Center,
            fontWeight = FontWeight.Bold,
            color = MaterialTheme.colorScheme.onSurface,
        )
        MonthArrow(Icons.Filled.ChevronRight, "Next month", canGoForward, onNext)
    }
}

@Composable
private fun MonthArrow(
    icon: androidx.compose.ui.graphics.vector.ImageVector,
    description: String,
    enabled: Boolean,
    onClick: () -> Unit,
) {
    Box(
        modifier = Modifier
            .size(34.dp)
            .clip(CircleShape)
            .background(MaterialTheme.colorScheme.surfaceVariant.copy(alpha = if (enabled) 1f else 0.4f))
            .then(if (enabled) Modifier.clickable(onClick = onClick) else Modifier),
        contentAlignment = Alignment.Center,
    ) {
        Icon(
            icon,
            contentDescription = description,
            tint = MaterialTheme.colorScheme.onSurface.copy(alpha = if (enabled) 0.8f else 0.3f),
            modifier = Modifier.size(20.dp),
        )
    }
}

/** The money for one month: what was earned, what came off, what is left. */
@Composable
private fun PayslipCard(slip: PayslipDto, monthName: String) {
    SectionCard {
        Row(verticalAlignment = Alignment.CenterVertically) {
            Text("$monthName ${slip.year ?: ""}", fontWeight = FontWeight.Bold, color = MaterialTheme.colorScheme.onSurface)
            Spacer(Modifier.weight(1f))
            slip.status?.let {
                Text(it, fontSize = 11.sp, color = MaterialTheme.colorScheme.onSurface.copy(alpha = 0.5f))
            }
        }
        // Enough late punches move the pay date out — the payslip says so rather
        // than leaving someone to wonder where their salary is.
        slip.payDate?.let { date ->
            Spacer(Modifier.height(4.dp))
            Text(
                "Salary date ${date.take(10)}" +
                    if ((slip.lateDays ?: 0) >= 5) " · moved (${slip.lateDays} late punches)" else "",
                fontSize = 11.sp,
                color = MaterialTheme.colorScheme.onSurface.copy(alpha = 0.6f),
            )
        }

        Spacer(Modifier.height(14.dp))
        Text(money(slip.netSalary), fontSize = 30.sp, fontWeight = FontWeight.Bold, color = MoneyGreen)
        Text("Net salary", fontSize = 12.sp, color = MaterialTheme.colorScheme.onSurface.copy(alpha = 0.6f))

        Spacer(Modifier.height(14.dp))
        HorizontalDivider(color = MaterialTheme.colorScheme.onSurface.copy(alpha = 0.08f))
        Spacer(Modifier.height(10.dp))

        MoneyRow("Earned salary", slip.basicSalary)
        if ((slip.otHours ?: 0.0) > 0.0) {
            MoneyRow("Overtime (${fmt(slip.otHours)}h) and Sunday duty", slip.otherAllowances)
        } else if ((slip.otherAllowances ?: 0.0) > 0.0) {
            MoneyRow("Sunday duty and allowances", slip.otherAllowances)
        }
        if ((slip.pfDeduction ?: 0.0) > 0.0) MoneyRow("PF", slip.pfDeduction, negative = true)
        if ((slip.esiDeduction ?: 0.0) > 0.0) MoneyRow("ESI", slip.esiDeduction, negative = true)
    }
}

/** A past month, one line. Tapping is not offered — the PDF lives on the web. */
@Composable
private fun PayslipRow(slip: PayslipDto) {
    SectionCard {
        Row(verticalAlignment = Alignment.CenterVertically) {
            Column(modifier = Modifier.weight(1f)) {
                Text(
                    "${LocalDate.of(slip.year ?: 2026, slip.month ?: 1, 1).month.getDisplayName(TextStyle.FULL, Locale.getDefault())} ${slip.year ?: ""}",
                    fontWeight = FontWeight.SemiBold,
                    color = MaterialTheme.colorScheme.onSurface,
                )
                Text(
                    "${slip.presentDays ?: 0} present · ${fmt(slip.otHours)}h overtime",
                    fontSize = 11.sp,
                    color = MaterialTheme.colorScheme.onSurface.copy(alpha = 0.6f),
                )
            }
            Text(money(slip.netSalary), fontWeight = FontWeight.Bold, color = MoneyGreen)
        }
    }
}

@Composable
private fun MoneyRow(label: String, amount: Double?, negative: Boolean = false) {
    Row(modifier = Modifier.fillMaxWidth().padding(vertical = 3.dp)) {
        Text(label, fontSize = 13.sp, color = MaterialTheme.colorScheme.onSurface.copy(alpha = 0.75f))
        Spacer(Modifier.weight(1f))
        Text(
            (if (negative) "− " else "") + money(amount),
            fontSize = 13.sp,
            fontWeight = FontWeight.Medium,
            color = if (negative) StatusOff else MaterialTheme.colorScheme.onSurface,
        )
    }
}

private fun money(amount: Double?): String = "₹%,.0f".format(amount ?: 0.0)

private fun fmt(hours: Double?): String =
    if (hours == null || hours == 0.0) "0" else "%.1f".format(hours).removeSuffix(".0")
