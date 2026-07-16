package com.hrpayroll.ui.screens.login

import com.hrpayroll.data.remote.userMessage
import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.hrpayroll.data.repository.AuthRepository
import dagger.hilt.android.lifecycle.HiltViewModel
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.launch
import javax.inject.Inject

data class LoginUiState(
    val adminMode: Boolean = false, // false = employee (phone), true = admin (email+password)
    val phone: String = "",
    val email: String = "",
    val password: String = "",
    val isLoading: Boolean = false,
    val error: String? = null,
    val loggedIn: Boolean = false,
    val isAdmin: Boolean = false, // where to route after login
)

@HiltViewModel
class LoginViewModel @Inject constructor(
    private val authRepository: AuthRepository,
) : ViewModel() {

    private val _uiState = MutableStateFlow(LoginUiState())
    val uiState: StateFlow<LoginUiState> = _uiState.asStateFlow()

    fun onPhoneChange(value: String) { _uiState.value = _uiState.value.copy(phone = value, error = null) }
    fun onEmailChange(value: String) { _uiState.value = _uiState.value.copy(email = value, error = null) }
    fun onPasswordChange(value: String) { _uiState.value = _uiState.value.copy(password = value, error = null) }
    fun setAdminMode(admin: Boolean) { _uiState.value = _uiState.value.copy(adminMode = admin, error = null) }

    /** Admin login with email + password (routes to the admin section on success). */
    fun adminLogin() {
        val s = _uiState.value
        if (s.email.isBlank() || s.password.isBlank()) {
            _uiState.value = s.copy(error = "Enter email and password")
            return
        }
        viewModelScope.launch {
            _uiState.value = s.copy(isLoading = true, error = null)
            runCatching { authRepository.adminLogin(s.email, s.password) }
                .onSuccess { ok ->
                    _uiState.value = _uiState.value.copy(
                        isLoading = false, loggedIn = ok, isAdmin = ok,
                        error = if (ok) null else "Login failed",
                    )
                    if (ok) registerPush()
                }
                .onFailure { _uiState.value = _uiState.value.copy(isLoading = false, error = it.userMessage("Login failed")) }
        }
    }

    /** Employee login with phone + password (password is set by the admin at creation). */
    fun login() {
        val s = _uiState.value
        val phone = s.phone.trim()
        if (phone.length < 10) {
            _uiState.value = s.copy(error = "Enter a valid phone number")
            return
        }
        if (s.password.isBlank()) {
            _uiState.value = s.copy(error = "Enter your password")
            return
        }
        viewModelScope.launch {
            _uiState.value = s.copy(isLoading = true, error = null)
            runCatching { authRepository.employeeLogin(phone, s.password) }
                .onSuccess { ok ->
                    _uiState.value = _uiState.value.copy(
                        isLoading = false, loggedIn = ok, isAdmin = false,
                        error = if (ok) null else "Login failed",
                    )
                    if (ok) registerPush()
                }
                .onFailure { _uiState.value = _uiState.value.copy(isLoading = false, error = it.userMessage("Login failed")) }
        }
    }


    /** Fire-and-forget: register this device's FCM token (skipped when Firebase is absent). */
    private fun registerPush() {
        runCatching {
            com.google.firebase.messaging.FirebaseMessaging.getInstance().token.addOnSuccessListener { t ->
                viewModelScope.launch { runCatching { authRepository.registerFcmToken(t) } }
            }
        }
    }
}
