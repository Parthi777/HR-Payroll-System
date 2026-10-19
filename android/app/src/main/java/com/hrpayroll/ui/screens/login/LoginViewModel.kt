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

/**
 * The second step of an admin sign-in, once the password was right.
 *
 * Verify: an enrolled account types the code from its authenticator app (or a
 * recovery code). Enroll: the first sign-in adds this account to the app on the
 * phone — a QR code cannot be scanned by the phone showing it, so the screen
 * hands the setup link straight to the authenticator, with the key to type as
 * a fallback. RecoveryCodes / RecoveryUsed are the screens after it.
 */
sealed interface TwoStepStage {
    val challenge: String
    data class Verify(override val challenge: String, val useRecovery: Boolean = false) : TwoStepStage
    data class Enroll(override val challenge: String, val secret: String? = null, val otpauthUri: String? = null) : TwoStepStage
    data class RecoveryCodes(override val challenge: String, val codes: List<String>) : TwoStepStage
    data class RecoveryUsed(override val challenge: String, val left: Int) : TwoStepStage
}

data class LoginUiState(
    val adminMode: Boolean = false, // false = employee (user ID), true = admin (email+password+code)
    /** Employee code (EMP001) or phone number. */
    val userId: String = "",
    val email: String = "",
    val password: String = "",
    val isLoading: Boolean = false,
    val error: String? = null,
    val loggedIn: Boolean = false,
    val isAdmin: Boolean = false, // where to route after login
    /** Company code, e.g. "abc-motors". Only needed when the server asks. */
    val companyCode: String = "",
    /**
     * Whether to show the company-code field.
     *
     * Hidden by default: with one workspace the server resolves it on its own,
     * and asking every employee for a code they have never heard of would be
     * gratuitous. It appears only once a sign-in comes back saying the
     * workspace could not be determined.
     */
    val needsCompanyCode: Boolean = false,
    /** Non-null once an admin's password was accepted and the second step is showing. */
    val twoStep: TwoStepStage? = null,
    /** The 6-digit code (or recovery code) being typed on the second step. */
    val code: String = "",
)

