package com.hrpayroll.data.remote

import org.json.JSONObject
import retrofit2.HttpException

/**
 * Human-readable error for the UI. HTTP errors surface the backend's
 * { message } (e.g. "Your face is not enrolled yet…") instead of "HTTP 403";
 * anything else falls back to the exception message, then [fallback].
 */
fun Throwable.userMessage(fallback: String = "Something went wrong"): String {
    if (this is HttpException) {
        val parsed = runCatching {
            response()?.errorBody()?.string()?.let { JSONObject(it).optString("message") }
        }.getOrNull()
        return if (parsed.isNullOrBlank()) fallback else parsed
    }
    return message?.takeIf { it.isNotBlank() } ?: fallback
}
