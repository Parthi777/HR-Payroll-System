package com.hrpayroll.ui.screens.claim

import android.app.Activity
import android.widget.Toast
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.IntentSenderRequest
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.background
import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.CheckCircle
import androidx.compose.material.icons.filled.DocumentScanner
import androidx.compose.material.icons.filled.PictureAsPdf
import androidx.compose.material3.Button
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.FilterChip
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.hilt.navigation.compose.hiltViewModel
import com.google.mlkit.vision.documentscanner.GmsDocumentScanning
import com.google.mlkit.vision.documentscanner.GmsDocumentScannerOptions
import com.google.mlkit.vision.documentscanner.GmsDocumentScanningResult
import com.hrpayroll.ui.components.BrandHeader
import com.hrpayroll.ui.theme.StatusPresent
import com.hrpayroll.utils.MediaUtils

/** Submit a new claim (or resubmit after clarification). Receipt is captured via the
 *  ML Kit Document Scanner (CamScanner-style crop + enhance) then compressed. */
@Composable
fun ClaimSubmitScreen(
    onSubmitted: () -> Unit,
    onBack: () -> Unit,
    viewModel: ClaimSubmitViewModel = hiltViewModel(),
) {
    val state by viewModel.uiState.collectAsState()
    val context = LocalContext.current

    LaunchedEffect(state.done) { if (state.done) onSubmitted() }

    val scannerLauncher = rememberLauncherForActivityResult(
        ActivityResultContracts.StartIntentSenderForResult(),
    ) { result ->
        if (result.resultCode == Activity.RESULT_OK) {
            val scan = GmsDocumentScanningResult.fromActivityResultIntent(result.data)
            scan?.pages?.firstOrNull()?.imageUri?.let { uri ->
                viewModel.onPhoto(MediaUtils.compressImage(context, uri))
            }
        }
    }

    val pdfLauncher = rememberLauncherForActivityResult(ActivityResultContracts.OpenDocument()) { uri ->
        uri?.let { viewModel.onPdf(MediaUtils.readBytes(context, it)) }
    }

    fun startScan() {
        val activity = context as? Activity ?: return
        val options = GmsDocumentScannerOptions.Builder()
            .setGalleryImportAllowed(true)
            .setPageLimit(1)
            .setResultFormats(GmsDocumentScannerOptions.RESULT_FORMAT_JPEG)
            .setScannerMode(GmsDocumentScannerOptions.SCANNER_MODE_FULL)
            .build()
        GmsDocumentScanning.getClient(options).getStartScanIntent(activity)
            .addOnSuccessListener { sender ->
                scannerLauncher.launch(IntentSenderRequest.Builder(sender).build())
            }
            .addOnFailureListener {
                Toast.makeText(context, "Scanner unavailable: ${it.message}", Toast.LENGTH_LONG).show()
            }
    }

    Box(modifier = Modifier.fillMaxSize().background(MaterialTheme.colorScheme.background)) {
        Column(modifier = Modifier.fillMaxSize().verticalScroll(rememberScrollState())) {
            BrandHeader(title = if (state.isResubmit) "Resubmit Claim" else "New Claim", onBack = onBack)

            Column(modifier = Modifier.padding(16.dp)) {
                if (!state.isResubmit) {
                    ClaimTypeDropdown(selected = state.type, onSelect = viewModel::onType)
                    Spacer(Modifier.height(16.dp))
                    OutlinedTextField(
                        value = state.title,
                        onValueChange = viewModel::onTitle,
                        label = { Text("Title (e.g. Client visit cab)") },
                        singleLine = true,
                        modifier = Modifier.fillMaxWidth(),
                    )
                    Spacer(Modifier.height(12.dp))
                    OutlinedTextField(
                        value = state.amount,
                        onValueChange = viewModel::onAmount,
                        label = { Text("Amount (₹)") },
                        singleLine = true,
                        keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Decimal),
                        modifier = Modifier.fillMaxWidth(),
                    )
                    Spacer(Modifier.height(12.dp))
                }

                OutlinedTextField(
                    value = state.description,
                    onValueChange = viewModel::onDescription,
                    label = { Text(if (state.isResubmit) "Updated details" else "Description (optional)") },
                    modifier = Modifier.fillMaxWidth(),
                )

                if (state.isResubmit) {
                    Spacer(Modifier.height(12.dp))
                    OutlinedTextField(
                        value = state.note,
                        onValueChange = viewModel::onNote,
                        label = { Text("Reply to admin's clarification") },
                        modifier = Modifier.fillMaxWidth(),
                    )
                }

                Spacer(Modifier.height(20.dp))
                AttachRow(
                    icon = { Icon(Icons.Filled.DocumentScanner, contentDescription = null) },
                    label = if (state.hasPhoto) "Receipt scanned ✓" else "Scan Receipt",
                    done = state.hasPhoto,
                    onClick = ::startScan,
                )
                Spacer(Modifier.height(10.dp))
                AttachRow(
                    icon = { Icon(Icons.Filled.PictureAsPdf, contentDescription = null) },
                    label = if (state.hasPdf) "PDF attached ✓" else "Attach PDF",
                    done = state.hasPdf,
                    onClick = { pdfLauncher.launch(arrayOf("application/pdf")) },
                )

                state.error?.let {
                    Spacer(Modifier.height(14.dp))
                    Text(it, color = Color(0xFFE11D48), fontSize = 13.sp)
                }

                Spacer(Modifier.height(24.dp))
                Button(
                    onClick = viewModel::submit,
                    enabled = !state.isLoading,
                    modifier = Modifier.fillMaxWidth().height(52.dp),
                    shape = MaterialTheme.shapes.medium,
                ) {
                    if (state.isLoading) {
                        CircularProgressIndicator(modifier = Modifier.height(22.dp), color = Color.White, strokeWidth = 2.dp)
                    } else {
                        Text(if (state.isResubmit) "Resubmit" else "Submit Claim", fontWeight = FontWeight.Bold)
                    }
                }
                Spacer(Modifier.height(24.dp))
            }
        }
    }
}

