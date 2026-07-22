package com.hrpayroll.ui.screens.home

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.hrpayroll.BuildConfig
import com.hrpayroll.data.local.TokenStore
import com.hrpayroll.data.repository.AttendanceRepository
import com.hrpayroll.data.repository.AuthRepository
import com.hrpayroll.data.repository.EmployeeDataRepository
import dagger.hilt.android.lifecycle.HiltViewModel
import kotlinx.coroutines.async
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.launch
import javax.inject.Inject

data class HomeUiState(
    val isLoading: Boolean = true,
    val name: String = "Employee",
    val designation: String = "",
    val employeeCode: String = "",
    val todayStatus: String = "—",
    val todayWorked: String = "—",
    val presentDays: Int = 0,
    val absentDays: Int = 0,
    val attendanceRate: Int = 0,
    val netSalary: Double = 0.0,
    val leaveBalance: Double = 0.0,
    /** Per-employee photo URL (keyed by code so Coil can't serve another user's cached photo). */
    val photoUrl: String = "",
)

@HiltViewModel
class HomeViewModel @Inject constructor(
    private val employeeRepo: EmployeeDataRepository,
    private val attendanceRepo: AttendanceRepository,
    private val authRepository: AuthRepository,
    tokenStore: TokenStore,
) : ViewModel() {

    val authToken: String? = tokenStore.getToken()

    private val _uiState = MutableStateFlow(HomeUiState())
    val uiState: StateFlow<HomeUiState> = _uiState.asStateFlow()

    fun logout() = authRepository.logout()

    init { refresh() }

    fun refresh() {
        viewModelScope.launch {
            _uiState.value = _uiState.value.copy(isLoading = true)
            // Each source is independent — one failing must not blank the whole dashboard.
            val meD = async { runCatching { employeeRepo.me() }.getOrNull() }
            val todayD = async { runCatching { attendanceRepo.today() }.getOrNull() }
            val historyD = async { runCatching { attendanceRepo.history() }.getOrNull() ?: emptyList() }
            val payslipsD = async { runCatching { employeeRepo.myPayslips() }.getOrNull() ?: emptyList() }
            val balancesD = async { runCatching { employeeRepo.leaveBalance() }.getOrNull() ?: emptyList() }

            val me = meD.await()
            val today = todayD.await()
            val history = historyD.await()
            val present = history.count { it.status == "Present" || it.status == "Late" }
            val absent = history.count { it.status == "Absent" }
            val denom = present + absent
            val worked = today?.workingMinutes?.let { "${it / 60}h ${it % 60}m" }
                ?: if (today?.checkIn != null) "On duty" else "—"

            _uiState.value = HomeUiState(
                isLoading = false,
                name = me?.name ?: "Employee",
                designation = me?.designation ?: "",
                employeeCode = me?.employeeCode ?: "",
                todayStatus = today?.status ?: "—",
                todayWorked = worked,
                presentDays = present,
                absentDays = absent,
                attendanceRate = if (denom > 0) present * 100 / denom else 0,
                netSalary = payslipsD.await().firstOrNull()?.netSalary ?: 0.0,
                leaveBalance = balancesD.await().sumOf { (it.total ?: 0.0) - (it.used ?: 0.0) },
                // Unique per-employee URL — the server ignores the query, but it gives Coil a
                // distinct cache key so employee B never sees employee A's cached photo.
                photoUrl = me?.employeeCode?.let { "${BuildConfig.API_BASE_URL}me/photo?e=$it" } ?: "",
            )
        }
    }
}
