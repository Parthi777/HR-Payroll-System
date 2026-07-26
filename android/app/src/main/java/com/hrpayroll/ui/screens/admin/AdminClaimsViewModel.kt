package com.hrpayroll.ui.screens.admin

import com.hrpayroll.data.remote.userMessage
import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.hrpayroll.BuildConfig
import com.hrpayroll.data.local.TokenStore
import com.hrpayroll.data.remote.dto.ClaimDto
import com.hrpayroll.data.repository.AdminRepository
import com.hrpayroll.utils.MediaUtils
import android.content.Context
import dagger.hilt.android.qualifiers.ApplicationContext
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
    /** Claim id whose attached bill PDF is downloading. */
    val openingBillId: String? = null,
    val notice: String? = null,
)

@HiltViewModel
class AdminClaimsViewModel @Inject constructor(
    private val repository: AdminRepository,
    @ApplicationContext private val appContext: Context,
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
                .onFailure { _uiState.value = _uiState.value.copy(isLoading = false, error = it.userMessage()) }
        }
    }

    fun approve(id: String) = act { repository.approveClaim(id) }
    fun reject(id: String, note: String) = act { repository.rejectClaim(id, note) }
    fun clarify(id: String, note: String) = act { repository.clarifyClaim(id, note) }
    fun pay(id: String, note: String?) = act { repository.payClaim(id, note) }

    private fun act(block: suspend () -> Unit) {
        viewModelScope.launch {
            runCatching { block() }.onFailure { _uiState.value = _uiState.value.copy(error = it.userMessage()) }
            refresh()
        }
    }

    /**
     * Open a bill that was attached as a PDF rather than a photo. Coil can only
     * render the image bills, so without this a cashier has no way to see a
     * scanned PDF bill before disbursing.
     */
    fun openBillPdf(claimId: String) {
        viewModelScope.launch {
            _uiState.value = _uiState.value.copy(openingBillId = claimId, error = null)
            runCatching {
                val bytes = repository.claimFile(claimId, "pdf")
                MediaUtils.savePdfToDownloads(appContext, bytes, "bill-${claimId.takeLast(8)}.pdf")
            }
                .onSuccess { _uiState.value = _uiState.value.copy(openingBillId = null, notice = "Bill saved to $it") }
                .onFailure { _uiState.value = _uiState.value.copy(openingBillId = null, error = it.userMessage()) }
        }
    }

    fun consumeNotice() {
        _uiState.value = _uiState.value.copy(notice = null)
    }

    /** Authenticated URL for a claim's receipt photo (loaded via Coil with a Bearer header). */
    fun photoUrl(id: String): String = "${BuildConfig.API_BASE_URL}claims/$id/file?which=photo"
}
