package com.hrpayroll.ui.screens.claim

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
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Add
import androidx.compose.material3.Card
import androidx.compose.material3.CardDefaults
import androidx.compose.material3.ExtendedFloatingActionButton
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.hilt.navigation.compose.hiltViewModel
import com.hrpayroll.data.remote.dto.ClaimDto
import com.hrpayroll.ui.components.BrandHeader
import com.hrpayroll.ui.components.StatusChip
import com.hrpayroll.ui.theme.StatusHalf
import com.hrpayroll.ui.theme.StatusHalfBg
import com.hrpayroll.ui.theme.StatusLeave
import com.hrpayroll.ui.theme.StatusLeaveBg
import com.hrpayroll.ui.theme.StatusOff
import com.hrpayroll.ui.theme.StatusOffBg
import com.hrpayroll.ui.theme.StatusPresent
import com.hrpayroll.ui.theme.StatusPresentBg

/** Employee's claims with status; clarification-needed items can be resubmitted. */
@Composable
fun MyClaimsScreen(
    onNew: () -> Unit,
    onResubmit: (String) -> Unit,
    viewModel: MyClaimsViewModel = hiltViewModel(),
) {
    val state by viewModel.uiState.collectAsState()

    Scaffold(
        floatingActionButton = {
            ExtendedFloatingActionButton(
                onClick = onNew,
                icon = { Icon(Icons.Filled.Add, contentDescription = null) },
                text = { Text("New Claim") },
                containerColor = MaterialTheme.colorScheme.primary,
            )
        },
    ) { pad ->
        Box(modifier = Modifier.fillMaxSize().padding(pad).background(MaterialTheme.colorScheme.background)) {
            Column(modifier = Modifier.fillMaxSize()) {
                BrandHeader(title = "My Claims")
                Spacer(Modifier.height(8.dp))

                if (state.claims.isEmpty()) {
                    Text(
                        state.error ?: "No claims yet. Tap “New Claim” to submit one.",
                        fontSize = 13.sp,
                        color = MaterialTheme.colorScheme.onBackground.copy(alpha = 0.6f),
                        modifier = Modifier.padding(16.dp),
                    )
                } else {
                    LazyColumn(
                        modifier = Modifier.fillMaxSize().padding(horizontal = 16.dp),
                        verticalArrangement = Arrangement.spacedBy(10.dp),
                    ) {
                        items(state.claims) { ClaimCard(it, onResubmit) }
                        item { Spacer(Modifier.height(80.dp)) } // clear the FAB
                    }
                }
            }
        }
    }
}

@Composable
private fun ClaimCard(claim: ClaimDto, onResubmit: (String) -> Unit) {
    Card(
        shape = MaterialTheme.shapes.medium,
        colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.surface),
        elevation = CardDefaults.cardElevation(defaultElevation = 2.dp),
    ) {
        Column(modifier = Modifier.fillMaxWidth().padding(14.dp)) {
            Row(verticalAlignment = Alignment.CenterVertically) {
                Column(modifier = Modifier.weight(1f)) {
                    Text(claim.title ?: "Claim", fontWeight = FontWeight.SemiBold, color = MaterialTheme.colorScheme.onSurface)
                    Text(
                        "${claim.type ?: ""} · ₹${claim.amount ?: 0.0}",
                        fontSize = 12.sp,
                        color = MaterialTheme.colorScheme.onSurface.copy(alpha = 0.6f),
                    )
                }
                val (fg, bg) = statusColors(claim.status)
                StatusChip(label(claim.status), fg, bg)
            }
            if (claim.status == "NEEDS_CLARIFICATION") {
                Spacer(Modifier.height(8.dp))
                Text(
                    "Admin asked: ${claim.reviewerNote ?: "Please provide more details."}",
                    fontSize = 12.sp,
                    color = StatusLeave,
                )
                Spacer(Modifier.height(8.dp))
                OutlinedButton(onClick = { claim.id?.let(onResubmit) }) { Text("Resubmit") }
            }
            if (claim.status == "REJECTED" && claim.reviewerNote != null) {
                Spacer(Modifier.height(6.dp))
                Text("Reason: ${claim.reviewerNote}", fontSize = 12.sp, color = StatusOff)
            }
        }
    }
}

private fun label(status: String?): String = when (status) {
    "NEEDS_CLARIFICATION" -> "Clarify"
    null -> "—"
    else -> status.lowercase().replaceFirstChar { it.uppercase() }
}

private fun statusColors(status: String?): Pair<androidx.compose.ui.graphics.Color, androidx.compose.ui.graphics.Color> = when (status) {
    "APPROVED" -> StatusPresent to StatusPresentBg
    "PENDING" -> StatusHalf to StatusHalfBg
    "REJECTED" -> StatusOff to StatusOffBg
    "NEEDS_CLARIFICATION" -> StatusLeave to StatusLeaveBg
    else -> StatusLeave to StatusLeaveBg
}
