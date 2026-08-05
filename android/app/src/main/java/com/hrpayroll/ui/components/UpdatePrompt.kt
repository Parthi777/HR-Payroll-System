package com.hrpayroll.ui.components

import android.app.DownloadManager
import android.content.Context
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.LinearProgressIndicator
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import androidx.hilt.navigation.compose.hiltViewModel
import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.hrpayroll.BuildConfig
import com.hrpayroll.data.local.UpdatePrefs
import com.hrpayroll.data.remote.HrApi
import com.hrpayroll.data.remote.dto.AppVersionResponse
import com.hrpayroll.utils.AppUpdater
import dagger.hilt.android.lifecycle.HiltViewModel
import dagger.hilt.android.qualifiers.ApplicationContext
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch
import java.io.File
import javax.inject.Inject

/**
 * Checks the server at launch and offers the newer APK — at most once a day per
 * version, so a device that cannot install is not nagged at every launch.
 */
@HiltViewModel
class UpdateViewModel @Inject constructor(
    private val api: HrApi,
    private val prefs: UpdatePrefs,
    @ApplicationContext private val context: Context,
) : ViewModel() {

    var update by mutableStateOf<AppVersionResponse?>(null)
        private set

    /** 0–100 while the APK is downloading; null when idle. */
    var progress by mutableStateOf<Int?>(null)
        private set

    var error by mutableStateOf<String?>(null)
        private set

    init {
        viewModelScope.launch {
            val v = runCatching { api.appVersion() }.getOrNull() ?: return@launch
            val code = v.versionCode ?: 0
            if (v.available == true && code > BuildConfig.VERSION_CODE && prefs.shouldPrompt(code)) {
                update = v
            }
        }
    }

    /** "Later" — remember the answer so the next launch stays quiet. */
    fun dismiss() {
        update?.versionCode?.let(prefs::snooze)
        update = null
    }

    /** Download (or reuse) the APK, then hand it to the system installer. */
    fun updateNow() {
        val v = update ?: return
        val code = v.versionCode ?: return
        prefs.snoozeWhileUpdating(code)
        error = null

        if (!AppUpdater.canInstall(context)) {
            error = "Turn on \"Allow from this source\" for HR Payroll, then tap Update again."
            AppUpdater.requestInstallPermission(context)
            return
        }

        // An earlier attempt may have already finished the download in the background.
        val done = prefs.downloadIdFor(code)
            ?.let { AppUpdater.progress(context, it) }
            ?.status == DownloadManager.STATUS_SUCCESSFUL
        val file = AppUpdater.apkFile(context, code)
        if (done && file.exists()) {
            install(file)
            return
        }

        val url = v.url
        if (url.isNullOrBlank()) {
            error = "No download link was published. Please contact HR."
            return
        }
        progress = 0
        val id = AppUpdater.enqueue(context, url, code, v.versionName ?: "")
        prefs.rememberDownload(id, code)
        viewModelScope.launch { track(id, file) }
    }

    /** Poll DownloadManager until the APK lands. The download itself outlives this screen. */
    private suspend fun track(id: Long, file: File) {
        while (true) {
            val p = AppUpdater.progress(context, id)
            when {
                p == null -> return fail("The download was cancelled.")
                p.status == DownloadManager.STATUS_SUCCESSFUL -> return install(file)
                p.status == DownloadManager.STATUS_FAILED ->
                    return fail("Download failed. Check your connection and try again.")
                else -> progress = p.percent
            }
            delay(POLL_MS)
        }
    }

    private fun install(file: File) {
        progress = null
        if (AppUpdater.install(context, file)) {
            update = null
        } else {
            error = "Could not open the installer. Tap the finished download in your notifications."
        }
    }

    private fun fail(message: String) {
        progress = null
        error = message
    }

    private companion object {
        const val POLL_MS = 500L
    }
}

/** "Update available" dialog — shown over any screen when a newer APK is published. */
@Composable
fun UpdatePrompt(viewModel: UpdateViewModel = hiltViewModel()) {
    val v = viewModel.update ?: return
    val progress = viewModel.progress
    val downloading = progress != null

    AlertDialog(
        onDismissRequest = { if (!downloading) viewModel.dismiss() },
        title = { Text("Update available") },
        text = {
            Column {
                Text(
                    "A new version${v.versionName?.let { " ($it)" } ?: ""} of HR Payroll is ready. " +
                        "Please update to get the latest features and fixes.",
                )
                if (downloading) {
                    Spacer(Modifier.height(12.dp))
                    LinearProgressIndicator(
                        progress = { (progress ?: 0) / 100f },
                        modifier = Modifier.fillMaxWidth(),
                    )
                    Spacer(Modifier.height(4.dp))
                    Text("Downloading… $progress%", style = MaterialTheme.typography.bodySmall)
                }
                viewModel.error?.let {
                    Spacer(Modifier.height(12.dp))
                    Text(it, color = MaterialTheme.colorScheme.error, style = MaterialTheme.typography.bodySmall)
                }
            }
        },
        confirmButton = {
            TextButton(onClick = { viewModel.updateNow() }, enabled = !downloading) {
                Text(if (viewModel.error != null) "Retry" else "Update now")
            }
        },
        dismissButton = {
            TextButton(onClick = { viewModel.dismiss() }, enabled = !downloading) { Text("Later") }
        },
    )
}