/**
 * Expense-head picker. The list is long (20 heads), so the menu is a plain
 * scrollable list of labels rather than label + hint.
 */
@OptIn(androidx.compose.material3.ExperimentalMaterial3Api::class)
@Composable
private fun ClaimTypeDropdown(selected: String, onSelect: (String) -> Unit) {
    var expanded by remember { mutableStateOf(false) }
    androidx.compose.material3.ExposedDropdownMenuBox(
        expanded = expanded,
        onExpandedChange = { expanded = it },
    ) {
        OutlinedTextField(
            value = claimTypeLabel(selected),
            onValueChange = {},
            readOnly = true,
            label = { Text("Claim type") },
            supportingText = { Text("Pick the expense head this bill belongs to") },
            trailingIcon = { androidx.compose.material3.ExposedDropdownMenuDefaults.TrailingIcon(expanded = expanded) },
            modifier = Modifier.fillMaxWidth().menuAnchor(),
        )
        ExposedDropdownMenu(
            expanded = expanded,
            onDismissRequest = { expanded = false },
            modifier = Modifier.heightIn(max = 380.dp),
        ) {
            CLAIM_TYPES.forEach { t ->
                androidx.compose.material3.DropdownMenuItem(
                    text = {
                        Text(
                            t.label,
                            fontWeight = if (t.code == selected) FontWeight.Bold else FontWeight.Normal,
                        )
                    },
                    onClick = {
                        onSelect(t.code)
                        expanded = false
                    },
                )
            }
        }
    }
}

@Composable
private fun AttachRow(icon: @Composable () -> Unit, label: String, done: Boolean, onClick: () -> Unit) {
    OutlinedButton(onClick = onClick, modifier = Modifier.fillMaxWidth().height(52.dp), shape = MaterialTheme.shapes.medium) {
        if (done) Icon(Icons.Filled.CheckCircle, contentDescription = null, tint = StatusPresent) else icon()
        Spacer(Modifier.height(0.dp))
        Text("   $label")
    }
}
