package com.hrpayroll.ui.screens.admin

import androidx.compose.foundation.background
import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.aspectRatio
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Check
import androidx.compose.material.icons.filled.Close
import androidx.compose.material.icons.filled.HelpOutline
import androidx.compose.material.icons.filled.Payments
import androidx.compose.material.icons.filled.PictureAsPdf
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Card
import androidx.compose.material3.CardDefaults
import androidx.compose.material3.FilterChip
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedTextField
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
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.hilt.navigation.compose.hiltViewModel
import coil.compose.AsyncImage
import coil.request.ImageRequest
import com.hrpayroll.data.remote.dto.ClaimDto
import com.hrpayroll.ui.components.BrandHeader
import com.hrpayroll.ui.components.StatusChip
import com.hrpayroll.ui.screens.claim.fullDate
import com.hrpayroll.ui.theme.StatusHalf
import com.hrpayroll.ui.theme.StatusHalfBg
import com.hrpayroll.ui.theme.StatusLeave
import com.hrpayroll.ui.theme.StatusLeaveBg
import com.hrpayroll.ui.theme.StatusOff
import com.hrpayroll.ui.theme.StatusOffBg
import com.hrpayroll.ui.theme.StatusPaid
import com.hrpayroll.ui.theme.StatusPaidBg
import com.hrpayroll.ui.theme.StatusPresent
import com.hrpayroll.ui.theme.StatusPresentBg

/** Admin claims review: filter, see receipt + details, approve / reject / clarify.
 *  Cashier accounts see their branch's claims and mark approved ones as paid. */
@Composable
fun AdminClaimsScreen(viewModel: AdminClaimsViewModel = hiltViewModel()) {
    val state by viewModel.uiState.collectAsState()
    // Pending note dialog: (claimId, action) where action is "reject" | "clarify".
    var noteFor by remember { mutableStateOf<Pair<String, String>?>(null) }
    // Claim awaiting the "mark paid" confirmation.
    var payFor by remember { mutableStateOf<ClaimDto?>(null) }

    Box(modifier = Modifier.fillMaxSize().background(MaterialTheme.colorScheme.background)) {
        Column(modifier = Modifier.fillMaxSize()) {
            BrandHeader(title = if (viewModel.role == "CASHIER") "Claims · Cashier" else "Claims")

            Row(
                modifier = Modifier.fillMaxWidth().horizontalScroll(rememberScrollState()).padding(16.dp, 10.dp),
                horizontalArrangement = Arrangement.spacedBy(8.dp),
            ) {
                CLAIM_FILTERS.forEach { f ->
                    FilterChip(
                        selected = state.filter == f,
                        onClick = { viewModel.setFilter(f) },
                        label = { Text(f.replace('_', ' ').lowercase().replaceFirstChar { it.uppercase() }) },
                    )
                }
            }

            if (state.claims.isEmpty()) {
                Text(
                    state.error ?: "No claims in this view.",
                    fontSize = 13.sp,
                    color = MaterialTheme.colorScheme.onBackground.copy(alpha = 0.6f),
                    modifier = Modifier.padding(16.dp),
                )
            } else {
                LazyColumn(
                    modifier = Modifier.fillMaxSize().padding(horizontal = 16.dp),
                    verticalArrangement = Arrangement.spacedBy(12.dp),
                ) {
                    items(state.claims) { claim ->
                        AdminClaimCard(
                            claim = claim,
                            photoUrl = claim.id?.let(viewModel::photoUrl),
                            authToken = viewModel.authToken,
                            canApprove = viewModel.canApprove,
                            canPay = viewModel.canPay,
                            onApprove = { claim.id?.let(viewModel::approve) },
                            onReject = { claim.id?.let { noteFor = it to "reject" } },
                            onClarify = { claim.id?.let { noteFor = it to "clarify" } },
                            onPay = { payFor = claim },
                        )
                    }
                    item { Spacer(Modifier.height(16.dp)) }
                }
            }
        }
    }

    noteFor?.let { (id, action) ->
        NoteDialog(
            title = if (action == "reject") "Reject claim" else "Request clarification",
            label = if (action == "reject") "Reason" else "What do you need clarified?",
            onConfirm = { note ->
                if (action == "reject") viewModel.reject(id, note) else viewModel.clarify(id, note)
                noteFor = null
            },
            onDismiss = { noteFor = null },
        )
    }

    payFor?.let { claim ->
        PayDialog(
            claim = claim,
            onConfirm = { note ->
                claim.id?.let { viewModel.pay(it, note) }
                payFor = null
            },
            onDismiss = { payFor = null },
        )
    }
}

