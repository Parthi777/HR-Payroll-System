package com.hrpayroll.utils

import android.content.ContentValues
import android.content.Context
import android.content.Intent
import android.graphics.Bitmap
import android.graphics.BitmapFactory
import android.net.Uri
import android.os.Build
import android.os.Environment
import android.provider.MediaStore
import androidx.core.content.FileProvider
import java.io.ByteArrayOutputStream
import java.io.File

/** Image/file helpers for claim attachments — CamScanner-style optimize + compress. */
object MediaUtils {

    /**
     * Decode the (already edge-cropped/enhanced) scanner image, scale it down to a
     * sane max dimension, and JPEG-compress it — smaller upload, still crisp to read.
     */
    fun compressImage(context: Context, uri: Uri, maxDim: Int = 1600, quality: Int = 70): ByteArray {
        val bitmap = context.contentResolver.openInputStream(uri).use { input ->
            BitmapFactory.decodeStream(input)
        } ?: return ByteArray(0)
        val scaled = scaleDown(bitmap, maxDim)
        return ByteArrayOutputStream().use { out ->
            scaled.compress(Bitmap.CompressFormat.JPEG, quality, out)
            out.toByteArray()
        }
    }

    private fun scaleDown(bmp: Bitmap, maxDim: Int): Bitmap {
        val longest = maxOf(bmp.width, bmp.height)
        if (longest <= maxDim) return bmp
        val ratio = maxDim.toFloat() / longest
        return Bitmap.createScaledBitmap(bmp, (bmp.width * ratio).toInt(), (bmp.height * ratio).toInt(), true)
    }

    /** Read raw bytes from a content Uri (e.g. a picked PDF). */
    fun readBytes(context: Context, uri: Uri): ByteArray =
        context.contentResolver.openInputStream(uri)?.use { it.readBytes() } ?: ByteArray(0)

    /**
     * Save a PDF to the device Downloads (MediaStore on API 29+, app files dir below)
     * and open it in the user's PDF viewer. Returns a user-facing location string.
     */
    fun savePdfToDownloads(context: Context, bytes: ByteArray, filename: String): String {
        val uri: Uri = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
            val values = ContentValues().apply {
                put(MediaStore.Downloads.DISPLAY_NAME, filename)
                put(MediaStore.Downloads.MIME_TYPE, "application/pdf")
                put(MediaStore.Downloads.RELATIVE_PATH, Environment.DIRECTORY_DOWNLOADS)
            }
            val inserted = context.contentResolver.insert(MediaStore.Downloads.EXTERNAL_CONTENT_URI, values)
                ?: throw IllegalStateException("Could not create the download entry")
            context.contentResolver.openOutputStream(inserted)?.use { it.write(bytes) }
            inserted
        } else {
            val dir = File(context.getExternalFilesDir(Environment.DIRECTORY_DOWNLOADS), "")
            dir.mkdirs()
            val file = File(dir, filename)
            file.writeBytes(bytes)
            FileProvider.getUriForFile(context, "${context.packageName}.fileprovider", file)
        }

        runCatching {
            context.startActivity(
                Intent(Intent.ACTION_VIEW).apply {
                    setDataAndType(uri, "application/pdf")
                    addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION or Intent.FLAG_ACTIVITY_NEW_TASK)
                },
            )
        } // no PDF viewer installed — file is still saved
        return "Downloads/$filename"
    }
}
