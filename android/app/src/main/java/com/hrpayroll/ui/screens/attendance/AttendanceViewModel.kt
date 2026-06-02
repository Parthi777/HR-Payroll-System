package com.hrpayroll.ui.screens.attendance

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
                    _uiState.value = _uiState.value.copy(isLoading = false, error = it.message)
                }
        }
    }

}
