package com.hrpayroll.ui.screens.admin

import com.hrpayroll.data.remote.userMessage
import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.hrpayroll.data.remote.dto.AttendanceApprovalDto
import com.hrpayroll.data.remote.dto.DailyRowDto
import com.hrpayroll.data.remote.dto.DailySummaryDto
import com.hrpayroll.data.remote.dto.MonthSummaryResponse
import com.hrpayroll.data.repository.AdminRepository
import dagger.hilt.android.lifecycle.HiltViewModel
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.launch
import java.time.LocalDate
import javax.inject.Inject

data class LiveAttendanceUiState(
    val isLoading: Boolean = false,
    val date: LocalDate = LocalDate.now(),
    val rows: List<DailyRowDto> = emptyList(),
    val summary: DailySummaryDto? = null,
    val error: String? = null,
    // Month calendar (late/absent view)
    val showCalendar: Boolean = false,
    val calMonth: Int = LocalDate.now().monthValue,
    val calYear: Int = LocalDate.now().year,
    val monthSummary: MonthSummaryResponse? = null,
    // Pending late / out-of-zone punches awaiting this admin's decision.
    val approvals: List<AttendanceApprovalDto> = emptyList(),
    val busyApprovalId: String? = null,
)

@HiltViewModel
class LiveAttendanceViewModel @Inject constructor(
    private val repository: AdminRepository,
) : ViewModel() {

    private val _uiState = MutableStateFlow(LiveAttendanceUiState())
    val uiState: StateFlow<LiveAttendanceUiState> = _uiState.asStateFlow()

    init { loadDate(LocalDate.now()); loadMonth(); loadApprovals() }

    fun loadApprovals() {
        viewModelScope.launch {
            runCatching { repository.attendanceApprovals() }
                .onSuccess { _uiState.value = _uiState.value.copy(approvals = it) }
        }
    }

    fun approve(id: String) = decide(id, approve = true)
    fun reject(id: String) = decide(id, approve = false)

    private fun decide(id: String, approve: Boolean) {
        _uiState.value = _uiState.value.copy(busyApprovalId = id)
        viewModelScope.launch {
            runCatching { if (approve) repository.approveAttendance(id) else repository.rejectAttendance(id) }
            _uiState.value = _uiState.value.copy(busyApprovalId = null)
            loadApprovals()
            loadDate(_uiState.value.date) // refresh the day list to reflect the decision
        }
    }

    /** Per-employee attendance for one date (present / late / absent). */
    fun loadDate(date: LocalDate) {
        _uiState.value = _uiState.value.copy(date = date, isLoading = true, error = null)
        viewModelScope.launch {
            runCatching { repository.dailyReport(date.toString()) }
                .onSuccess { _uiState.value = _uiState.value.copy(isLoading = false, rows = it.rows, summary = it.summary) }
                .onFailure { _uiState.value = _uiState.value.copy(isLoading = false, error = it.userMessage()) }
        }
    }

    fun refresh() = loadDate(_uiState.value.date)
    fun today() = loadDate(LocalDate.now())
    fun yesterday() = loadDate(LocalDate.now().minusDays(1))

    fun toggleCalendar() {
        _uiState.value = _uiState.value.copy(showCalendar = !_uiState.value.showCalendar)
    }

    fun loadMonth() {
        viewModelScope.launch {
            val st = _uiState.value
            runCatching { repository.monthSummary(st.calMonth, st.calYear) }
                .onSuccess { _uiState.value = _uiState.value.copy(monthSummary = it) }
        }
    }

    fun shiftCalMonth(delta: Int) {
        val st = _uiState.value
        val d = LocalDate.of(st.calYear, st.calMonth, 1).plusMonths(delta.toLong())
        if (d > LocalDate.now().withDayOfMonth(1)) return
        _uiState.value = st.copy(calMonth = d.monthValue, calYear = d.year, monthSummary = null)
        loadMonth()
    }

    /** Tap a calendar day → filter the list to that date. */
    fun pickCalendarDay(day: Int) {
        val st = _uiState.value
        loadDate(LocalDate.of(st.calYear, st.calMonth, day))
    }
}
