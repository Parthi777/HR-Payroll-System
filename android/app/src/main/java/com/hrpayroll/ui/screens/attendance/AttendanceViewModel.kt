package com.hrpayroll.ui.screens.attendance

import com.hrpayroll.data.remote.userMessage
import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.hrpayroll.data.remote.dto.AttendanceCalendarResponse
import com.hrpayroll.data.remote.dto.MissingCheckoutDto
import com.hrpayroll.data.repository.AttendanceRepository
import dagger.hilt.android.lifecycle.HiltViewModel
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.launch
import javax.inject.Inject

/** UI model for a single attendance row (decoupled from the network DTO). */
data class AttendanceRecordUi(
    val date: String,
    val checkIn: String,
    val checkOut: String,
    val status: String,
)

data class AttendanceUiState(
    val isLoading: Boolean = false,
    val status: String? = null,
    val error: String? = null,
    val records: List<AttendanceRecordUi> = emptyList(),
    /** True until the first successful network load; the UI shows sample data meanwhile. */
    val usingSampleData: Boolean = true,
    /** Today's state — drives which of the Check-In / Check-Out buttons is enabled. */
    val todayCheckIn: String? = null, // "09:02 AM" or null
    val todayCheckOut: String? = null,
    val todayMinutes: Int? = null, // worked minutes once checked out
    val todayApproval: String? = null, // PENDING = outside geofence, awaiting HR
    /** Month calendar (present/absent view). */
    val calMonth: Int = java.time.LocalDate.now().monthValue,
    val calYear: Int = java.time.LocalDate.now().year,
    val calendar: AttendanceCalendarResponse? = null,
    /** Manual / selfie punch sheet — the fallback when the normal gate can't be met. */
    val manualOpen: Boolean = false,
    val manualBusy: Boolean = false,
    val manualError: String? = null,
    val manualNotice: String? = null,
    /**
     * An earlier day the employee checked in on but never checked out of. While
     * this is set, check-in is blocked (server-side too) until that day's
     * check-out is sent for approval.
     */
    val missingCheckout: MissingCheckoutDto? = null,
    /** The "you forgot to check out" alert, raised when Check In is tapped. */
    val missingPromptOpen: Boolean = false,
    /** Set while the manual punch sheet is settling a specific earlier day. */
    val manualForDay: MissingCheckoutDto? = null,
)