@Composable
private fun AdminClaimCard(
    claim: ClaimDto,
    photoUrl: String?,
    authToken: String?,
    canApprove: Boolean,
    canPay: Boolean,
    onApprove: () -> Unit,
    onReject: () -> Unit,
    onClarify: () -> Unit,
    onPay: () -> Unit,
) {
    val hasPhoto = claim.photoFileId != null || claim.photoUrl != null
    val hasPdf = claim.documentFileId != null || claim.documentUrl != null
    val open = claim.status == "PENDING" || claim.status == "NEEDS_CLARIFICATION"

    Card(
        shape = MaterialTheme.shapes.medium,
        colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.surface),
        elevation = CardDefaults.cardElevation(defaultElevation = 2.dp),
    ) {
        Column(modifier = Modifier.fillMaxWidth().padding(14.dp)) {
            Row(verticalAlignment = Alignment.CenterVertically) {
                Column(modifier = Modifier.weight(1f)) {
                    Text(claim.title ?: "Claim", fontWeight = FontWeight.Bold, color = MaterialTheme.colorScheme.onSurface)
                    Text(
                        listOfNotNull(
                            claim.employee?.name ?: "Employee",
                            claim.employee?.employeeCode,
                            claim.employee?.branch?.name,
                            claim.type,
                        ).joinToString(" · "),
                        fontSize = 12.sp,
                        color = MaterialTheme.colorScheme.onSurface.copy(alpha = 0.6f),
                    )
                }
                Text("₹${claim.amount ?: 0.0}", fontWeight = FontWeight.Bold, color = MaterialTheme.colorScheme.onSurface)
                Spacer(Modifier.height(0.dp))
            }

            Spacer(Modifier.height(4.dp))
            Text(
                "Voucher CLM-${(claim.id ?: "").takeLast(8).uppercase()} · Submitted ${fullDate(claim.createdAt)}",
                fontSize = 11.sp,
                color = MaterialTheme.colorScheme.onSurface.copy(alpha = 0.5f),
            )

            Spacer(Modifier.height(8.dp))
            val (fg, bg) = statusColors(claim.status)
            Row(verticalAlignment = Alignment.CenterVertically) {
                StatusChip(label(claim.status), fg, bg)
                if (hasPdf) {
                    Spacer(Modifier.height(0.dp))
                    Icon(
                        Icons.Filled.PictureAsPdf,
                        contentDescription = "PDF attached",
                        tint = StatusOff,
                        modifier = Modifier.padding(start = 8.dp).height(18.dp),
                    )
                }
            }

            if (!claim.description.isNullOrBlank()) {
                Spacer(Modifier.height(6.dp))
                Text(claim.description, fontSize = 12.sp, color = MaterialTheme.colorScheme.onSurface.copy(alpha = 0.75f))
            }

            // Receipt photo (loaded with the admin's Bearer token).
            if (hasPhoto && photoUrl != null) {
                Spacer(Modifier.height(10.dp))
                AsyncImage(
                    model = ImageRequest.Builder(LocalContext.current)
                        .data(photoUrl)
                        .apply { authToken?.let { addHeader("Authorization", "Bearer $it") } }
                        .crossfade(true)
                        .build(),
                    contentDescription = "Receipt",
                    contentScale = ContentScale.Crop,
                    modifier = Modifier.fillMaxWidth().aspectRatio(1.6f).clip(RoundedCornerShape(12.dp)),
                )
            }

            // Clarification conversation (approver questions + employee replies).
            val messages = claim.messages.orEmpty()
            if (messages.isNotEmpty()) {
                Spacer(Modifier.height(8.dp))
                messages.forEach { m ->
                    val admin = m.senderRole == "ADMIN"
                    Text(
                        "${if (admin) "Asked" else "Reply"} (${m.senderName ?: ""}): ${m.message ?: ""}",
                        fontSize = 12.sp,
                        color = if (admin) StatusLeave else MaterialTheme.colorScheme.onSurface.copy(alpha = 0.65f),
                        modifier = Modifier.padding(vertical = 2.dp),
                    )
                }
            }

            when {
                claim.status == "APPROVED" && claim.reviewerName != null -> {
                    Spacer(Modifier.height(6.dp))
                    Text(
                        "Approved by ${claim.reviewerName} · ${fullDate(claim.reviewedAt)}",
                        fontSize = 12.sp,
                        color = StatusPresent,
                    )
                }
                claim.status == "PAID" -> {
                    Spacer(Modifier.height(6.dp))
                    Text(
                        "Approved by ${claim.reviewerName ?: "—"} · Paid by ${claim.paidByName ?: "—"} on ${fullDate(claim.paidAt)}",
                        fontSize = 12.sp,
                        color = StatusPresent,
                    )
                }
            }

            if (open && canApprove) {
                Spacer(Modifier.height(8.dp))
                Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                    ActionButton(Icons.Filled.Check, "Approve", StatusPresent, onApprove)
                    ActionButton(Icons.Filled.HelpOutline, "Clarify", StatusLeave, onClarify)
                    ActionButton(Icons.Filled.Close, "Reject", StatusOff, onReject)
                }
            }

            if (claim.status == "APPROVED" && canPay) {
                Spacer(Modifier.height(8.dp))
                androidx.compose.material3.Button(onClick = onPay, modifier = Modifier.fillMaxWidth()) {
                    Icon(Icons.Filled.Payments, contentDescription = null)
                    Text("  Mark as Paid", fontWeight = FontWeight.SemiBold)
                }
            }
        }
    }
}

