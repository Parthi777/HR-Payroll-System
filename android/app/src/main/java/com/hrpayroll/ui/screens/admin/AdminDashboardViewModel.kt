package com.hrpayroll.ui.screens.admin

import com.hrpayroll.data.remote.userMessage
import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.hrpayroll.data.remote.dto.DashboardStatsDto
import com.hrpayroll.data.remote.dto.DailySummaryDto
import com.hrpayroll.data.remote.dto.NotificationDto
import java.time.LocalDate
import com.hrpayroll.data.repository.AdminRepository
import com.hrpayroll.data.repository.AuthRepository
import dagger.hilt.android.lifecycle.HiltViewModel
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.launch
import javax.inject.Inject

/** Aggregated month totals for the dashboard month filter. */
data class MonthSummary(
    val present: Int = 0,
    val late: Int = 0,
    val absent: Int = 0,
    val leave: Int = 0,
    val employees: Int = 0,
)

data class AdminDashboardUiState(
    val isLoading: Boolean = false,
    val stats: DashboardStatsDto? = null,
    val notifications: List<NotificationDto> = emptyList(),
    val unread: Int = 0,
    val error: String? = null,
    /** Month filter for attendance analysis (0 = today/live view). */
    val filterMonth: Int = java.time.LocalDate.now().monthValue,
    val filterYear: Int = java.time.LocalDate.now().year,
    val monthSummary: MonthSummary? = null,
    val monthLoading: Boolean = false,
    /** Overview date picker: today = live stats; any other date = that day's summary. */
    val overviewDate: LocalDate = LocalDate.now(),
    val daySummary: DailySummaryDto? = null,
    val dayLoading: Boolean = false,
)

@HiltViewModel
class AdminDashboardViewModel @Inject constructor(
    private val repository: AdminRepository,
    private val authRepository: AuthRepository,
) : ViewModel() {

    private val _uiState = MutableStateFlow(AdminDashboardUiState())
    val uiState: StateFlow<AdminDashboardUiState> = _uiState.asStateFlow()

    init { refresh(); loadMonth() }

    /** Load per-employee performance for the selected month and aggregate totals. */
    fun loadMonth() {
        viewModelScope.launch {
            val st = _uiState.value
            _uiState.value = st.copy(monthLoading = true)
            runCatching { repository.performance(st.filterMonth, st.filterYear) }
                .onSuccess { rows ->
                    _uiState.value = _uiState.value.copy(
                        monthLoading = false,
                        monthSummary = MonthSummary(
                            present = rows.sumOf { it.presentDays },
                            late = rows.sumOf { it.lateDays },
                            absent = rows.sumOf { it.absentDays },
                            leave = rows.sumOf { it.leaveDays },
                            employees = rows.size,
                        ),
                    )
                }
                .onFailure { _uiState.value = _uiState.value.copy(monthLoading = false) }
        }
    }

    /** Pick a date for the overview: today shows live stats, past dates show that day's summary. */
    fun pickOverviewDate(date: LocalDate) {
        _uiState.value = _uiState.value.copy(overviewDate = date)
        if (date == LocalDate.now()) {
            _uiState.value = _uiState.value.copy(daySummary = null)
            return
        }
        _uiState.value = _uiState.value.copy(dayLoading = true)
        viewModelScope.launch {
            runCatching { repository.dailyReport(date.toString()) }
                .onSuccess { _uiState.value = _uiState.value.copy(dayLoading = false, daySummary = it.summary) }
                .onFailure { _uiState.value = _uiState.value.copy(dayLoading = false, daySummary = null) }
        }
    }

    fun shiftMonth(delta: Int) {
        val st = _uiState.value
        val d = java.time.LocalDate.of(st.filterYear, st.filterMonth, 1).plusMonths(delta.toLong())
        if (d > java.time.LocalDate.now().withDayOfMonth(1)) return
        _uiState.value = st.copy(filterMonth = d.monthValue, filterYear = d.year, monthSummary = null)
        loadMonth()
    }

    fun refresh() {
        viewModelScope.launch {
            _uiState.value = _uiState.value.copy(isLoading = true, error = null)
            runCatching { repository.dashboardStats() }
                .onSuccess { _uiState.value = _uiState.value.copy(isLoading = false, stats = it) }
                .onFailure { _uiState.value = _uiState.value.copy(isLoading = false, error = it.userMessage()) }
            runCatching { repository.notifications() }
                .onSuccess {
                    _uiState.value = _uiState.value.copy(notifications = it.notifications, unread = it.unread ?: 0)
                }
        }
    }

    /** Mark everything read once the admin has seen the list. */
    fun markNotificationsRead() {
        if (_uiState.value.unread == 0) return
        viewModelScope.launch {
            runCatching { repository.markNotificationsRead() }
            _uiState.value = _uiState.value.copy(unread = 0)
        }
    }

    fun logout() = authRepository.logout()
}
