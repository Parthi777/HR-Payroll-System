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
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.hrpayroll.ui.components.BrandHeader
import com.hrpayroll.ui.theme.DeductRed
import com.hrpayroll.ui.theme.MoneyGreen

/** Monthly payslip + deduction breakdown (see CLAUDE.md). TODO: wire to /api/payroll. */
private data class LineItem(val label: String, val amount: String, val isDeduction: Boolean = false)

private val earnings = listOf(
    LineItem("Basic Salary", "$250"),
    LineItem("HRA", "$120"),
    LineItem("Special Allowance", "$90"),
    LineItem("Dearness Allowance", "$60"),
)
private val deductions = listOf(
    LineItem("PF", "$30", isDeduction = true),
    LineItem("ESI", "$8", isDeduction = true),
    LineItem("Professional Tax", "$12", isDeduction = true),
    LineItem("Tax Deduction", "$20", isDeduction = true),
)

@Composable
fun PayslipScreen() {
    Box(modifier = Modifier.fillMaxSize().background(MaterialTheme.colorScheme.background)) {
        Column(modifier = Modifier.fillMaxSize().verticalScroll(rememberScrollState())) {
            BrandHeader(title = "Payslip")

            Column(modifier = Modifier.padding(horizontal = 16.dp).offset(y = (-20).dp)) {
                Text(
                    "Salary — February 2026",
                    fontSize = 17.sp,
                    fontWeight = FontWeight.Bold,
                    color = MaterialTheme.colorScheme.onBackground,
                )
                Spacer(Modifier.height(12.dp))

                // Gross salary highlight card (green, like the reference).
                Card(
                    modifier = Modifier.fillMaxWidth(),
                    shape = MaterialTheme.shapes.medium,
                    colors = CardDefaults.cardColors(containerColor = Color(0xFFE9FBF0)),
                    elevation = CardDefaults.cardElevation(defaultElevation = 0.dp),
                ) {
                    Row(
                        modifier = Modifier.fillMaxWidth().padding(18.dp),
                        verticalAlignment = Alignment.CenterVertically,
                    ) {
                        Column(Modifier.weight(1f)) {
                            Text("Gross Salary", fontSize = 12.sp, color = MoneyGreen)
                            Row(verticalAlignment = Alignment.Bottom) {
                                Text("$700", fontSize = 32.sp, fontWeight = FontWeight.Bold, color = MoneyGreen)
                                Text("  Per Month", fontSize = 12.sp, color = MoneyGreen.copy(alpha = 0.8f))
                            }
                        }
                    }
                }
                Spacer(Modifier.height(16.dp))

                SectionCard(title = "Earnings", items = earnings)
                Spacer(Modifier.height(12.dp))
                SectionCard(title = "Deductions", items = deductions)
                Spacer(Modifier.height(16.dp))

                // Net salary
                Card(
                    modifier = Modifier.fillMaxWidth(),
                    shape = MaterialTheme.shapes.medium,
                    colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.primary),
                ) {
                    Row(
                        modifier = Modifier.fillMaxWidth().padding(18.dp),
                        verticalAlignment = Alignment.CenterVertically,
                    ) {
                        Text("Net Salary", color = Color.White, fontWeight = FontWeight.SemiBold, modifier = Modifier.weight(1f))
                        Text("$630", color = Color.White, fontSize = 22.sp, fontWeight = FontWeight.Bold)
                    }
                }
                Spacer(Modifier.height(24.dp))
            }
        }
    }
}

@Composable
private fun SectionCard(title: String, items: List<LineItem>) {
    Card(
        modifier = Modifier.fillMaxWidth(),
        shape = MaterialTheme.shapes.medium,
        colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.surface),
        elevation = CardDefaults.cardElevation(defaultElevation = 2.dp),
    ) {
        Column(modifier = Modifier.padding(16.dp)) {
            Text(title, fontSize = 15.sp, fontWeight = FontWeight.Bold, color = MaterialTheme.colorScheme.onSurface)
            Spacer(Modifier.height(8.dp))
            items.forEachIndexed { i, item ->
                Row(modifier = Modifier.fillMaxWidth().padding(vertical = 8.dp)) {
                    Text(
                        item.label,
                        modifier = Modifier.weight(1f),
                        color = MaterialTheme.colorScheme.onSurface.copy(alpha = 0.8f),
                    )
                    Text(
                        (if (item.isDeduction) "- " else "") + item.amount,
                        fontWeight = FontWeight.SemiBold,
                        color = if (item.isDeduction) DeductRed else MoneyGreen,
                    )
                }
                if (i < items.lastIndex) HorizontalDivider(color = MaterialTheme.colorScheme.surfaceVariant)
            }
        }
    }
}
