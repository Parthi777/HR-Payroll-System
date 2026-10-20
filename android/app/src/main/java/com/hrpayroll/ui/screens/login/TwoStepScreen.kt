package com.hrpayroll.ui.screens.login

import android.content.ActivityNotFoundException
import android.content.ClipData
import android.content.ClipboardManager
import android.content.Context
import android.content.Intent
import android.net.Uri
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.material3.Card
import androidx.compose.material3.CardDefaults
import androidx.compose.material3.Checkbox
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.hrpayroll.ui.theme.BrandGreen
import com.hrpayroll.ui.theme.StatusPresent

/**
 * The second step of an admin sign-in: every Master Control account signs in
 * with a code from an authenticator app (Google Authenticator or any other) as
 * well as a password.
 *
 * First sign-in sets it up. A QR code is no use here — it would be on the same
 * phone as the app meant to scan it — so "Add to authenticator app" hands the
 * setup link straight to the authenticator, and the key is shown to type in by
 * hand when that does not work.
 */
@Composable
fun TwoStepCard(stage: TwoStepStage, state: LoginUiState, viewModel: LoginViewModel) {
    Card(
        modifier = Modifier.fillMaxWidth(),
        shape = androidx.compose.foundation.shape.RoundedCornerShape(28.dp),
        colors = CardDefaults.cardColors(containerColor = androidx.compose.ui.graphics.Color.White),
        border = androidx.compose.foundation.BorderStroke(1.dp, androidx.compose.ui.graphics.Color(0xFFE8EFEC)),
        elevation = CardDefaults.cardElevation(defaultElevation = 6.dp),
    ) {
        Column(modifier = Modifier.padding(20.dp)) {
            when (stage) {
                is TwoStepStage.Verify -> VerifyStep(stage, state, viewModel)
                is TwoStepStage.Enroll -> EnrollStep(stage, state, viewModel)
                is TwoStepStage.RecoveryCodes -> RecoveryCodesStep(stage.codes, viewModel::finishSignIn)
                is TwoStepStage.RecoveryUsed -> RecoveryUsedStep(stage.left, viewModel::finishSignIn)
            }
            state.error?.let {
                Spacer(Modifier.height(12.dp))
                Text(it, color = MaterialTheme.colorScheme.error, fontSize = 13.sp, fontWeight = FontWeight.Medium)
            }
        }
    }
}

@Composable
private fun VerifyStep(stage: TwoStepStage.Verify, state: LoginUiState, viewModel: LoginViewModel) {
    Text("Two-step verification", fontSize = 18.sp, fontWeight = FontWeight.Bold)
    Spacer(Modifier.height(6.dp))
    Text(
        if (stage.useRecovery) "Enter one of the recovery codes you saved when you set this up. Each works once."
        else "Open your authenticator app and enter the 6-digit code for Kayaazh Payroll.",
        fontSize = 13.sp,
        color = MaterialTheme.colorScheme.onSurfaceVariant,
    )
    Spacer(Modifier.height(14.dp))
    CodeField(state.code, viewModel::onCodeChange, recovery = stage.useRecovery)
    Spacer(Modifier.height(16.dp))
    PrimaryButton(text = "Verify", loading = state.isLoading, onClick = viewModel::submitCode)
    Row(modifier = Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween) {
        TextButton(onClick = viewModel::restartSignIn) { Text("Start again", fontSize = 12.sp) }
        TextButton(onClick = viewModel::toggleRecoveryCode) {
            Text(if (stage.useRecovery) "Use the authenticator app" else "Lost your phone?", fontSize = 12.sp)
        }
    }
}

@Composable
private fun EnrollStep(stage: TwoStepStage.Enroll, state: LoginUiState, viewModel: LoginViewModel) {
    val context = LocalContext.current
    var notice by remember { mutableStateOf<String?>(null) }

    Text("Set up two-step verification", fontSize = 18.sp, fontWeight = FontWeight.Bold)
    Spacer(Modifier.height(6.dp))
    Text(
        "Admin sign-in needs a code from an authenticator app as well as your password. This takes a minute, once.",
        fontSize = 13.sp,
        color = MaterialTheme.colorScheme.onSurfaceVariant,
    )
    Spacer(Modifier.height(14.dp))

    if (stage.secret == null || stage.otpauthUri == null) {
        Text(if (state.isLoading) "Preparing…" else "Could not start setup.", fontSize = 13.sp)
        TextButton(onClick = viewModel::restartSignIn) { Text("Start again") }
        return
    }

    Text("1. Add Kayaazh Payroll to your authenticator app", fontWeight = FontWeight.SemiBold, fontSize = 14.sp)
    Spacer(Modifier.height(8.dp))
    OutlinedButton(
        onClick = {
            // Google Authenticator, Microsoft Authenticator and the rest all
            // register for otpauth:// links.
            try {
                context.startActivity(Intent(Intent.ACTION_VIEW, Uri.parse(stage.otpauthUri)))
            } catch (_: ActivityNotFoundException) {
                notice = "No authenticator app found. Install Google Authenticator from the Play Store, or enter the key below by hand."
            }
        },
        modifier = Modifier.fillMaxWidth(),
    ) { Text("Add to authenticator app") }
    notice?.let {
        Spacer(Modifier.height(6.dp))
        Text(it, fontSize = 12.sp, color = MaterialTheme.colorScheme.error)
    }
    Spacer(Modifier.height(10.dp))
    Text("Or type this key into the app (time-based):", fontSize = 12.sp, color = MaterialTheme.colorScheme.onSurfaceVariant)
    Spacer(Modifier.height(4.dp))
    Row(verticalAlignment = Alignment.CenterVertically) {
        Text(
            stage.secret.chunked(4).joinToString(" "),
            fontFamily = FontFamily.Monospace,
            fontSize = 13.sp,
            modifier = Modifier
                .weight(1f)
                .clip(MaterialTheme.shapes.small)
                .background(MaterialTheme.colorScheme.surfaceVariant)
                .padding(10.dp),
        )
        Spacer(Modifier.width(8.dp))
        TextButton(onClick = { copy(context, "Setup key", stage.secret); notice = "Key copied" }) { Text("Copy") }
    }
    Spacer(Modifier.height(16.dp))
    Text("2. Enter the 6-digit code it shows", fontWeight = FontWeight.SemiBold, fontSize = 14.sp)
    Spacer(Modifier.height(8.dp))
    CodeField(state.code, viewModel::onCodeChange, recovery = false)
    Spacer(Modifier.height(16.dp))
    PrimaryButton(text = "Turn on and sign in", loading = state.isLoading, onClick = viewModel::submitCode)
    TextButton(onClick = viewModel::restartSignIn, modifier = Modifier.fillMaxWidth()) { Text("Start again", fontSize = 12.sp) }
}

