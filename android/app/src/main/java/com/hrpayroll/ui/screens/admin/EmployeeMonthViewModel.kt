package com.hrpayroll.ui.screens.admin

import androidx.lifecycle.SavedStateHandle
import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.hrpayroll.data.remote.dto.EmployeeMonthDto
import com.hrpayroll.data.remote.userMessage
import com.hrpayroll.data.repository.AdminRepository
import dagger.hilt.android.lifecycle.HiltViewModel
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.launch
import javax.inject.Inject

data class EmployeeMonthUiState(
    val isLoading: Boolean = true,
    val month: Int = java.time.LocalDate.now().monthValue,
    val year: Int = java.time.LocalDate.now().year,
    val data: EmployeeMonthDto? = null,
    val error: String? = null,
)

/** One employee's complete month (GET /admin/reports/employee/:id/month), re-fetched when the month changes. */
@HiltViewModel
class EmployeeMonthViewModel @Inject constructor(
    private val repository: AdminRepository,
    savedStateHandle: SavedStateHandle,
) : ViewModel() {

    private val employeeId: String = checkNotNull(savedStateHandle["employeeId"])

    private val _uiState = MutableStateFlow(
        EmployeeMonthUiState(
            month = savedStateHandle.get<Int>("month")?.takeIf { it in 1..12 } ?: java.time.LocalDate.now().monthValue,
            year = savedStateHandle.get<Int>("year")?.takeIf { it > 2000 } ?: java.time.LocalDate.now().year,
        ),
    )
    val uiState: StateFlow<EmployeeMonthUiState> = _uiState.asStateFlow()

    init { load() }

    fun selectMonth(month: Int, year: Int) {
        _uiState.value = _uiState.value.copy(month = month, year = year)
        load()
    }

    fun load() {
        viewModelScope.launch {
            val s = _uiState.value
            _uiState.value = s.copy(isLoading = true, error = null)
            runCatching { repository.employeeMonth(employeeId, s.month, s.year) }
                .onSuccess { _uiState.value = _uiState.value.copy(isLoading = false, data = it) }
                .onFailure { _uiState.value = _uiState.value.copy(isLoading = false, error = it.userMessage("Couldn't load this month")) }
        }
    }
}
