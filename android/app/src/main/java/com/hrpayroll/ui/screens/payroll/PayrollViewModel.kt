package com.hrpayroll.ui.screens.payroll

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.hrpayroll.data.remote.dto.CalendarSummaryDto
import com.hrpayroll.data.remote.dto.PayslipDto
import com.hrpayroll.data.remote.userMessage
import com.hrpayroll.data.repository.AttendanceRepository
import com.hrpayroll.data.repository.EmployeeDataRepository
import dagger.hilt.android.lifecycle.HiltViewModel
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.launch
import java.time.LocalDate
import javax.inject.Inject

data class PayrollUiState(
    val isLoading: Boolean = true,
    val month: Int = LocalDate.now().monthValue,
    val year: Int = LocalDate.now().year,
    /** The chosen month's days, counted by the server's own classifier. */
    val summary: CalendarSummaryDto? = null,
    /** Every payslip this employee has, newest first. */
    val payslips: List<PayslipDto> = emptyList(),
    val error: String? = null,
) {
    /** The payslip for the month on screen, when payroll has been run for it. */
    val slipForMonth: PayslipDto?
        get() = payslips.firstOrNull { it.month == month && it.year == year }

    val isCurrentMonth: Boolean
        get() = month == LocalDate.now().monthValue && year == LocalDate.now().year
}

/**
 * What an employee is owed, and the days behind it.
 *
 * The figures come from the same month endpoint the attendance calendar draws,
 * so this screen cannot disagree with that one. Overtime and pay are read from
 * the payslip rather than recomputed here: the OT rule (duty past the shift's
 * close, ten OT hours to a day) belongs to the payroll engine, and a second
 * implementation on a phone would eventually contradict the first.
 */
@HiltViewModel
class PayrollViewModel @Inject constructor(
    private val attendanceRepo: AttendanceRepository,
    private val employeeRepo: EmployeeDataRepository,
) : ViewModel() {

    private val _uiState = MutableStateFlow(PayrollUiState())
    val uiState: StateFlow<PayrollUiState> = _uiState.asStateFlow()

    init { refresh() }

    fun refresh() {
        viewModelScope.launch {
            val st = _uiState.value
            _uiState.value = st.copy(isLoading = true, error = null)

            val summary = runCatching { attendanceRepo.calendar(st.month, st.year) }
            // Payslips rarely change; keep the ones already loaded if this fails.
            val slips = runCatching { employeeRepo.myPayslips() }.getOrNull() ?: _uiState.value.payslips

            _uiState.value = _uiState.value.copy(
                isLoading = false,
                summary = summary.getOrNull()?.summary,
                payslips = slips,
                error = summary.exceptionOrNull()?.userMessage(),
            )
        }
    }

    /** Step a month back or forward. There is nothing to show for a future month. */
    fun shiftMonth(delta: Int) {
        val st = _uiState.value
        val moved = LocalDate.of(st.year, st.month, 1).plusMonths(delta.toLong())
        if (moved > LocalDate.now().withDayOfMonth(1)) return
        _uiState.value = st.copy(month = moved.monthValue, year = moved.year, summary = null)
        refresh()
    }
}
