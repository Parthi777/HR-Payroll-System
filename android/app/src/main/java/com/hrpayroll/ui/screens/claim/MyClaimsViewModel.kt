package com.hrpayroll.ui.screens.claim

import android.content.Context
import com.hrpayroll.data.remote.userMessage
import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.hrpayroll.data.remote.dto.ClaimDto
import com.hrpayroll.data.repository.ClaimRepository
import com.hrpayroll.utils.MediaUtils
import dagger.hilt.android.lifecycle.HiltViewModel
import dagger.hilt.android.qualifiers.ApplicationContext
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.launch
import javax.inject.Inject

data class MyClaimsUiState(
    val isLoading: Boolean = false,
    val claims: List<ClaimDto> = emptyList(),
    val error: String? = null,
    /** Claim id whose voucher is currently downloading. */
    val downloadingId: String? = null,
    /** Claim id whose clarification reply is being sent. */
    val replyingId: String? = null,
    /** One-shot toast message (voucher saved / reply sent). */
    val notice: String? = null,
)

@HiltViewModel
class MyClaimsViewModel @Inject constructor(
    private val repository: ClaimRepository,
    @ApplicationContext private val appContext: Context,
) : ViewModel() {

    private val _uiState = MutableStateFlow(MyClaimsUiState())
    val uiState: StateFlow<MyClaimsUiState> = _uiState.asStateFlow()

    init { refresh() }

    fun refresh() {
        viewModelScope.launch {
            _uiState.value = _uiState.value.copy(isLoading = true, error = null)
            runCatching { repository.myClaims() }
                .onSuccess { _uiState.value = _uiState.value.copy(isLoading = false, claims = it) }
                .onFailure { _uiState.value = _uiState.value.copy(isLoading = false, error = it.userMessage()) }
        }
    }

    /** Reply in the clarification thread; the claim returns to PENDING for the approver. */
    fun reply(claimId: String, message: String) {
        if (message.isBlank()) return
        viewModelScope.launch {
            _uiState.value = _uiState.value.copy(replyingId = claimId)
            runCatching { repository.reply(claimId, message.trim()) }
                .onSuccess {
                    _uiState.value = _uiState.value.copy(replyingId = null, notice = "Reply sent")
                    refresh()
                }
                .onFailure {
                    _uiState.value = _uiState.value.copy(replyingId = null, error = it.userMessage())
                }
        }
    }

    /** Download the printable A5 voucher PDF into Downloads and open it. */
    fun downloadVoucher(claim: ClaimDto) {
        val id = claim.id ?: return
        viewModelScope.launch {
            _uiState.value = _uiState.value.copy(downloadingId = id)
            runCatching {
                val bytes = repository.voucherPdf(id)
                MediaUtils.savePdfToDownloads(appContext, bytes, "claim-voucher-${id.takeLast(8)}.pdf")
            }
                .onSuccess { path ->
                    _uiState.value = _uiState.value.copy(downloadingId = null, notice = "Voucher saved to $path")
                }
                .onFailure {
                    _uiState.value = _uiState.value.copy(downloadingId = null, error = it.userMessage("Download failed"))
                }
        }
    }

    fun consumeNotice() {
        _uiState.value = _uiState.value.copy(notice = null)
    }
}
