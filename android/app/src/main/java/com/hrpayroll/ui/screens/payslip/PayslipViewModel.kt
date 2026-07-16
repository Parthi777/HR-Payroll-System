package com.hrpayroll.ui.screens.payslip

import com.hrpayroll.data.remote.userMessage
import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.hrpayroll.data.remote.dto.PayslipDto
import com.hrpayroll.data.repository.EmployeeDataRepository
import dagger.hilt.android.lifecycle.HiltViewModel
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.launch
import javax.inject.Inject

data class PayslipUiState(
    val isLoading: Boolean = false,
    val payslips: List<PayslipDto> = emptyList(),
    val error: String? = null,
)

@HiltViewModel
class PayslipViewModel @Inject constructor(
    private val repository: EmployeeDataRepository,
) : ViewModel() {

    private val _uiState = MutableStateFlow(PayslipUiState())
    val uiState: StateFlow<PayslipUiState> = _uiState.asStateFlow()

    init { refresh() }

    fun refresh() {
        viewModelScope.launch {
            _uiState.value = _uiState.value.copy(isLoading = true, error = null)
            runCatching { repository.myPayslips() }
                .onSuccess { _uiState.value = _uiState.value.copy(isLoading = false, payslips = it) }
                .onFailure { _uiState.value = _uiState.value.copy(isLoading = false, error = it.userMessage()) }
        }
    }
}
