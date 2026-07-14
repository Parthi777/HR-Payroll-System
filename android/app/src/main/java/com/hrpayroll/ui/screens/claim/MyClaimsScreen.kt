package com.hrpayroll.ui.screens.claim

import android.widget.Toast
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
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Add
import androidx.compose.material.icons.filled.FileDownload
import androidx.compose.material.icons.filled.Send
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Card
import androidx.compose.material3.CardDefaults
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.ExtendedFloatingActionButton
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
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

/** Employee's claims: tap a card for full details, clarification thread + reply,
 *  and the printable A5 voucher PDF download. */
@Composable
fun MyClaimsScreen(
    onNew: () -> Unit,
    onResubmit: (String) -> Unit,
    viewModel: MyClaimsViewModel = hiltViewModel(),
) {
    val state by viewModel.uiState.collectAsState()
    val context = LocalContext.current
    var detailId by remember { mutableStateOf<String?>(null) }

    LaunchedEffect(state.notice) {
        state.notice?.let {
            Toast.makeText(context, it, Toast.LENGTH_LONG).show()
            viewModel.consumeNotice()
        }
    }

    // Refresh when returning from submit/resubmit.
    val lifecycleOwner = androidx.compose.ui.platform.LocalLifecycleOwner.current
    androidx.compose.runtime.DisposableEffect(lifecycleOwner) {
        val observer = androidx.lifecycle.LifecycleEventObserver { _, event ->
            if (event == androidx.lifecycle.Lifecycle.Event.ON_RESUME) viewModel.refresh()
        }
        lifecycleOwner.lifecycle.addObserver(observer)
        onDispose { lifecycleOwner.lifecycle.removeObserver(observer) }
    }

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
                        items(state.claims) { claim ->
                            ClaimCard(
                                claim = claim,
                                downloading = state.downloadingId == claim.id,
                                onOpen = { detailId = claim.id },
                                onDownload = { viewModel.downloadVoucher(claim) },
                            )
                        }
                        item { Spacer(Modifier.height(80.dp)) } // clear the FAB
                    }
                }
            }
        }
    }

    val detail = state.claims.firstOrNull { it.id == detailId }
    if (detail != null) {
        ClaimDetailDialog(
            claim = detail,
            replying = state.replyingId == detail.id,
            downloading = state.downloadingId == detail.id,
            onReply = { msg -> detail.id?.let { viewModel.reply(it, msg) } },
            onResubmit = { detail.id?.let { detailId = null; onResubmit(it) } },
            onDownload = { viewModel.downloadVoucher(detail) },
            onDismiss = { detailId = null },
        )
    }
}

@Composable
private fun ClaimCard(
    claim: ClaimDto,
    downloading: Boolean,
    onOpen: () -> Unit,
    onDownload: () -> Unit,
) {
    Card(
        shape = MaterialTheme.shapes.medium,
        colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.surface),
        elevation = CardDefaults.cardElevation(defaultElevation = 2.dp),
        modifier = Modifier.clickable(onClick = onOpen),
    ) {
        Column(modifier = Modifier.fillMaxWidth().padding(14.dp)) {
            Row(verticalAlignment = Alignment.CenterVertically) {
                Column(modifier = Modifier.weight(1f)) {
                    Text(claim.title ?: "Claim", fontWeight = FontWeight.SemiBold, color = MaterialTheme.colorScheme.onSurface)
                    Text(
                        "${claim.type ?: ""} · ₹${claim.amount ?: 0.0} · ${shortDate(claim.createdAt)}",
                        fontSize = 12.sp,
                        color = MaterialTheme.colorScheme.onSurface.copy(alpha = 0.6f),
                    )
                }
                val (fg, bg) = statusColors(claim.status)
                StatusChip(label(claim.status), fg, bg)
                IconButton(onClick = onDownload, enabled = !downloading) {
                    if (downloading) {
                        CircularProgressIndicator(Modifier.size(18.dp), strokeWidth = 2.dp)
                    } else {
                        Icon(
                            Icons.Filled.FileDownload,
                            contentDescription = "Download voucher PDF",
                            tint = MaterialTheme.colorScheme.primary,
                        )
                    }
                }
            }
            if (claim.status == "NEEDS_CLARIFICATION") {
                Spacer(Modifier.height(6.dp))
                Text(
                    "Admin asked: ${claim.reviewerNote ?: "Please provide more details."} · Tap to reply",
                    fontSize = 12.sp,
                    color = StatusLeave,
                )
            }
            if (claim.status == "REJECTED" && claim.reviewerNote != null) {
                Spacer(Modifier.height(6.dp))
                Text("Reason: ${claim.reviewerNote}", fontSize = 12.sp, color = StatusOff)
            }
            if ((claim.status == "APPROVED" || claim.status == "PAID") && claim.reviewerName != null) {
                Spacer(Modifier.height(6.dp))
                Text("Approved by ${claim.reviewerName}", fontSize = 12.sp, color = StatusPresent)
            }
        }
    }
}

