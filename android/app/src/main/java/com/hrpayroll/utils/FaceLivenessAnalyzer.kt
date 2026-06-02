package com.hrpayroll.utils

import com.google.mlkit.vision.face.Face
import com.google.mlkit.vision.face.FaceDetection
import com.google.mlkit.vision.face.FaceDetectorOptions

/**
 * ML Kit liveness helpers: exactly-one-face check + blink/smile prompts.
 * See CLAUDE.md "Selfie Attendance" rules.
 */
object FaceLivenessAnalyzer {

    val detector by lazy {
        val options = FaceDetectorOptions.Builder()
            .setPerformanceMode(FaceDetectorOptions.PERFORMANCE_MODE_ACCURATE)
            .setClassificationMode(FaceDetectorOptions.CLASSIFICATION_MODE_ALL) // eyes open + smile
            .build()
        FaceDetection.getClient(options)
    }

    /** Exactly one face required — no group selfies. */
    fun isSingleFace(faces: List<Face>): Boolean = faces.size == 1

    fun isBlinking(face: Face): Boolean {
        val left = face.leftEyeOpenProbability ?: return false
        val right = face.rightEyeOpenProbability ?: return false
        return left < 0.3f && right < 0.3f
    }

    fun isSmiling(face: Face): Boolean = (face.smilingProbability ?: 0f) > 0.7f
}
