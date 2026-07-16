package com.hrpayroll.ui.screens.payslip

import androidx.compose.foundation.background
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
import androidx.compose.material3.Card
import androidx.compose.material3.CardDefaults
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
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
import com.hrpayroll.data.remote.dto.PayslipDto
import com.hrpayroll.ui.components.BrandHeader
import com.hrpayroll.ui.theme.DeductRed
import com.hrpayroll.ui.theme.MoneyGreen

private val MONTHS = arrayOf("", "January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December")
private fun money(v: Double?) = "₹" + (v ?: 0.0).toInt().toString()

/** Monthly payslip — wired to GET /payroll/my-payslips (latest payslip shown). */
@Composable
fun PayslipScreen(viewModel: PayslipViewModel = hiltViewModel()) {
    val state by viewModel.uiState.collectAsState()
    val slip = state.payslips.firstOrNull()

    Box(modifier = Modifier.fillMaxSize().background(MaterialTheme.colorScheme.background)) {
        Column(modifier = Modifier.fillMaxSize().verticalScroll(rememberScrollState())) {
            BrandHeader(title = "Payslip")

            Column(modifier = Modifier.padding(horizontal = 16.dp).offset(y = (-20).dp)) {
                when {
                    state.isLoading -> {
                        Spacer(Modifier.height(24.dp))
                        CircularProgressIndicator()
                    }
                    slip == null -> {
                        Spacer(Modifier.height(24.dp))
                        Text(
                            state.error ?: "No payslips yet. Ask HR to run payroll.",
                            color = MaterialTheme.colorScheme.onBackground.copy(alpha = 0.7f),
                        )
                    }
                    else -> PayslipContent(slip)
                }
            }
        }
    }
}

@Composable
private fun PayslipContent(slip: PayslipDto) {
    Text(
        "Salary — ${MONTHS.getOrElse(slip.month ?: 0) { "" }} ${slip.year ?: ""}",
        fontSize = 17.sp,
        fontWeight = FontWeight.Bold,
        color = MaterialTheme.colorScheme.onBackground,
    )
    Spacer(Modifier.height(12.dp))

    // Late-punch policy: slip withheld beyond the late limit; otherwise show pay date.
    if (slip.status == "WITHHELD") {
        Card(
            modifier = Modifier.fillMaxWidth(),
            shape = MaterialTheme.shapes.medium,
            colors = CardDefaults.cardColors(containerColor = Color(0xFFFFE4E6)),
            elevation = CardDefaults.cardElevation(defaultElevation = 0.dp),
        ) {
            Text(
                "Salary slip withheld — ${slip.lateDays ?: 0} late punches this month. Please contact HR.",
                modifier = Modifier.padding(14.dp),
                fontSize = 13.sp,
                fontWeight = FontWeight.SemiBold,
                color = Color(0xFFE11D48),
            )
        }
        Spacer(Modifier.height(12.dp))
    } else if (slip.payDate != null) {
        Text(
            "Salary date: ${slip.payDate.take(10)}" +
                if ((slip.lateDays ?: 0) >= 5) "  ·  moved from 5th (${slip.lateDays} late punches)" else "",
            fontSize = 12.sp,
            fontWeight = FontWeight.Medium,
            color = MaterialTheme.colorScheme.onBackground.copy(alpha = 0.7f),
        )
        Spacer(Modifier.height(12.dp))
    }

    Card(
        modifier = Modifier.fillMaxWidth(),
        shape = MaterialTheme.shapes.medium,
        colors = CardDefaults.cardColors(containerColor = Color(0xFFE9FBF0)),
        elevation = CardDefaults.cardElevation(defaultElevation = 0.dp),
    ) {
        Row(modifier = Modifier.fillMaxWidth().padding(18.dp), verticalAlignment = Alignment.CenterVertically) {
            Column(Modifier.weight(1f)) {
                Text("Gross Salary", fontSize = 12.sp, color = MoneyGreen)
                Row(verticalAlignment = Alignment.Bottom) {
                    Text(money(slip.grossSalary), fontSize = 32.sp, fontWeight = FontWeight.Bold, color = MoneyGreen)
                    Text("  ${slip.presentDays ?: 0} present days", fontSize = 12.sp, color = MoneyGreen.copy(alpha = 0.8f))
                }
            }
        }
    }
    Spacer(Modifier.height(16.dp))

    SectionCard(
        "Earnings",
        listOf(
            "Salary (earned)" to money(slip.basicSalary),
            "OT + Sunday pay" to money(slip.otherAllowances),
        ),
        deduction = false,
    )
    Spacer(Modifier.height(12.dp))
    // Only some employees have PF/ESI — show just the ones that apply.
    SectionCard(
        "Deductions",
        listOfNotNull(
            slip.pfDeduction?.takeIf { it > 0 }?.let { "PF" to money(it) },
            slip.esiDeduction?.takeIf { it > 0 }?.let { "ESI" to money(it) },
        ).ifEmpty { listOf("No deductions" to "—") },
        deduction = true,
    )
    Spacer(Modifier.height(16.dp))

    Card(
        modifier = Modifier.fillMaxWidth(),
        shape = MaterialTheme.shapes.medium,
        colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.primary),
    ) {
        Row(modifier = Modifier.fillMaxWidth().padding(18.dp), verticalAlignment = Alignment.CenterVertically) {
            Text("Net Salary", color = Color.White, fontWeight = FontWeight.SemiBold, modifier = Modifier.weight(1f))
            Text(money(slip.netSalary), color = Color.White, fontSize = 22.sp, fontWeight = FontWeight.Bold)
        }
    }
    Spacer(Modifier.height(24.dp))
}

@Composable
private fun SectionCard(title: String, items: List<Pair<String, String>>, deduction: Boolean) {
    Card(
        modifier = Modifier.fillMaxWidth(),
        shape = MaterialTheme.shapes.medium,
        colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.surface),
        elevation = CardDefaults.cardElevation(defaultElevation = 2.dp),
    ) {
        Column(modifier = Modifier.padding(16.dp)) {
            Text(title, fontSize = 15.sp, fontWeight = FontWeight.Bold, color = MaterialTheme.colorScheme.onSurface)
            Spacer(Modifier.height(8.dp))
            items.forEachIndexed { i, (label, amount) ->
                Row(modifier = Modifier.fillMaxWidth().padding(vertical = 8.dp)) {
                    Text(label, modifier = Modifier.weight(1f), color = MaterialTheme.colorScheme.onSurface.copy(alpha = 0.8f))
                    Text((if (deduction) "- " else "") + amount, fontWeight = FontWeight.SemiBold, color = if (deduction) DeductRed else MoneyGreen)
                }
                if (i < items.lastIndex) HorizontalDivider(color = MaterialTheme.colorScheme.surfaceVariant)
            }
        }
    }
}
