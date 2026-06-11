package com.hrpayroll.utils

import android.content.Context
import android.graphics.Bitmap
import android.graphics.BitmapFactory
import android.net.Uri
import java.io.ByteArrayOutputStream

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
}
