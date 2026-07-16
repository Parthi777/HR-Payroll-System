package com.hrpayroll.ui.screens.admin

import com.hrpayroll.data.remote.userMessage
import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.hrpayroll.data.remote.dto.DashboardStatsDto
import com.hrpayroll.data.remote.dto.NotificationDto
import com.hrpayroll.data.repository.AdminRepository
import com.hrpayroll.data.repository.AuthRepository
import dagger.hilt.android.lifecycle.HiltViewModel
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.launch
import javax.inject.Inject

data class AdminDashboardUiState(
    val isLoading: Boolean = false,
    val stats: DashboardStatsDto? = null,
    val notifications: List<NotificationDto> = emptyList(),
    val unread: Int = 0,
    val error: String? = null,
)

@HiltViewModel
class AdminDashboardViewModel @Inject constructor(
    private val repository: AdminRepository,
    private val authRepository: AuthRepository,
) : ViewModel() {

    private val _uiState = MutableStateFlow(AdminDashboardUiState())
    val uiState: StateFlow<AdminDashboardUiState> = _uiState.asStateFlow()

    init { refresh() }

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
