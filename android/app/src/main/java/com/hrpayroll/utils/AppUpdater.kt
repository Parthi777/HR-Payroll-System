package com.hrpayroll.utils

import android.app.DownloadManager
import android.content.Context
import android.content.Intent
import android.net.Uri
import android.os.Build
import android.os.Environment
import android.provider.Settings
import androidx.core.content.FileProvider
import java.io.File

/**
 * Fetches a published APK and hands it to the system installer.
 *
 * The prompt used to just open the signed S3 link in a browser, which left the
 * user to find a ~60 MB file in Downloads and grant the *browser* install
 * rights — many never finished, so the prompt came back at the next launch.
 * DownloadManager survives the app being backgrounded and we open the installer
 * ourselves, so "Update now" is one tap.
 */
object AppUpdater {

    const val APK_MIME = "application/vnd.android.package-archive"

    /** Status of a queued download; mirrors DownloadManager's columns. */
    data class Progress(val status: Int, val downloaded: Long, val total: Long) {
        val percent: Int get() = if (total > 0) ((downloaded * 100) / total).toInt() else 0
    }

    /** Where a download lands — named per version so a stale APK is never installed. */
    fun apkFile(context: Context, versionCode: Int): File =
        File(context.getExternalFilesDir(Environment.DIRECTORY_DOWNLOADS), apkName(versionCode))

    /** Queue the download and return the DownloadManager id to poll. */
    fun enqueue(context: Context, url: String, versionCode: Int, versionName: String): Long {
        val file = apkFile(context, versionCode)
        file.parentFile?.mkdirs()
        // DownloadManager renames to "…-1.apk" instead of overwriting, so clear the way first.
        file.delete()
        clearStaleApks(context, keep = file.name)

        val request = DownloadManager.Request(Uri.parse(url))
            .setTitle("HR Payroll ${versionName.ifBlank { "update" }}")
            .setDescription("Downloading update…")
            .setMimeType(APK_MIME)
            .setNotificationVisibility(DownloadManager.Request.VISIBILITY_VISIBLE_NOTIFY_COMPLETED)
            .setDestinationInExternalFilesDir(context, Environment.DIRECTORY_DOWNLOADS, file.name)
        return manager(context).enqueue(request)
    }

    /** Progress for a queued download, or null once DownloadManager has dropped the row. */
    fun progress(context: Context, id: Long): Progress? =
        runCatching {
            manager(context).query(DownloadManager.Query().setFilterById(id)).use { c ->
                if (!c.moveToFirst()) return null
                Progress(
                    status = c.getInt(c.getColumnIndexOrThrow(DownloadManager.COLUMN_STATUS)),
                    downloaded = c.getLong(c.getColumnIndexOrThrow(DownloadManager.COLUMN_BYTES_DOWNLOADED_SO_FAR)),
                    total = c.getLong(c.getColumnIndexOrThrow(DownloadManager.COLUMN_TOTAL_SIZE_BYTES)),
                )
            }
        }.getOrNull()

    /** Open the system installer for a downloaded APK. False if nothing could handle it. */
    fun install(context: Context, file: File): Boolean = runCatching {
        val uri = FileProvider.getUriForFile(context, "${context.packageName}.fileprovider", file)
        context.startActivity(
            Intent(Intent.ACTION_VIEW).apply {
                setDataAndType(uri, APK_MIME)
                addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION or Intent.FLAG_ACTIVITY_NEW_TASK)
            },
        )
        true
    }.getOrDefault(false)

    /** Android 8+ needs per-app consent before we may launch the installer. */
    fun canInstall(context: Context): Boolean =
        Build.VERSION.SDK_INT < Build.VERSION_CODES.O || context.packageManager.canRequestPackageInstalls()

    /** Send the user to the "Install unknown apps" toggle for this app. */
    fun requestInstallPermission(context: Context): Boolean {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return true
        return runCatching {
            context.startActivity(
                Intent(
                    Settings.ACTION_MANAGE_UNKNOWN_APP_SOURCES,
                    Uri.parse("package:${context.packageName}"),
                ).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK),
            )
            true
        }.getOrDefault(false)
    }

    /** Drop APKs left behind by earlier versions — each one is ~60 MB. */
    private fun clearStaleApks(context: Context, keep: String) {
        context.getExternalFilesDir(Environment.DIRECTORY_DOWNLOADS)
            ?.listFiles { f -> f.name.startsWith(APK_PREFIX) && f.name != keep }
            ?.forEach { it.delete() }
    }

    private fun apkName(versionCode: Int) = "$APK_PREFIX$versionCode.apk"

    private fun manager(context: Context) =
        context.getSystemService(Context.DOWNLOAD_SERVICE) as DownloadManager

    private const val APK_PREFIX = "hr-payroll-update-"
}
