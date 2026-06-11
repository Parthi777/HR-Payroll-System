package com.hrpayroll.ui.screens.claim

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.hrpayroll.data.remote.dto.ClaimDto
import com.hrpayroll.data.repository.ClaimRepository
import dagger.hilt.android.lifecycle.HiltViewModel
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.launch
import javax.inject.Inject

data class MyClaimsUiState(
    val isLoading: Boolean = false,
    val claims: List<ClaimDto> = emptyList(),
    val error: String? = null,
)

@HiltViewModel
class MyClaimsViewModel @Inject constructor(
    private val repository: ClaimRepository,
) : ViewModel() {

    private val _uiState = MutableStateFlow(MyClaimsUiState())
    val uiState: StateFlow<MyClaimsUiState> = _uiState.asStateFlow()

    init { refresh() }

    fun refresh() {
        viewModelScope.launch {
            _uiState.value = _uiState.value.copy(isLoading = true, error = null)
            runCatching { repository.myClaims() }
                .onSuccess { _uiState.value = _uiState.value.copy(isLoading = false, claims = it) }
                .onFailure { _uiState.value = _uiState.value.copy(isLoading = false, error = it.message) }
        }
    }
}
