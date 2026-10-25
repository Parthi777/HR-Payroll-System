package com.hrpayroll.ui.screens.attendance

import androidx.lifecycle.SavedStateHandle
import com.hrpayroll.data.remote.userMessage
import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.hrpayroll.data.repository.AttendanceRepository
import com.hrpayroll.data.repository.TrackingController
import com.hrpayroll.utils.formatIsoTime
import dagger.hilt.android.lifecycle.HiltViewModel
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.launch
import kotlinx.coroutines.withTimeoutOrNull
import java.io.File
import javax.inject.Inject

data class CheckInUiState(
    val isSubmitting: Boolean = false,
    val success: Boolean = false,
    val resultStatus: String? = null, // PRESENT | LATE | ...
    val approvalStatus: String? = null, // PENDING when late / out-of-zone
    /** "09:02 AM" — the punch time the server recorded, for the confirmation dialog. */
    val timeLabel: String? = null,
    /** Check-in: the dealer tracks this day, and monitoring has begun. */
    val trackingStarted: Boolean = false,
    /** Check-out: the day was tracked, and monitoring has now stopped. */
    val trackingStopped: Boolean = false,
    val error: String? = null,
    /**
     * Set when an earlier day was left open — check-in is refused until that
     * day's check-out is sent for approval, so there is no point taking a selfie.
     */
    val blockedMessage: String? = null,
)

/** Uploads the captured selfie + GPS to the check-in or check-out endpoint
 *  (mode comes from the navigation route: camera/checkin | camera/checkout). */
@HiltViewModel
class CheckInViewModel @Inject constructor(
    private val repository: AttendanceRepository,
    private val tracking: TrackingController,
    savedStateHandle: SavedStateHandle,
) : ViewModel() {

    val isCheckOut: Boolean = savedStateHandle.get<String>("mode") == "checkout"

    private val _uiState = MutableStateFlow(CheckInUiState())
    val uiState: StateFlow<CheckInUiState> = _uiState.asStateFlow()

    init {
        // Catch a day left open before the camera is used, not after — the
        // backend refuses the check-in either way.
        if (!isCheckOut) {
            viewModelScope.launch {
                runCatching { repository.missingCheckout() }
                    .onSuccess { missing ->
                        if (missing != null) {
                            _uiState.value = _uiState.value.copy(
                                blockedMessage = "You checked in on ${missing.dateLabel ?: "an earlier day"}" +
                                    (missing.checkIn?.let { " at $it" } ?: "") +
                                    " but never checked out. Open Attendance → \"Can't check in/out?\" and send that " +
                                    "day's check-out time for approval — then you can check in.",
                            )
                        }
                    }
            }
        }
    }

    fun submit(selfie: File, lat: Double, lng: Double, accuracy: Float) {
        if (_uiState.value.isSubmitting) return
        viewModelScope.launch {
            _uiState.value = CheckInUiState(isSubmitting = true)
            // Send the day's last fixes before closing it, so they land inside
            // the window; anything that misses is still accepted a little late.
            if (isCheckOut) withTimeoutOrNull(3_000) { runCatching { tracking.flush() } }
            runCatching {
                if (isCheckOut) repository.checkOut(selfie, lat, lng)
                else repository.checkIn(selfie, lat, lng, accuracy)
            }
                .onSuccess {
                    var started = false
                    var stopped = false
                    if (isCheckOut) {
                        stopped = tracking.isActive.value || it.tracking?.wasTracked == true
                        tracking.stop()
                    } else if (it.tracking?.enabled == true && it.id != null) {
                        // Still in the foreground — Android only lets a location
                        // service start from here, not later in the background.
                        tracking.start(it.id, it.tracking.intervalSec)
                        started = true
                    }
                    _uiState.value = CheckInUiState(
                        success = true,
                        resultStatus = it.status,
                        approvalStatus = it.approvalStatus,
                        timeLabel = formatIsoTime(if (isCheckOut) it.checkOut else it.checkIn),
                        trackingStarted = started,
                        trackingStopped = stopped,
                    )
                }
                .onFailure {
                    _uiState.value = CheckInUiState(
                        error = it.userMessage(if (isCheckOut) "Check-out failed" else "Check-in failed"),
                    )
                }
        }
    }

    fun clearError() {
        _uiState.value = _uiState.value.copy(error = null)
    }
}
