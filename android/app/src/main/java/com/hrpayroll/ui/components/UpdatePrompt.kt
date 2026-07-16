package com.hrpayroll.ui.components

import android.content.Intent
import android.net.Uri
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import androidx.compose.ui.platform.LocalContext
import androidx.hilt.navigation.compose.hiltViewModel
import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.hrpayroll.BuildConfig
import com.hrpayroll.data.remote.HrApi
import com.hrpayroll.data.remote.dto.AppVersionResponse
import dagger.hilt.android.lifecycle.HiltViewModel
import kotlinx.coroutines.launch
import javax.inject.Inject

/** Checks the server once at launch; exposes the update info when newer than installed. */
@HiltViewModel
class UpdateViewModel @Inject constructor(private val api: HrApi) : ViewModel() {
    var update by mutableStateOf<AppVersionResponse?>(null)
        private set

    init {
        viewModelScope.launch {
            runCatching { api.appVersion() }.onSuccess { v ->
                if (v.available == true && (v.versionCode ?: 0) > BuildConfig.VERSION_CODE) update = v
            }
        }
    }

    fun dismiss() { update = null }
}

/** "Update available" dialog — shown over any screen when a newer APK is published. */
@Composable
fun UpdatePrompt(viewModel: UpdateViewModel = hiltViewModel()) {
    val context = LocalContext.current
    val v = viewModel.update ?: return
    AlertDialog(
        onDismissRequest = { viewModel.dismiss() },
        title = { Text("Update available") },
        text = {
            Text(
                "A new version${v.versionName?.let { " ($it)" } ?: ""} of HR Payroll is ready. " +
                    "Please update to get the latest features and fixes.",
            )
        },
        confirmButton = {
            TextButton(onClick = {
                v.url?.let { context.startActivity(Intent(Intent.ACTION_VIEW, Uri.parse(it))) }
                viewModel.dismiss()
            }) { Text("Update now") }
        },
        dismissButton = { TextButton(onClick = { viewModel.dismiss() }) { Text("Later") } },
    )
}