/** Cashier confirmation: verify the printed voucher against the on-screen details first. */
@Composable
private fun PayDialog(claim: ClaimDto, onConfirm: (String?) -> Unit, onDismiss: () -> Unit) {
    var note by remember { mutableStateOf("") }
    AlertDialog(
        onDismissRequest = onDismiss,
        title = { Text("Mark as paid?") },
        text = {
            Column {
                Text(
                    "₹${claim.amount ?: 0.0} — ${claim.title ?: ""}\nby ${claim.employee?.name ?: ""} (${claim.employee?.employeeCode ?: ""})",
                    fontWeight = FontWeight.SemiBold,
                )
                Spacer(Modifier.height(8.dp))
                Text(
                    "Check the printed voucher copy against these details before handing over the amount.",
                    fontSize = 12.sp,
                )
                Spacer(Modifier.height(10.dp))
                OutlinedTextField(
                    value = note,
                    onValueChange = { note = it },
                    label = { Text("Payment note (optional)") },
                    modifier = Modifier.fillMaxWidth(),
                )
            }
        },
        confirmButton = { TextButton(onClick = { onConfirm(note.ifBlank { null }) }) { Text("Paid ✓") } },
        dismissButton = { TextButton(onClick = onDismiss) { Text("Cancel") } },
    )
}

@Composable
private fun ActionButton(icon: androidx.compose.ui.graphics.vector.ImageVector, desc: String, tint: Color, onClick: () -> Unit) {
    IconButton(onClick = onClick) {
        Icon(icon, contentDescription = desc, tint = tint)
    }
}

@Composable
private fun NoteDialog(title: String, label: String, onConfirm: (String) -> Unit, onDismiss: () -> Unit) {
    var note by remember { mutableStateOf("") }
    AlertDialog(
        onDismissRequest = onDismiss,
        title = { Text(title) },
        text = {
            OutlinedTextField(value = note, onValueChange = { note = it }, label = { Text(label) }, modifier = Modifier.fillMaxWidth())
        },
        confirmButton = { TextButton(onClick = { if (note.isNotBlank()) onConfirm(note) }) { Text("Send") } },
        dismissButton = { TextButton(onClick = onDismiss) { Text("Cancel") } },
    )
}

private fun label(status: String?): String = when (status) {
    "NEEDS_CLARIFICATION" -> "Clarify"
    null -> "—"
    else -> status.lowercase().replaceFirstChar { it.uppercase() }
}

private fun statusColors(status: String?): Pair<Color, Color> = when (status) {
    "APPROVED" -> StatusPresent to StatusPresentBg
    "PAID" -> StatusPaid to StatusPaidBg
    "PENDING" -> StatusHalf to StatusHalfBg
    "REJECTED" -> StatusOff to StatusOffBg
    "NEEDS_CLARIFICATION" -> StatusLeave to StatusLeaveBg
    else -> StatusLeave to StatusLeaveBg
}
