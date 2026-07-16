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

enum class LoginPhase { PHONE, OTP }

data class LoginUiState(
    val phase: LoginPhase = LoginPhase.PHONE,
    val adminMode: Boolean = false, // false = employee (phone), true = admin (email+password)
    val phone: String = "",
    val otp: String = "",
    val email: String = "",
    val password: String = "",
    val isLoading: Boolean = false,
    val error: String? = null,
    val loggedIn: Boolean = false,
    val isAdmin: Boolean = false, // where to route after login
    val devOtp: String? = null, // shown as a hint when there's no SMS provider (dev)
)

@HiltViewModel
class LoginViewModel @Inject constructor(
    private val authRepository: AuthRepository,
) : ViewModel() {

    private val _uiState = MutableStateFlow(LoginUiState())
    val uiState: StateFlow<LoginUiState> = _uiState.asStateFlow()

    fun onPhoneChange(value: String) { _uiState.value = _uiState.value.copy(phone = value, error = null) }
    fun onOtpChange(value: String) { _uiState.value = _uiState.value.copy(otp = value, error = null) }
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
                }
                .onFailure { _uiState.value = _uiState.value.copy(isLoading = false, error = it.userMessage("Login failed")) }
        }
    }

    fun sendOtp() {
        val phone = _uiState.value.phone.trim()
        if (phone.length < 10) {
            _uiState.value = _uiState.value.copy(error = "Enter a valid phone number")
            return
        }
        viewModelScope.launch {
            _uiState.value = _uiState.value.copy(isLoading = true, error = null)
            runCatching { authRepository.sendOtp(phone) }
                .onSuccess { devOtp ->
                    _uiState.value = _uiState.value.copy(isLoading = false, phase = LoginPhase.OTP, devOtp = devOtp)
                }
                .onFailure { _uiState.value = _uiState.value.copy(isLoading = false, error = it.userMessage("Failed to send OTP")) }
        }
    }

    fun verifyOtp() {
        val state = _uiState.value
        if (state.otp.length != 6) {
            _uiState.value = state.copy(error = "Enter the 6-digit OTP")
            return
        }
        viewModelScope.launch {
            _uiState.value = state.copy(isLoading = true, error = null)
            runCatching { authRepository.verifyOtp(state.phone.trim(), state.otp.trim()) }
                .onSuccess { ok ->
                    _uiState.value = _uiState.value.copy(isLoading = false, loggedIn = ok, error = if (ok) null else "Login failed")
                }
                .onFailure { _uiState.value = _uiState.value.copy(isLoading = false, error = it.userMessage("Invalid OTP")) }
        }
    }

    fun back() { _uiState.value = _uiState.value.copy(phase = LoginPhase.PHONE, otp = "", error = null) }
}
