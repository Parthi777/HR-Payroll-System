package com.hrpayroll.ui.screens.leave

import com.hrpayroll.data.remote.userMessage
import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.hrpayroll.data.remote.dto.ApplyLeaveRequest
import com.hrpayroll.data.remote.dto.LeaveBalanceDto
import com.hrpayroll.data.remote.dto.LeaveDto
import com.hrpayroll.data.repository.EmployeeDataRepository
import dagger.hilt.android.lifecycle.HiltViewModel
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.launch
import javax.inject.Inject

data class LeaveUiState(
    val isLoading: Boolean = false,
    val isSubmitting: Boolean = false,
    val balances: List<LeaveBalanceDto> = emptyList(),
    val myLeaves: List<LeaveDto> = emptyList(),
    val message: String? = null,
    val error: String? = null,
)

@HiltViewModel
class LeaveViewModel @Inject constructor(
    private val repository: EmployeeDataRepository,
) : ViewModel() {

    private val _uiState = MutableStateFlow(LeaveUiState())
    val uiState: StateFlow<LeaveUiState> = _uiState.asStateFlow()

    init { refresh() }

    fun refresh() {
        viewModelScope.launch {
            _uiState.value = _uiState.value.copy(isLoading = true, error = null)
            runCatching {
                val balances = repository.leaveBalance()
                val leaves = repository.myLeaves()
                balances to leaves
            }.onSuccess { (balances, leaves) ->
                _uiState.value = _uiState.value.copy(isLoading = false, balances = balances, myLeaves = leaves)
            }.onFailure {
                _uiState.value = _uiState.value.copy(isLoading = false, error = it.userMessage())
            }
        }
    }

    fun apply(type: String, fromDate: String, toDate: String, days: Double, reason: String) {
        if (type.isBlank() || fromDate.isBlank() || toDate.isBlank() || reason.isBlank()) {
            _uiState.value = _uiState.value.copy(error = "Please fill all fields")
            return
        }
        viewModelScope.launch {
            _uiState.value = _uiState.value.copy(isSubmitting = true, error = null, message = null)
            runCatching { repository.applyLeave(ApplyLeaveRequest(type, fromDate, toDate, days, reason)) }
                .onSuccess {
                    _uiState.value = _uiState.value.copy(isSubmitting = false, message = "Leave applied ✓")
                    refresh()
                }
                .onFailure { _uiState.value = _uiState.value.copy(isSubmitting = false, error = it.userMessage("Failed to apply")) }
        }
    }
}