/** Full claim details + clarification conversation, matching the printed voucher. */
@Composable
private fun ClaimDetailDialog(
    claim: ClaimDto,
    replying: Boolean,
    downloading: Boolean,
    onReply: (String) -> Unit,
    onResubmit: () -> Unit,
    onDownload: () -> Unit,
    onDismiss: () -> Unit,
) {
    var replyText by remember { mutableStateOf("") }
    val needsClarification = claim.status == "NEEDS_CLARIFICATION"

    AlertDialog(
        onDismissRequest = onDismiss,
        title = {
            Column {
                Text(claim.title ?: "Claim", fontWeight = FontWeight.Bold)
                Text(
                    "Voucher No: CLM-${(claim.id ?: "").takeLast(8).uppercase()}",
                    fontSize = 12.sp,
                    color = MaterialTheme.colorScheme.onSurface.copy(alpha = 0.6f),
                )
            }
        },
        text = {
            Column(modifier = Modifier.verticalScroll(rememberScrollState())) {
                DetailRow("Type", claim.type ?: "—")
                DetailRow("Amount", "₹${claim.amount ?: 0.0}")
                DetailRow("Status", label(claim.status))
                DetailRow("Submitted", fullDate(claim.createdAt))
                DetailRow(
                    if (claim.status == "REJECTED") "Rejected by" else "Approved by",
                    claim.reviewerName?.let { "$it · ${fullDate(claim.reviewedAt)}" } ?: "Pending",
                )
                if (claim.status == "PAID") {
                    DetailRow("Paid by", "${claim.paidByName ?: "—"} · ${fullDate(claim.paidAt)}")
                }
                if (!claim.description.isNullOrBlank()) DetailRow("Description", claim.description)

                val messages = claim.messages.orEmpty()
                if (messages.isNotEmpty()) {
                    Spacer(Modifier.height(10.dp))
                    Text("Clarification thread", fontSize = 12.sp, fontWeight = FontWeight.Bold)
                    Spacer(Modifier.height(6.dp))
                    messages.forEach { m ->
                        val admin = m.senderRole == "ADMIN"
                        Box(
                            modifier = Modifier
                                .fillMaxWidth()
                                .padding(vertical = 3.dp),
                            contentAlignment = if (admin) Alignment.CenterStart else Alignment.CenterEnd,
                        ) {
                            Column(
                                modifier = Modifier
                                    .background(
                                        if (admin) StatusLeaveBg else MaterialTheme.colorScheme.surfaceVariant,
                                        RoundedCornerShape(10.dp),
                                    )
                                    .padding(horizontal = 10.dp, vertical = 6.dp),
                            ) {
                                Text(
                                    "${m.senderName ?: ""} · ${fullDate(m.createdAt)}",
                                    fontSize = 10.sp,
                                    color = MaterialTheme.colorScheme.onSurface.copy(alpha = 0.55f),
                                )
                                Text(m.message ?: "", fontSize = 13.sp)
                            }
                        }
                    }
                }

                if (needsClarification) {
                    Spacer(Modifier.height(10.dp))
                    Row(verticalAlignment = Alignment.CenterVertically) {
                        OutlinedTextField(
                            value = replyText,
                            onValueChange = { replyText = it },
                            label = { Text("Reply to the approver") },
                            modifier = Modifier.weight(1f),
                        )
                        IconButton(
                            onClick = {
                                if (replyText.isNotBlank()) {
                                    onReply(replyText)
                                    replyText = ""
                                }
                            },
                            enabled = !replying && replyText.isNotBlank(),
                        ) {
                            if (replying) {
                                CircularProgressIndicator(Modifier.size(18.dp), strokeWidth = 2.dp)
                            } else {
                                Icon(Icons.Filled.Send, contentDescription = "Send reply", tint = MaterialTheme.colorScheme.primary)
                            }
                        }
                    }
                    Spacer(Modifier.height(6.dp))
                    OutlinedButton(onClick = onResubmit, modifier = Modifier.fillMaxWidth()) {
                        Text("Resubmit with new receipt / details")
                    }
                }
            }
        },
        confirmButton = {
            TextButton(onClick = onDownload, enabled = !downloading) {
                if (downloading) {
                    CircularProgressIndicator(Modifier.size(16.dp), strokeWidth = 2.dp)
                } else {
                    Icon(Icons.Filled.FileDownload, contentDescription = null, modifier = Modifier.size(16.dp))
                }
                Text("  Voucher PDF")
            }
        },
        dismissButton = { TextButton(onClick = onDismiss) { Text("Close") } },
    )
}

@Composable
private fun DetailRow(label: String, value: String) {
    Row(modifier = Modifier.padding(vertical = 3.dp)) {
        Text(
            label,
            fontSize = 12.sp,
            color = MaterialTheme.colorScheme.onSurface.copy(alpha = 0.55f),
            modifier = Modifier.width(92.dp),
        )
        Text(value, fontSize = 13.sp, color = MaterialTheme.colorScheme.onSurface)
    }
}

/** "2026-07-14T09:30:00.000Z" → "14 Jul 2026, 03:00 pm" (device timezone). */
internal fun fullDate(iso: String?): String = runCatching {
    val instant = java.time.Instant.parse(iso ?: return "—")
    java.time.format.DateTimeFormatter.ofPattern("d MMM yyyy, hh:mm a")
        .withZone(java.time.ZoneId.systemDefault())
        .format(instant)
}.getOrDefault(iso?.take(10) ?: "—")

internal fun shortDate(iso: String?): String = runCatching {
    val instant = java.time.Instant.parse(iso ?: return "—")
    java.time.format.DateTimeFormatter.ofPattern("d MMM")
        .withZone(java.time.ZoneId.systemDefault())
        .format(instant)
}.getOrDefault(iso?.take(10) ?: "—")

private fun label(status: String?): String = when (status) {
    "NEEDS_CLARIFICATION" -> "Clarify"
    null -> "—"
    else -> status.lowercase().replaceFirstChar { it.uppercase() }
}

private fun statusColors(status: String?): Pair<androidx.compose.ui.graphics.Color, androidx.compose.ui.graphics.Color> = when (status) {
    "APPROVED", "PAID" -> StatusPresent to StatusPresentBg
    "PENDING" -> StatusHalf to StatusHalfBg
    "REJECTED" -> StatusOff to StatusOffBg
    "NEEDS_CLARIFICATION" -> StatusLeave to StatusLeaveBg
    else -> StatusLeave to StatusLeaveBg
}
