package com.hrpayroll.ui.screens.admin

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.hrpayroll.data.local.TokenStore
import com.hrpayroll.data.remote.dto.AdminUserDto
import com.hrpayroll.data.repository.AdminRepository
import dagger.hilt.android.lifecycle.HiltViewModel
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.launch
import javax.inject.Inject

val ADMIN_ROLES = listOf("SUPER_ADMIN", "HR_MANAGER", "BRANCH_MANAGER", "PAYROLL_ADMIN")

data class AdminUsersUiState(
    val isLoading: Boolean = false,
    val admins: List<AdminUserDto> = emptyList(),
    val isSuperAdmin: Boolean = true,
    val error: String? = null,
)

@HiltViewModel
class AdminUsersViewModel @Inject constructor(
    private val repository: AdminRepository,
    tokenStore: TokenStore,
) : ViewModel() {

    private val _uiState = MutableStateFlow(
        AdminUsersUiState(isSuperAdmin = tokenStore.getRole() == "SUPER_ADMIN"),
    )
    val uiState: StateFlow<AdminUsersUiState> = _uiState.asStateFlow()

    init { refresh() }

    fun refresh() {
        if (!_uiState.value.isSuperAdmin) return
        viewModelScope.launch {
            _uiState.value = _uiState.value.copy(isLoading = true, error = null)
            runCatching { repository.adminUsers() }
                .onSuccess { _uiState.value = _uiState.value.copy(isLoading = false, admins = it) }
                .onFailure { _uiState.value = _uiState.value.copy(isLoading = false, error = it.message) }
        }
    }

    fun setActive(id: String, active: Boolean) {
        viewModelScope.launch {
            runCatching { repository.setAdminActive(id, active) }
                .onFailure { _uiState.value = _uiState.value.copy(error = it.message) }
            refresh()
        }
    }

    fun create(name: String, email: String, role: String, password: String, onDone: (Boolean) -> Unit) {
        viewModelScope.launch {
            runCatching { repository.createAdminUser(name, email, role, password) }
                .onSuccess { refresh(); onDone(true) }
                .onFailure {
                    _uiState.value = _uiState.value.copy(error = it.message)
                    onDone(false)
                }
        }
    }
}
