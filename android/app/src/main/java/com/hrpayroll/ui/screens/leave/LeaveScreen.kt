package com.hrpayroll.ui.screens.leave

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
import androidx.compose.material3.Button
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.Card
import androidx.compose.material3.CardDefaults
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
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
import com.hrpayroll.ui.components.BrandHeader

/** Leave application + balance + status (see CLAUDE.md). TODO: wire to /api/leaves. */
@Composable
fun LeaveScreen() {
    var leaveType by remember { mutableStateOf("") }
    var fromDate by remember { mutableStateOf("") }
    var toDate by remember { mutableStateOf("") }
    var reason by remember { mutableStateOf("") }

    Box(modifier = Modifier.fillMaxSize().background(MaterialTheme.colorScheme.background)) {
        Column(modifier = Modifier.fillMaxSize().verticalScroll(rememberScrollState())) {
            BrandHeader(title = "Leave")

            Card(
                modifier = Modifier
                    .fillMaxWidth()
                    .offset(y = (-24).dp)
                    .padding(horizontal = 16.dp),
                shape = MaterialTheme.shapes.large,
                colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.surface),
                elevation = CardDefaults.cardElevation(defaultElevation = 6.dp),
            ) {
                Column(modifier = Modifier.padding(18.dp)) {
                    // Leave balance summary
                    Row(horizontalArrangement = Arrangement.spacedBy(10.dp)) {
                        BalancePill("CL", "8", Modifier.weight(1f))
                        BalancePill("SL", "5", Modifier.weight(1f))
                        BalancePill("EL", "12", Modifier.weight(1f))
                    }
                    Spacer(Modifier.height(20.dp))

                    Text("Apply for Leave", fontSize = 16.sp, fontWeight = FontWeight.Bold, color = MaterialTheme.colorScheme.onSurface)
                    Spacer(Modifier.height(14.dp))

                    FieldLabel("Leave Type")
                    OutlinedTextField(
                        value = leaveType,
                        onValueChange = { leaveType = it },
                        placeholder = { Text("CL / SL / EL / LOP / Half Day") },
                        singleLine = true,
                        modifier = Modifier.fillMaxWidth(),
                        shape = MaterialTheme.shapes.small,
                    )
                    Spacer(Modifier.height(12.dp))

                    Row(horizontalArrangement = Arrangement.spacedBy(12.dp)) {
                        Column(Modifier.weight(1f)) {
                            FieldLabel("Start Date")
                            OutlinedTextField(
                                value = fromDate,
                                onValueChange = { fromDate = it },
                                placeholder = { Text("dd/mm/yyyy") },
                                singleLine = true,
                                modifier = Modifier.fillMaxWidth(),
                                shape = MaterialTheme.shapes.small,
                            )
                        }
                        Column(Modifier.weight(1f)) {
                            FieldLabel("End Date")
                            OutlinedTextField(
                                value = toDate,
                                onValueChange = { toDate = it },
                                placeholder = { Text("dd/mm/yyyy") },
                                singleLine = true,
                                modifier = Modifier.fillMaxWidth(),
                                shape = MaterialTheme.shapes.small,
                            )
                        }
                    }
                    Spacer(Modifier.height(12.dp))

                    FieldLabel("Reason")
                    OutlinedTextField(
                        value = reason,
                        onValueChange = { reason = it },
                        placeholder = { Text("Enter reason for leave…") },
                        modifier = Modifier.fillMaxWidth().height(110.dp),
                        shape = MaterialTheme.shapes.small,
                    )
                    Spacer(Modifier.height(18.dp))

                    Button(
                        onClick = { /* TODO: POST /api/leaves/apply */ },
                        modifier = Modifier.fillMaxWidth().height(52.dp),
                        shape = MaterialTheme.shapes.medium,
                        colors = ButtonDefaults.buttonColors(containerColor = MaterialTheme.colorScheme.primary),
                    ) { Text("Submit", color = Color.White, fontWeight = FontWeight.SemiBold) }

                    Spacer(Modifier.height(10.dp))
                    OutlinedButton(
                        onClick = { /* clear */ },
                        modifier = Modifier.fillMaxWidth().height(52.dp),
                        shape = MaterialTheme.shapes.medium,
                    ) { Text("Cancel") }
                }
            }
            Spacer(Modifier.height(16.dp))
        }
    }
}

@Composable
private fun FieldLabel(text: String) {
    Text(
        text,
        fontSize = 12.sp,
        fontWeight = FontWeight.Medium,
        color = MaterialTheme.colorScheme.onSurface.copy(alpha = 0.7f),
        modifier = Modifier.padding(bottom = 4.dp),
    )
}

@Composable
private fun BalancePill(label: String, value: String, modifier: Modifier = Modifier) {
    Column(
        modifier = modifier
            .background(MaterialTheme.colorScheme.primaryContainer, MaterialTheme.shapes.small)
            .padding(vertical = 12.dp),
        horizontalAlignment = Alignment.CenterHorizontally,
    ) {
        Text(value, fontSize = 20.sp, fontWeight = FontWeight.Bold, color = MaterialTheme.colorScheme.primary)
        Text(label, fontSize = 11.sp, color = MaterialTheme.colorScheme.onSurface.copy(alpha = 0.7f))
    }
}
