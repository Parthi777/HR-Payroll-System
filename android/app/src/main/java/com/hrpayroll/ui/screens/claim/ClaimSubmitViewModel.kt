package com.hrpayroll.ui.screens.claim

import androidx.lifecycle.SavedStateHandle
import com.hrpayroll.data.remote.userMessage
import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.hrpayroll.data.repository.ClaimRepository
import dagger.hilt.android.lifecycle.HiltViewModel
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.launch
import javax.inject.Inject

/**
 * Expense heads, mirroring backend `services/claim/claim-types.ts` (the source of
 * truth — the backend rejects any code not on its list). `code` is stored;
 * `label` is what the employee sees.
 */
data class ClaimTypeOption(val code: String, val label: String)

val CLAIM_TYPES = listOf(
    ClaimTypeOption("GENERAL_EXPENSES", "General Expenses"),
    ClaimTypeOption("DONATION", "Donation"),
    ClaimTypeOption("MARKETING_EXPENSES", "Marketing Expenses"),
    ClaimTypeOption("NEW_VEHICLE_COMMISSION", "New Vehicle Commission"),
    ClaimTypeOption("NEW_VEHICLE_FITTINGS_INCENTIVES", "New Vehicle Fittings Incentives"),
    ClaimTypeOption("NEW_VEHICLE_PDI_PARTS", "New Vehicle PDI Parts"),
    ClaimTypeOption("NEW_VEHICLE_PDI_PETROL", "New Vehicle PDI Petrol"),
    ClaimTypeOption("OTHER", "Other"),
    ClaimTypeOption("PARCEL", "Parcel"),
    ClaimTypeOption("PETROL_EXPENSES", "Petrol Expenses"),
    ClaimTypeOption("RENT", "Rent"),
    ClaimTypeOption("SALARY", "Salary"),
    ClaimTypeOption("SALES_INCENTIVES", "Sales Incentives"),
    ClaimTypeOption("SERVICE_INCENTIVES", "Service Incentives"),
    ClaimTypeOption("SERVICE_OUTWORK", "Service Outwork"),
    ClaimTypeOption("STAFF_WELFARE_EXPENSES", "Staff Welfare Expenses"),
    ClaimTypeOption("TRAINING", "Training"),
    ClaimTypeOption("TRAVEL_EXPENSES", "Travel Expenses"),
    ClaimTypeOption("UNLOADING_EXPENSES", "Unloading Expenses"),
    ClaimTypeOption("UTILITIES_AND_OFFICE", "Utilities & Office"),
)

/** Display label for a stored code (falls back to the raw code if unknown). */
fun claimTypeLabel(code: String?): String =
    CLAIM_TYPES.firstOrNull { it.code == code }?.label ?: code.orEmpty()

data class ClaimSubmitUiState(
    val type: String = "GENERAL_EXPENSES",
    val title: String = "",
    val amount: String = "",
    val description: String = "",
    val note: String = "", // employee's reply when resubmitting
    val hasPhoto: Boolean = false,
    val hasPdf: Boolean = false,
    val isResubmit: Boolean = false,
    val isLoading: Boolean = false,
    val error: String? = null,
    val done: Boolean = false,
)

@HiltViewModel
class ClaimSubmitViewModel @Inject constructor(
    private val repository: ClaimRepository,
    savedStateHandle: SavedStateHandle,
) : ViewModel() {

    private val claimId: String? =
        savedStateHandle.get<String>("claimId")?.takeIf { it.isNotBlank() && it != "new" }

    private var photo: ByteArray? = null
    private var pdf: ByteArray? = null

    private val _uiState = MutableStateFlow(ClaimSubmitUiState(isResubmit = claimId != null))
    val uiState: StateFlow<ClaimSubmitUiState> = _uiState.asStateFlow()

    fun onType(v: String) { _uiState.value = _uiState.value.copy(type = v, error = null) }
    fun onTitle(v: String) { _uiState.value = _uiState.value.copy(title = v, error = null) }
    fun onAmount(v: String) { _uiState.value = _uiState.value.copy(amount = v.filter { it.isDigit() || it == '.' }, error = null) }
    fun onDescription(v: String) { _uiState.value = _uiState.value.copy(description = v) }
    fun onNote(v: String) { _uiState.value = _uiState.value.copy(note = v) }

    fun onPhoto(bytes: ByteArray) { photo = bytes; _uiState.value = _uiState.value.copy(hasPhoto = true) }
    fun onPdf(bytes: ByteArray) { pdf = bytes; _uiState.value = _uiState.value.copy(hasPdf = true) }

    fun submit() {
        val s = _uiState.value
        if (claimId == null) {
            val amount = s.amount.toDoubleOrNull()
            if (s.title.isBlank() || amount == null || amount <= 0) {
                _uiState.value = s.copy(error = "Enter a title and a valid amount")
                return
            }
            if (!s.hasPhoto && !s.hasPdf) {
                _uiState.value = s.copy(error = "Attach a receipt photo or a PDF")
                return
            }
            execute { repository.submit(s.type, s.title, amount, s.description.ifBlank { null }, photo, pdf) }
        } else {
            execute { repository.resubmit(claimId, s.description.ifBlank { null }, s.note.ifBlank { null }, photo, pdf) }
        }
    }

    private fun execute(block: suspend () -> Unit) {
        viewModelScope.launch {
            _uiState.value = _uiState.value.copy(isLoading = true, error = null)
            runCatching { block() }
                .onSuccess { _uiState.value = _uiState.value.copy(isLoading = false, done = true) }
                .onFailure { _uiState.value = _uiState.value.copy(isLoading = false, error = it.userMessage("Submit failed")) }
        }
    }
}
