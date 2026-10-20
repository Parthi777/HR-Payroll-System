package com.hrpayroll.ui.screens.payroll

import android.content.Context
import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.hrpayroll.data.remote.dto.CalendarSummaryDto
import com.hrpayroll.data.remote.dto.PayslipDto
import com.hrpayroll.data.remote.userMessage
import com.hrpayroll.data.repository.AttendanceRepository
import com.hrpayroll.data.repository.EmployeeDataRepository
import com.hrpayroll.utils.MediaUtils
import dagger.hilt.android.lifecycle.HiltViewModel
import dagger.hilt.android.qualifiers.ApplicationContext
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.launch
import java.time.LocalDate
import java.time.YearMonth
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
    /** The payslip PDF being fetched, by id. */
    val downloadingSlipId: String? = null,
    val downloadingStatement: Boolean = false,
    /** One-shot message after a download ("Saved to Downloads/…"). */
    val notice: String? = null,
) {
    /** The payslip for the month on screen, when payroll has been run for it. */
    val slipForMonth: PayslipDto?
        get() = payslips.firstOrNull { it.month == month && it.year == year }

    /** The last two years, newest first; the server refuses a month before the employee started. */
    val months: List<Pair<Int, Int>>
        get() = (0 until 24).map { YearMonth.now().minusMonths(it.toLong()) }.map { it.monthValue to it.year }
}

/**
 * What an employee is owed, and the days behind it — shown only while the
 * dealer shares payroll with staff. Payslips and the monthly punch/leave
 * statement download as PDFs into Downloads.
 *
 * The figures come from the same month endpoint the attendance calendar draws,
 * so this screen cannot disagree with that one. Pay is read from the payslip
 * rather than recomputed here: the rules belong to the payroll engine.
 */
@HiltViewModel
class PayrollViewModel @Inject constructor(
    private val attendanceRepo: AttendanceRepository,
    private val employeeRepo: EmployeeDataRepository,
    @ApplicationContext private val appContext: Context,
) : ViewModel() {

    private val _uiState = MutableStateFlow(PayrollUiState())
    val uiState: StateFlow<PayrollUiState> = _uiState.asStateFlow()

    init { refresh() }

    fun refresh() {
        viewModelScope.launch {
            val st = _uiState.value
            _uiState.value = st.copy(isLoading = true, error = null)

            val summary = runCatching { attendanceRepo.calendar(st.month, st.year) }
            val slips = runCatching { employeeRepo.myPayslips() }

            _uiState.value = _uiState.value.copy(
                isLoading = false,
                summary = summary.getOrNull()?.summary,
                // Payslips rarely change; keep the ones already loaded if this fails.
                payslips = slips.getOrNull() ?: _uiState.value.payslips,
                // A refusal here means the dealer has stopped sharing payroll.
                error = slips.exceptionOrNull()?.userMessage() ?: summary.exceptionOrNull()?.userMessage(),
            )
        }
    }

    fun selectMonth(month: Int, year: Int) {
        _uiState.value = _uiState.value.copy(month = month, year = year, summary = null)
        refresh()
    }

    /** The payslip PDF, saved to Downloads and opened. */
    fun downloadPayslip(slip: PayslipDto) {
        val id = slip.id ?: return
        viewModelScope.launch {
            _uiState.value = _uiState.value.copy(downloadingSlipId = id)
            runCatching {
                val bytes = employeeRepo.payslipPdf(id)
                MediaUtils.savePdfToDownloads(appContext, bytes, "payslip-${slip.year}-${"%02d".format(slip.month ?: 0)}.pdf")
            }
                .onSuccess { path -> _uiState.value = _uiState.value.copy(downloadingSlipId = null, notice = "Payslip saved to $path") }
                .onFailure { _uiState.value = _uiState.value.copy(downloadingSlipId = null, notice = it.userMessage("Download failed")) }
        }
    }

    /** Every punch-in, punch-out and leave of the chosen month, as a PDF. */
    fun downloadStatement() {
        val st = _uiState.value
        viewModelScope.launch {
            _uiState.value = st.copy(downloadingStatement = true)
            runCatching {
                val bytes = employeeRepo.statementPdf(st.month, st.year)
                MediaUtils.savePdfToDownloads(appContext, bytes, "statement-${st.year}-${"%02d".format(st.month)}.pdf")
            }
                .onSuccess { path -> _uiState.value = _uiState.value.copy(downloadingStatement = false, notice = "Statement saved to $path") }
                .onFailure { _uiState.value = _uiState.value.copy(downloadingStatement = false, notice = it.userMessage("Download failed")) }
        }
    }

    fun consumeNotice() {
        _uiState.value = _uiState.value.copy(notice = null)
    }
}