/**
 * The recovery codes, shown once — only their hashes are stored. Going on is
 * gated on saying they are saved, because skipping this is only discovered on
 * the day the phone is lost.
 */
@Composable
private fun RecoveryCodesStep(codes: List<String>, onDone: () -> Unit) {
    val context = LocalContext.current
    var saved by remember { mutableStateOf(false) }

    Text("Two-step verification is on", fontSize = 18.sp, fontWeight = FontWeight.Bold, color = StatusPresent)
    Spacer(Modifier.height(6.dp))
    Text(
        "Save these recovery codes somewhere safe that is not this phone. If you lose it, each one signs you in once. They will not be shown again.",
        fontSize = 13.sp,
        color = MaterialTheme.colorScheme.onSurfaceVariant,
    )
    Spacer(Modifier.height(12.dp))
    Column(
        modifier = Modifier
            .fillMaxWidth()
            .clip(MaterialTheme.shapes.small)
            .background(MaterialTheme.colorScheme.surfaceVariant)
            .padding(12.dp),
    ) {
        codes.chunked(2).forEach { pair ->
            Row(modifier = Modifier.fillMaxWidth()) {
                pair.forEach { Text(it, fontFamily = FontFamily.Monospace, fontSize = 13.sp, modifier = Modifier.weight(1f)) }
            }
        }
    }
    Spacer(Modifier.height(8.dp))
    Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
        OutlinedButton(onClick = { copy(context, "Recovery codes", codes.joinToString("\n")) }) { Text("Copy") }
        OutlinedButton(onClick = {
            val send = Intent(Intent.ACTION_SEND).setType("text/plain")
                .putExtra(Intent.EXTRA_SUBJECT, "Kayaazh Payroll recovery codes")
                .putExtra(Intent.EXTRA_TEXT, codes.joinToString("\n"))
            context.startActivity(Intent.createChooser(send, "Save recovery codes"))
        }) { Text("Share / save") }
    }
    Spacer(Modifier.height(8.dp))
    Row(verticalAlignment = Alignment.CenterVertically) {
        Checkbox(checked = saved, onCheckedChange = { saved = it })
        Text("I have saved these codes somewhere safe", fontSize = 13.sp)
    }
    Spacer(Modifier.height(8.dp))
    if (saved) PrimaryButton(text = "Continue", loading = false, onClick = onDone)
}

@Composable
private fun RecoveryUsedStep(left: Int, onDone: () -> Unit) {
    Text("You signed in with a recovery code", fontSize = 18.sp, fontWeight = FontWeight.Bold)
    Spacer(Modifier.height(6.dp))
    Text(
        "That code is now used up. You have $left left. If your phone is lost, ask your Super Admin to reset your two-step verification, then sign in again to set it up on your new phone.",
        fontSize = 13.sp,
        color = MaterialTheme.colorScheme.onSurfaceVariant,
    )
    Spacer(Modifier.height(16.dp))
    PrimaryButton(text = "Continue", loading = false, onClick = onDone)
}

@Composable
private fun CodeField(value: String, onChange: (String) -> Unit, recovery: Boolean) {
    OutlinedTextField(
        value = value,
        onValueChange = onChange,
        label = { Text(if (recovery) "Recovery code" else "Code") },
        placeholder = { Text(if (recovery) "XXXXX-XXXXX" else "123456") },
        singleLine = true,
        shape = MaterialTheme.shapes.small,
        textStyle = MaterialTheme.typography.titleMedium.copy(
            fontFamily = FontFamily.Monospace,
            letterSpacing = if (recovery) 1.sp else 6.sp,
            textAlign = TextAlign.Center,
            color = BrandGreen,
        ),
        keyboardOptions = KeyboardOptions(keyboardType = if (recovery) KeyboardType.Ascii else KeyboardType.NumberPassword),
        modifier = Modifier.fillMaxWidth(),
    )
}

private fun copy(context: Context, label: String, text: String) {
    val clipboard = context.getSystemService(Context.CLIPBOARD_SERVICE) as ClipboardManager
    clipboard.setPrimaryClip(ClipData.newPlainText(label, text))
}
