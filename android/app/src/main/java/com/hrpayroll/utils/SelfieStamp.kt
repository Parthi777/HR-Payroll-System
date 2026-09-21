package com.hrpayroll.utils

import android.graphics.Bitmap
import android.graphics.Canvas
import android.graphics.Color
import android.graphics.Paint
import android.graphics.Typeface
import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale

/**
 * Burn the punch details onto the photo.
 *
 * A selfie punch skips the geofence and the face match — that is what it is
 * for — so the only thing a manager can weigh it against is what the employee
 * says and what the photo shows. Writing the time and place into the pixels
 * means the evidence travels with the image: forwarded, downloaded, or printed
 * for a dispute six months later, it still says where it came from.
 *
 * It is not proof against a determined forger, and is not meant to be. The
 * coordinates are sent to the server as well, so the stamp can be checked
 * against the record rather than trusted on its own.
 */
object SelfieStamp {

    data class Details(
        val employeeName: String,
        val employeeCode: String,
        val fix: Fix?,
        val address: String?,
        val takenAt: Date = Date(),
    )

    private val stampTime = SimpleDateFormat("dd MMM yyyy · HH:mm", Locale.getDefault())

    /**
     * Returns a new bitmap with a strip along the bottom. The source is left
     * alone — the caller may still be using it.
     */
    fun apply(source: Bitmap, details: Details): Bitmap {
        val lines = buildLines(details)
        val out = source.copy(Bitmap.Config.ARGB_8888, true) ?: return source
        val canvas = Canvas(out)

        // Sized from the image, so the strip reads the same on a cheap phone's
        // camera and a flagship's.
        val scale = out.width / 1000f
        val textSize = 26f * scale
        val padding = 18f * scale
        val lineGap = 9f * scale
        val stripHeight = padding * 2 + lines.size * textSize + (lines.size - 1) * lineGap

        val background = Paint().apply {
            color = Color.argb(168, 0, 0, 0)
            isAntiAlias = true
        }
        canvas.drawRect(0f, out.height - stripHeight, out.width.toFloat(), out.height.toFloat(), background)

        val text = Paint().apply {
            color = Color.WHITE
            isAntiAlias = true
            this.textSize = textSize
            typeface = Typeface.create(Typeface.DEFAULT, Typeface.BOLD)
            // A dark photo behind white text is still readable with this.
            setShadowLayer(2f * scale, 0f, 1f * scale, Color.argb(200, 0, 0, 0))
        }

        var y = out.height - stripHeight + padding + textSize * 0.82f
        lines.forEachIndexed { index, line ->
            text.typeface = Typeface.create(Typeface.DEFAULT, if (index == 0) Typeface.BOLD else Typeface.NORMAL)
            text.alpha = if (index == 0) 255 else 224
            canvas.drawText(line, padding, y, text)
            y += textSize + lineGap
        }
        return out
    }

    /**
     * What the strip says, in the order it matters to whoever is approving:
     * who and when first, then where.
     *
     * A phone with no fix says so in as many words. Leaving the line out would
     * read as though location was never asked for.
     */
    private fun buildLines(details: Details): List<String> {
        val who = listOf(details.employeeName, details.employeeCode)
            .filter { it.isNotBlank() }
            .joinToString(" · ")
        val lines = mutableListOf(
            listOf(who, stampTime.format(details.takenAt)).filter { it.isNotBlank() }.joinToString("  |  "),
        )

        val fix = details.fix
        if (fix != null && fix.hasFix) {
            lines += "%.5f, %.5f  ±%dm".format(Locale.US, fix.lat, fix.lng, fix.accuracy.toInt())
            details.address?.takeIf { it.isNotBlank() }?.let { lines += it }
        } else {
            lines += "Location unavailable"
        }
        return lines
    }
}
