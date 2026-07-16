package com.hrpayroll.ui.screens.attendance

import com.hrpayroll.data.remote.userMessage
import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
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
)

@HiltViewModel
class AttendanceViewModel @Inject constructor(
    private val repository: AttendanceRepository,
) : ViewModel() {

    private val _uiState = MutableStateFlow(AttendanceUiState())
    val uiState: StateFlow<AttendanceUiState> = _uiState.asStateFlow()

    init {
        loadHistory()
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
