package com.hrpayroll.ui.screens.admin

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.hrpayroll.data.local.TokenStore
import com.hrpayroll.data.remote.dto.AdminEmployeeDto
import com.hrpayroll.data.remote.dto.MasterItemDto
import com.hrpayroll.data.repository.AdminRepository
import dagger.hilt.android.lifecycle.HiltViewModel
import kotlinx.coroutines.async
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.launch
import javax.inject.Inject

data class AdminEmployeesUiState(
    val isLoading: Boolean = false,
    val employees: List<AdminEmployeeDto> = emptyList(),
    val branches: List<MasterItemDto> = emptyList(),
    val departments: List<MasterItemDto> = emptyList(),
    val designations: List<MasterItemDto> = emptyList(),
    val shifts: List<MasterItemDto> = emptyList(),
    val saving: Boolean = false,
    /** Employee id whose face photo is uploading. */
    val enrollingId: String? = null,
    val error: String? = null,
    /** One-shot toast (created / enrolled). */
    val notice: String? = null,
    /** Closes the Add-Employee dialog after a successful create. */
    val createdOk: Boolean = false,
)

/** Employee onboarding + face enrollment for the mobile admin ("People" tab). */
@HiltViewModel
class AdminEmployeesViewModel @Inject constructor(
    private val repository: AdminRepository,
    tokenStore: TokenStore,
) : ViewModel() {

    val isSuperAdmin: Boolean = tokenStore.getRole() == "SUPER_ADMIN"

    private val _uiState = MutableStateFlow(AdminEmployeesUiState())
    val uiState: StateFlow<AdminEmployeesUiState> = _uiState.asStateFlow()

    init { refresh() }

    fun refresh() {
        viewModelScope.launch {
            _uiState.value = _uiState.value.copy(isLoading = true, error = null)
            // Employees + form master data in parallel; masters failing shouldn't kill the list.
            val empD = async { runCatching { repository.employees() } }
            val brD = async { runCatching { repository.branches() }.getOrDefault(emptyList()) }
            val deD = async { runCatching { repository.departments() }.getOrDefault(emptyList()) }
            val dgD = async { runCatching { repository.designations() }.getOrDefault(emptyList()) }
            val shD = async { runCatching { repository.shifts() }.getOrDefault(emptyList()) }
            val emp = empD.await()
            _uiState.value = _uiState.value.copy(
                isLoading = false,
                employees = emp.getOrDefault(_uiState.value.employees),
                error = emp.exceptionOrNull()?.message,
                branches = brD.await(),
                departments = deD.await(),
                designations = dgD.await(),
                shifts = shD.await(),
            )
        }
    }

    fun create(
        name: String,
        code: String,
        phone: String,
        salary: Double,
        password: String,
        branchId: String,
        departmentId: String,
        designationId: String,
        shiftId: String,
    ) {
        viewModelScope.launch {
            _uiState.value = _uiState.value.copy(saving = true, error = null, createdOk = false)
            val body = buildMap<String, Any> {
                put("name", name)
                put("employeeCode", code)
                put("phone", phone)
                put("salary", salary)
                put("branchId", branchId)
                put("departmentId", departmentId)
                put("designationId", designationId)
                put("shiftId", shiftId)
                put("joiningDate", java.time.LocalDate.now().toString())
                if (password.isNotBlank()) put("password", password)
            }
            runCatching { repository.createEmployee(body) }
                .onSuccess {
                    _uiState.value = _uiState.value.copy(saving = false, createdOk = true, notice = "$name onboarded ✓")
                    refresh()
                }
                .onFailure { _uiState.value = _uiState.value.copy(saving = false, error = it.message) }
        }
    }

    fun enrollFace(employeeId: String, photo: ByteArray) {
        if (photo.isEmpty()) return
        viewModelScope.launch {
            _uiState.value = _uiState.value.copy(enrollingId = employeeId, error = null)
            runCatching { repository.enrollFace(employeeId, photo) }
                .onSuccess {
                    _uiState.value = _uiState.value.copy(enrollingId = null, notice = "Face enrolled ✓")
                    refresh()
                }
                .onFailure { _uiState.value = _uiState.value.copy(enrollingId = null, error = it.message) }
        }
    }

    fun consumeNotice() {
        _uiState.value = _uiState.value.copy(notice = null)
    }

    fun consumeCreated() {
        _uiState.value = _uiState.value.copy(createdOk = false)
    }
}
