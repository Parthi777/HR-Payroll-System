package com.hrpayroll.ui.screens.shift

import com.hrpayroll.data.remote.userMessage
import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.hrpayroll.data.remote.dto.ScheduleDayDto
import com.hrpayroll.data.repository.EmployeeDataRepository
import dagger.hilt.android.lifecycle.HiltViewModel
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.launch
import javax.inject.Inject

data class ShiftUiState(
    val isLoading: Boolean = false,
    val schedule: List<ScheduleDayDto> = emptyList(),
    val error: String? = null,
)

@HiltViewModel
class ShiftViewModel @Inject constructor(
    private val repository: EmployeeDataRepository,
) : ViewModel() {

    private val _uiState = MutableStateFlow(ShiftUiState())
    val uiState: StateFlow<ShiftUiState> = _uiState.asStateFlow()

    init { refresh() }

    fun refresh() {
        viewModelScope.launch {
            _uiState.value = _uiState.value.copy(isLoading = true, error = null)
            runCatching { repository.mySchedule() }
                .onSuccess { _uiState.value = _uiState.value.copy(isLoading = false, schedule = it) }
                .onFailure { _uiState.value = _uiState.value.copy(isLoading = false, error = it.userMessage()) }
        }
    }
}