@HiltViewModel
class LoginViewModel @Inject constructor(
    private val authRepository: AuthRepository,
) : ViewModel() {

    private val _uiState = MutableStateFlow(LoginUiState())
    val uiState: StateFlow<LoginUiState> = _uiState.asStateFlow()

    fun onUserIdChange(value: String) { _uiState.value = _uiState.value.copy(userId = value, error = null) }
    fun onEmailChange(value: String) { _uiState.value = _uiState.value.copy(email = value, error = null) }
    fun onPasswordChange(value: String) { _uiState.value = _uiState.value.copy(password = value, error = null) }
    fun setAdminMode(admin: Boolean) { _uiState.value = _uiState.value.copy(adminMode = admin, error = null) }
    fun onCompanyCodeChange(value: String) { _uiState.value = _uiState.value.copy(companyCode = value, error = null) }
    fun onCodeChange(value: String) {
        val recovery = (_uiState.value.twoStep as? TwoStepStage.Verify)?.useRecovery == true
        // Six digits from the app; a recovery code is letters, digits and a dash.
        val clean = if (recovery) value.uppercase().filter { it.isLetterOrDigit() || it == '-' }.take(11)
        else value.filter { it.isDigit() }.take(6)
        _uiState.value = _uiState.value.copy(code = clean, error = null)
    }
    fun toggleRecoveryCode() {
        val stage = _uiState.value.twoStep as? TwoStepStage.Verify ?: return
        _uiState.value = _uiState.value.copy(twoStep = stage.copy(useRecovery = !stage.useRecovery), code = "", error = null)
    }
    /** Back to the password, e.g. after a challenge expired. */
    fun restartSignIn() { _uiState.value = _uiState.value.copy(twoStep = null, code = "", password = "", error = null) }
    /** Leave the recovery-code screens for the app. */
    fun finishSignIn() {
        _uiState.value = _uiState.value.copy(loggedIn = true, isAdmin = true)
        registerPush()
    }

    /**
     * The backend answers 400 "which workspace" when more than one exists and
     * the request named none. That is the only moment the code is worth asking
     * for, so reveal the field then rather than up front.
     */
    private fun handleFailure(t: Throwable, fallback: String) {
        val message = t.userMessage(fallback)
        _uiState.value = _uiState.value.copy(
            isLoading = false,
            error = message,
            needsCompanyCode = _uiState.value.needsCompanyCode || message.contains("workspace", ignoreCase = true),
        )
    }

    /**
     * Admin sign-in, first step: email + password. A correct password opens the
     * second step — a code from the authenticator app, or setting one up.
     */
    fun adminLogin() {
        val s = _uiState.value
        if (s.email.isBlank() || s.password.isBlank()) {
            _uiState.value = s.copy(error = "Enter email and password")
            return
        }
        viewModelScope.launch {
            _uiState.value = s.copy(isLoading = true, error = null)
            runCatching { authRepository.adminLogin(s.email, s.password, s.companyCode) }
                .onSuccess { res ->
                    val challenge = res.challenge
                    if (challenge.isNullOrBlank()) {
                        _uiState.value = _uiState.value.copy(isLoading = false, error = "Login failed")
                        return@onSuccess
                    }
                    val stage = if (res.step == "enroll") TwoStepStage.Enroll(challenge) else TwoStepStage.Verify(challenge)
                    _uiState.value = _uiState.value.copy(isLoading = false, password = "", code = "", twoStep = stage)
                    if (stage is TwoStepStage.Enroll) startEnrolment(stage)
                }
                .onFailure { handleFailure(it, "Login failed") }
        }
    }

    /** Fetch the new authenticator secret for a first sign-in. */
    private fun startEnrolment(stage: TwoStepStage.Enroll) {
        viewModelScope.launch {
            _uiState.value = _uiState.value.copy(isLoading = true, error = null)
            runCatching { authRepository.setupTwoStep(stage.challenge) }
                .onSuccess { setup ->
                    _uiState.value = _uiState.value.copy(
                        isLoading = false,
                        twoStep = stage.copy(secret = setup.secret, otpauthUri = setup.otpauthUri),
                    )
                }
                .onFailure { handleFailure(it, "Could not start two-step setup") }
        }
    }

    /** Second step: confirm setup, or verify with a code. */
    fun submitCode() {
        val s = _uiState.value
        val stage = s.twoStep ?: return
        val recovery = (stage as? TwoStepStage.Verify)?.useRecovery == true
        if (!recovery && s.code.length != 6) {
            _uiState.value = s.copy(error = "Enter the 6-digit code from your authenticator app")
            return
        }
        if (recovery && s.code.isBlank()) {
            _uiState.value = s.copy(error = "Enter one of your recovery codes")
            return
        }
        viewModelScope.launch {
            _uiState.value = s.copy(isLoading = true, error = null)
            runCatching {
                when (stage) {
                    is TwoStepStage.Enroll -> authRepository.enableTwoStep(stage.challenge, s.code)
                    else -> authRepository.verifyTwoStep(stage.challenge, s.code)
                }
            }
                .onSuccess { res ->
                    val codes = res.recoveryCodes
                    val left = res.recoveryCodesLeft
                    _uiState.value = when {
                        // Shown once — the app waits for "I've saved them" before going in.
                        !codes.isNullOrEmpty() -> _uiState.value.copy(isLoading = false, code = "", twoStep = TwoStepStage.RecoveryCodes(stage.challenge, codes))
                        left != null -> _uiState.value.copy(isLoading = false, code = "", twoStep = TwoStepStage.RecoveryUsed(stage.challenge, left))
                        else -> _uiState.value.copy(isLoading = false, loggedIn = true, isAdmin = true)
                    }
                    if (_uiState.value.loggedIn) registerPush()
                }
                .onFailure { handleFailure(it, "That code is not right") }
        }
    }

    /** Employee login with their user ID (employee code or phone) + the password the admin issued. */
    fun login() {
        val s = _uiState.value
        val userId = s.userId.trim()
        if (userId.isEmpty()) {
            _uiState.value = s.copy(error = "Enter your employee ID or phone number")
            return
        }
        if (s.password.isBlank()) {
            _uiState.value = s.copy(error = "Enter your password")
            return
        }
        viewModelScope.launch {
            _uiState.value = s.copy(isLoading = true, error = null)
            runCatching { authRepository.employeeLogin(userId, s.password, s.companyCode) }
                .onSuccess { ok ->
                    _uiState.value = _uiState.value.copy(
                        isLoading = false, loggedIn = ok, isAdmin = false,
                        error = if (ok) null else "Login failed",
                    )
                    if (ok) registerPush()
                }
                .onFailure { handleFailure(it, "Login failed") }
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
