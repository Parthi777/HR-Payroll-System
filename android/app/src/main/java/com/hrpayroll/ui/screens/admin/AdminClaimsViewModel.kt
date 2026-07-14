package com.hrpayroll.ui.screens.admin

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.hrpayroll.BuildConfig
import com.hrpayroll.data.local.TokenStore
import com.hrpayroll.data.remote.dto.ClaimDto
import com.hrpayroll.data.repository.AdminRepository
import dagger.hilt.android.lifecycle.HiltViewModel
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.launch
import javax.inject.Inject

val CLAIM_FILTERS = listOf("PENDING", "NEEDS_CLARIFICATION", "APPROVED", "PAID", "REJECTED", "ALL")

/** Roles allowed to mark an approved claim as paid (must match the backend payGuard). */
private val PAY_ROLES = setOf("SUPER_ADMIN", "PAYROLL_ADMIN", "CASHIER")

data class AdminClaimsUiState(
    val isLoading: Boolean = false,
    val claims: List<ClaimDto> = emptyList(),
    val filter: String = "PENDING",
    val error: String? = null,
)

@HiltViewModel
class AdminClaimsViewModel @Inject constructor(
    private val repository: AdminRepository,
    tokenStore: TokenStore,
) : ViewModel() {

    val authToken: String? = tokenStore.getToken()
    val role: String? = tokenStore.getRole()

    /** Cashiers approve nothing — they check details and hand over the money. */
    val canApprove: Boolean = role != "CASHIER"
    val canPay: Boolean = role in PAY_ROLES

    private val _uiState = MutableStateFlow(
        // A cashier's work queue is the approved-awaiting-payment list.
        AdminClaimsUiState(filter = if (role == "CASHIER") "APPROVED" else "PENDING"),
    )
    val uiState: StateFlow<AdminClaimsUiState> = _uiState.asStateFlow()

    init { refresh() }

    fun setFilter(f: String) {
        _uiState.value = _uiState.value.copy(filter = f)
        refresh()
    }

    fun refresh() {
        viewModelScope.launch {
            _uiState.value = _uiState.value.copy(isLoading = true, error = null)
            val status = _uiState.value.filter.takeIf { it != "ALL" }
            runCatching { repository.claims(status) }
                .onSuccess { _uiState.value = _uiState.value.copy(isLoading = false, claims = it) }
                .onFailure { _uiState.value = _uiState.value.copy(isLoading = false, error = it.message) }
        }
    }

    fun approve(id: String) = act { repository.approveClaim(id) }
    fun reject(id: String, note: String) = act { repository.rejectClaim(id, note) }
    fun clarify(id: String, note: String) = act { repository.clarifyClaim(id, note) }
    fun pay(id: String, note: String?) = act { repository.payClaim(id, note) }

    private fun act(block: suspend () -> Unit) {
        viewModelScope.launch {
            runCatching { block() }.onFailure { _uiState.value = _uiState.value.copy(error = it.message) }
            refresh()
        }
    }

    /** Authenticated URL for a claim's receipt photo (loaded via Coil with a Bearer header). */
    fun photoUrl(id: String): String = "${BuildConfig.API_BASE_URL}claims/$id/file?which=photo"
}
