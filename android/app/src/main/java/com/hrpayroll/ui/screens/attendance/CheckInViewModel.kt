package com.hrpayroll.ui.screens.attendance

import androidx.lifecycle.SavedStateHandle
import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.hrpayroll.data.repository.AttendanceRepository
import dagger.hilt.android.lifecycle.HiltViewModel
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.launch
import java.io.File
import javax.inject.Inject

data class CheckInUiState(
    val isSubmitting: Boolean = false,
    val success: Boolean = false,
    val resultStatus: String? = null,
    val error: String? = null,
)

/** Uploads the captured selfie + GPS to the check-in or check-out endpoint
 *  (mode comes from the navigation route: camera/checkin | camera/checkout). */
@HiltViewModel
class CheckInViewModel @Inject constructor(
    private val repository: AttendanceRepository,
    savedStateHandle: SavedStateHandle,
) : ViewModel() {

    val isCheckOut: Boolean = savedStateHandle.get<String>("mode") == "checkout"

    private val _uiState = MutableStateFlow(CheckInUiState())
    val uiState: StateFlow<CheckInUiState> = _uiState.asStateFlow()

    fun submit(selfie: File, lat: Double, lng: Double, accuracy: Float) {
        if (_uiState.value.isSubmitting) return
        viewModelScope.launch {
            _uiState.value = CheckInUiState(isSubmitting = true)
            runCatching {
                if (isCheckOut) repository.checkOut(selfie, lat, lng)
                else repository.checkIn(selfie, lat, lng, accuracy)
            }
                .onSuccess { _uiState.value = CheckInUiState(success = true, resultStatus = it.status) }
                .onFailure {
                    _uiState.value = CheckInUiState(
                        error = it.message ?: if (isCheckOut) "Check-out failed" else "Check-in failed",
                    )
                }
        }
    }

    fun clearError() {
        _uiState.value = _uiState.value.copy(error = null)
    }
}
