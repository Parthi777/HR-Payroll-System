package com.hrpayroll.ui.screens.admin

import com.hrpayroll.data.remote.userMessage
import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.hrpayroll.data.remote.dto.PerformanceRowDto
import com.hrpayroll.data.repository.AdminRepository
import dagger.hilt.android.lifecycle.HiltViewModel
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.launch
import javax.inject.Inject

enum class PerformanceSort(val label: String) { NAME("Name"), RATE_LOW("Lowest attendance"), RATE_HIGH("Highest attendance") }

data class PerformanceUiState(
    val isLoading: Boolean = false,
    val rows: List<PerformanceRowDto> = emptyList(),
    val error: String? = null,
    val month: Int = java.time.LocalDate.now().monthValue,
    val year: Int = java.time.LocalDate.now().year,
    /** Every month from the earliest joining date to now, newest first. */
    val months: List<Pair<Int, Int>> = listOf(month to year),
    val query: String = "",
    val sort: PerformanceSort = PerformanceSort.NAME,
) {
    /** The rows the list shows: filtered by the search, then sorted. */
    val visible: List<PerformanceRowDto>
        get() {
            val q = query.trim().lowercase()
            val hits = if (q.isEmpty()) rows else rows.filter { r ->
                listOf(r.name, r.employeeCode, r.branch, r.designation, r.department)
                    .any { it?.lowercase()?.contains(q) == true }
            }
            return when (sort) {
                PerformanceSort.NAME -> hits.sortedBy { it.name?.lowercase() }
                PerformanceSort.RATE_LOW -> hits.sortedBy { it.attendanceRate }
                PerformanceSort.RATE_HIGH -> hits.sortedByDescending { it.attendanceRate }
            }
        }
}

@HiltViewModel
class PerformanceViewModel @Inject constructor(
    private val repository: AdminRepository,
) : ViewModel() {

    private val _uiState = MutableStateFlow(PerformanceUiState())
    val uiState: StateFlow<PerformanceUiState> = _uiState.asStateFlow()

    init { refresh() }

    fun onQueryChange(q: String) { _uiState.value = _uiState.value.copy(query = q) }
    fun setSort(sort: PerformanceSort) { _uiState.value = _uiState.value.copy(sort = sort) }
    fun selectMonth(month: Int, year: Int) {
        _uiState.value = _uiState.value.copy(month = month, year = year)
        refresh()
    }

    fun refresh() {
        viewModelScope.launch {
            val s = _uiState.value
            _uiState.value = s.copy(isLoading = true, error = null)
            runCatching { repository.performance(s.month, s.year) }
                .onSuccess { rows ->
                    _uiState.value = _uiState.value.copy(isLoading = false, rows = rows, months = monthsFrom(rows))
                }
                .onFailure { _uiState.value = _uiState.value.copy(isLoading = false, error = it.userMessage()) }
        }
    }

    /** From the earliest month anyone's data starts (joining, or the workspace's start) to now, newest first. */
    private fun monthsFrom(rows: List<PerformanceRowDto>): List<Pair<Int, Int>> {
        val earliest = rows.mapNotNull { r ->
            (r.availableFrom ?: r.joiningDate)?.let { runCatching { java.time.LocalDate.parse(it.take(10)) }.getOrNull() }
        }.minOrNull() ?: java.time.LocalDate.now()
        val out = mutableListOf<Pair<Int, Int>>()
        var ym = java.time.YearMonth.now()
        val stop = java.time.YearMonth.from(earliest)
        while (!ym.isBefore(stop) && out.size < 240) {
            out += ym.monthValue to ym.year
            ym = ym.minusMonths(1)
        }
        return out
    }
}