@HiltViewModel
class AttendanceViewModel @Inject constructor(
    private val repository: AttendanceRepository,
) : ViewModel() {

    private val _uiState = MutableStateFlow(AttendanceUiState())
    val uiState: StateFlow<AttendanceUiState> = _uiState.asStateFlow()

    init {
        loadHistory()
        loadCalendar()
    }

    fun loadCalendar() {
        viewModelScope.launch {
            val st = _uiState.value
            runCatching { repository.calendar(st.calMonth, st.calYear) }
                .onSuccess { _uiState.value = _uiState.value.copy(calendar = it) }
        }
    }

    /** Move the calendar one month back/forward (delta = -1 or +1). */
    fun shiftMonth(delta: Int) {
        val st = _uiState.value
        val d = java.time.LocalDate.of(st.calYear, st.calMonth, 1).plusMonths(delta.toLong())
        if (d > java.time.LocalDate.now().withDayOfMonth(1)) return // no future months
        _uiState.value = st.copy(calMonth = d.monthValue, calYear = d.year, calendar = null)
        loadCalendar()
    }

    fun loadHistory() {
        viewModelScope.launch {
            _uiState.value = _uiState.value.copy(isLoading = true, error = null)
            runCatching { repository.history() }
                .onSuccess { dtos ->
                    _uiState.value = _uiState.value.copy(
                        isLoading = false,
                        usingSampleData = false,
                        records = dtos.map {
                            AttendanceRecordUi(
                                date = it.date ?: "—",
                                checkIn = it.checkIn ?: "—",
                                checkOut = it.checkOut ?: "—",
                                status = it.status ?: "Present",
                            )
                        },
                    )
                }
                .onFailure {
                    // Backend not reachable yet — keep sample data, surface the reason.
                    _uiState.value = _uiState.value.copy(isLoading = false, error = it.userMessage())
                }
            loadToday()
        }
    }

    /** One check-in and one check-out per day — reflect today's record in the buttons. */
    private suspend fun loadToday() {
        runCatching { repository.today() }
            .onSuccess { today ->
                _uiState.value = _uiState.value.copy(
                    todayCheckIn = formatIsoTime(today.checkIn),
                    todayCheckOut = formatIsoTime(today.checkOut),
                    todayMinutes = today.workingMinutes,
                    todayApproval = today.approvalStatus,
                )
            }
            .onFailure { /* keep whatever we had; buttons stay enabled */ }

        runCatching { repository.missingCheckout() }
            .onSuccess { _uiState.value = _uiState.value.copy(missingCheckout = it) }
            .onFailure { /* the backend blocks the check-in anyway */ }
    }

    /**
     * Check In was tapped. When an earlier day is still open the employee has
     * to settle it first, so raise the alert instead of opening the camera.
     * Returns true when the check-in may proceed.
     */
    fun onCheckInTapped(): Boolean {
        if (_uiState.value.missingCheckout == null) return true
        _uiState.value = _uiState.value.copy(missingPromptOpen = true)
        return false
    }

    fun dismissMissingPrompt() {
        _uiState.value = _uiState.value.copy(missingPromptOpen = false)
    }

    /** Open the punch sheet pre-filled to settle the day that was left open. */
    fun settleMissingCheckout() {
        val missing = _uiState.value.missingCheckout ?: return
        _uiState.value = _uiState.value.copy(
            missingPromptOpen = false,
            manualOpen = true,
            manualError = null,
            manualForDay = missing,
        )
    }

    /**
     * The general punch sheet. While a day is left open the backend rejects a
     * punch for any later date, so send the employee to settle that day first.
     */
    fun openManualPunch() {
        _uiState.value = _uiState.value.copy(
            manualOpen = true,
            manualError = null,
            manualForDay = _uiState.value.missingCheckout,
        )
    }

    fun closeManualPunch() {
        _uiState.value = _uiState.value.copy(manualOpen = false, manualError = null, manualForDay = null)
    }

    fun consumeManualNotice() {
        _uiState.value = _uiState.value.copy(manualNotice = null)
    }

    /**
     * Raise a manual (typed times) or selfie punch. The backend skips the
     * geofence, face-match and shift-time checks and holds the day for the
     * reporting manager, so it is not paid until they approve it.
     */
    fun submitManualPunch(
        mode: String,
        reason: String,
        checkIn: String?,
        checkOut: String?,
        selfie: ByteArray?,
    ) {
        if (checkIn.isNullOrBlank() && checkOut.isNullOrBlank()) {
            _uiState.value = _uiState.value.copy(manualError = "Enter a check-in time, a check-out time, or both")
            return
        }
        if (reason.trim().length < 3) {
            _uiState.value = _uiState.value.copy(manualError = "Tell your manager why you are raising this punch")
            return
        }
        if (mode == "SELFIE" && selfie == null) {
            _uiState.value = _uiState.value.copy(manualError = "Take a selfie for a selfie punch")
            return
        }

        // Settling a day that was left open? Punch against that date, not today.
        val forDay = _uiState.value.manualForDay
        viewModelScope.launch {
            _uiState.value = _uiState.value.copy(manualBusy = true, manualError = null)
            runCatching {
                repository.manualPunch(
                    mode = mode,
                    reason = reason.trim(),
                    date = forDay?.date ?: java.time.LocalDate.now().toString(),
                    checkIn = checkIn?.takeIf { it.isNotBlank() },
                    checkOut = checkOut?.takeIf { it.isNotBlank() },
                    selfie = selfie,
                )
            }
                .onSuccess {
                    _uiState.value = _uiState.value.copy(
                        manualBusy = false,
                        manualOpen = false,
                        manualForDay = null,
                        // The block lifts as soon as the day is in for approval,
                        // so the employee can check in without waiting.
                        manualNotice = if (forDay != null) {
                            "Check-out for ${forDay.dateLabel ?: "that day"} sent for approval. You can check in now."
                        } else {
                            "Punch sent to your reporting manager for approval."
                        },
                    )
                    loadHistory()
                    loadCalendar()
                }
                .onFailure {
                    _uiState.value = _uiState.value.copy(manualBusy = false, manualError = it.userMessage())
                }
        }
    }

    /** ISO instant → "09:02 AM" in the device timezone (null passes through). */
    private fun formatIsoTime(iso: String?): String? = iso?.let {
        runCatching {
            java.time.format.DateTimeFormatter.ofPattern("hh:mm a")
                .withZone(java.time.ZoneId.systemDefault())
                .format(java.time.Instant.parse(it))
        }.getOrDefault(it)
    }
}
