package com.hrpayroll.ui.screens.attendance

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

/** Uploads the captured selfie + GPS to the backend check-in endpoint. */
@HiltViewModel
class CheckInViewModel @Inject constructor(
    private val repository: AttendanceRepository,
) : ViewModel() {

    private val _uiState = MutableStateFlow(CheckInUiState())
    val uiState: StateFlow<CheckInUiState> = _uiState.asStateFlow()

    fun submit(selfie: File, lat: Double, lng: Double, accuracy: Float) {
        if (_uiState.value.isSubmitting) return
        viewModelScope.launch {
            _uiState.value = CheckInUiState(isSubmitting = true)
            runCatching { repository.checkIn(selfie, lat, lng, accuracy) }
                .onSuccess { _uiState.value = CheckInUiState(success = true, resultStatus = it.status) }
                .onFailure { _uiState.value = CheckInUiState(error = it.message ?: "Check-in failed") }
        }
    }

    fun clearError() {
        _uiState.value = _uiState.value.copy(error = null)
    }
}
