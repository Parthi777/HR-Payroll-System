package com.hrpayroll.ui.screens.admin

import android.Manifest
import android.content.Context
import android.net.Uri
import android.widget.Toast
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Face
import androidx.compose.material.icons.filled.ManageAccounts
import androidx.compose.material.icons.filled.PersonAdd
import androidx.compose.material.icons.filled.PhotoCamera
import androidx.compose.material.icons.filled.PhotoLibrary
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Card
import androidx.compose.material3.CardDefaults
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.ExposedDropdownMenuBox
import androidx.compose.material3.ExposedDropdownMenuDefaults
import androidx.compose.material3.ExtendedFloatingActionButton
import androidx.compose.material3.DropdownMenuItem
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.core.content.ContextCompat
import androidx.core.content.FileProvider
import androidx.hilt.navigation.compose.hiltViewModel
import com.hrpayroll.data.remote.dto.AdminEmployeeDto
import com.hrpayroll.data.remote.dto.MasterItemDto
import com.hrpayroll.ui.components.BrandHeader
import com.hrpayroll.ui.components.StatusChip
import com.hrpayroll.ui.theme.StatusHalf
import com.hrpayroll.ui.theme.StatusHalfBg
import com.hrpayroll.ui.theme.StatusOff
import com.hrpayroll.ui.theme.StatusOffBg
import com.hrpayroll.ui.theme.StatusPresent
import com.hrpayroll.ui.theme.StatusPresentBg
import com.hrpayroll.utils.MediaUtils
import java.io.File

/** People (admin): onboard employees + enroll their face, right from the phone. */
@Composable
fun AdminEmployeesScreen(
    onOpenUsers: () -> Unit = {},
    viewModel: AdminEmployeesViewModel = hiltViewModel(),
) {
    val state by viewModel.uiState.collectAsState()
    val context = LocalContext.current
    var showAdd by remember { mutableStateOf(false) }
    // Employee id whose face is being enrolled (drives the camera/gallery chooser).
    var enrollFor by remember { mutableStateOf<String?>(null) }
    var cameraUri by remember { mutableStateOf<Uri?>(null) }
    var cameraTarget by remember { mutableStateOf<String?>(null) }

    LaunchedEffect(state.notice) {
        state.notice?.let {
            Toast.makeText(context, it, Toast.LENGTH_LONG).show()
            viewModel.consumeNotice()
        }
    }

    val galleryLauncher = rememberLauncherForActivityResult(ActivityResultContracts.GetContent()) { uri ->
        val id = cameraTarget
        if (uri != null && id != null) viewModel.enrollFace(id, MediaUtils.compressImage(context, uri))
        cameraTarget = null
    }
    val cameraLauncher = rememberLauncherForActivityResult(ActivityResultContracts.TakePicture()) { ok ->
        val id = cameraTarget
        val uri = cameraUri
        if (ok && uri != null && id != null) viewModel.enrollFace(id, MediaUtils.compressImage(context, uri))
        cameraTarget = null
    }

    fun launchCamera(employeeId: String) {
        // Unique file per capture — a reused name can upload the PREVIOUS
        // employee's photo if the camera ever fails to overwrite it.
        val file = File(context.cacheDir, "face-enroll-${System.currentTimeMillis()}.jpg")
        val uri = FileProvider.getUriForFile(context, "${context.packageName}.fileprovider", file)
        cameraUri = uri
        cameraTarget = employeeId
        cameraLauncher.launch(uri)
    }

    val cameraPermission = rememberLauncherForActivityResult(ActivityResultContracts.RequestPermission()) { granted ->
        val id = cameraTarget
        if (granted && id != null) launchCamera(id) else cameraTarget = null
    }

    Scaffold(
        floatingActionButton = {
            ExtendedFloatingActionButton(
                onClick = { showAdd = true },
                icon = { Icon(Icons.Filled.PersonAdd, contentDescription = null) },
                text = { Text("Add Employee") },
                containerColor = MaterialTheme.colorScheme.primary,
            )
        },
    ) { pad ->
        Box(modifier = Modifier.fillMaxSize().padding(pad).background(MaterialTheme.colorScheme.background)) {
            Column(modifier = Modifier.fillMaxSize()) {
                BrandHeader(
                    title = "People",
                    trailingIcon = if (viewModel.isSuperAdmin) Icons.Filled.ManageAccounts else null,
                    trailingDescription = "Admin accounts",
                    onTrailing = if (viewModel.isSuperAdmin) onOpenUsers else null,
                )
                Spacer(Modifier.height(8.dp))

                when {
                    state.isLoading && state.employees.isEmpty() ->
                        CircularProgressIndicator(Modifier.padding(24.dp))
                    state.employees.isEmpty() -> Text(
                        state.error ?: "No employees yet. Tap “Add Employee” to onboard the first one.",
                        fontSize = 13.sp,
                        color = MaterialTheme.colorScheme.onBackground.copy(alpha = 0.6f),
                        modifier = Modifier.padding(16.dp),
                    )
                    else -> LazyColumn(
                        modifier = Modifier.fillMaxSize().padding(horizontal = 16.dp),
                        verticalArrangement = Arrangement.spacedBy(10.dp),
                    ) {
                        items(state.employees) { emp ->
                            EmployeeCard(
                                emp = emp,
                                enrolling = state.enrollingId == emp.id,
                                onEnroll = { emp.id?.let { enrollFor = it } },
                            )
                        }
                        item { Spacer(Modifier.height(84.dp)) } // clear the FAB
                    }
                }
            }
        }
    }

    // Face photo source chooser
    enrollFor?.let { employeeId ->
        AlertDialog(
            onDismissRequest = { enrollFor = null },
            title = { Text("Enroll face photo") },
            text = { Text("Take a clear, front-facing photo in good light. It is used to verify selfie attendance and shown as the profile picture.") },
            confirmButton = {
                TextButton(onClick = {
                    enrollFor = null
                    cameraTarget = employeeId
                    val granted = ContextCompat.checkSelfPermission(context, Manifest.permission.CAMERA) ==
                        android.content.pm.PackageManager.PERMISSION_GRANTED
                    if (granted) launchCamera(employeeId) else cameraPermission.launch(Manifest.permission.CAMERA)
                }) {
                    Icon(Icons.Filled.PhotoCamera, contentDescription = null, modifier = Modifier.size(16.dp))
                    Text("  Camera")
                }
            },
            dismissButton = {
                TextButton(onClick = {
                    enrollFor = null
                    cameraTarget = employeeId
                    galleryLauncher.launch("image/*")
                }) {
                    Icon(Icons.Filled.PhotoLibrary, contentDescription = null, modifier = Modifier.size(16.dp))
                    Text("  Gallery")
                }
            },
        )
    }

    if (showAdd) {
        AddEmployeeDialog(
            state = state,
            onCreate = { name, code, phone, salary, pwd, br, de, dg, sh, mg ->
                viewModel.create(name, code, phone, salary, pwd, br, de, dg, sh, mg)
            },
            onDismiss = { showAdd = false },
        )
        // Close the dialog once the create succeeds.
        LaunchedEffect(state.createdOk) {
            if (state.createdOk) {
                showAdd = false
                viewModel.consumeCreated()
            }
        }
    }
}

@Composable
private fun EmployeeCard(emp: AdminEmployeeDto, enrolling: Boolean, onEnroll: () -> Unit) {
    Card(
        shape = MaterialTheme.shapes.medium,
        colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.surface),
        elevation = CardDefaults.cardElevation(defaultElevation = 2.dp),
    ) {
        Row(
            modifier = Modifier.fillMaxWidth().padding(14.dp),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            Box(
                modifier = Modifier.size(42.dp).clip(CircleShape).background(MaterialTheme.colorScheme.primaryContainer),
                contentAlignment = Alignment.Center,
            ) {
                Text(
                    (emp.name ?: "?").split(" ").mapNotNull { it.firstOrNull()?.toString() }.take(2).joinToString(""),
                    fontWeight = FontWeight.Bold,
                    color = MaterialTheme.colorScheme.primary,
                )
            }
            Spacer(Modifier.size(12.dp))
            Column(Modifier.weight(1f)) {
                Text(emp.name ?: "—", fontWeight = FontWeight.SemiBold, color = MaterialTheme.colorScheme.onSurface)
                Text(
                    listOfNotNull(emp.employeeCode, emp.phone, emp.branch?.name).joinToString(" · "),
                    fontSize = 12.sp,
                    color = MaterialTheme.colorScheme.onSurface.copy(alpha = 0.6f),
                )
                Spacer(Modifier.height(6.dp))
                Row(verticalAlignment = Alignment.CenterVertically) {
                    val active = emp.status == "ACTIVE"
                    StatusChip(
                        if (active) "Active" else "Disabled",
                        if (active) StatusPresent else StatusOff,
                        if (active) StatusPresentBg else StatusOffBg,
                    )
                    Spacer(Modifier.size(6.dp))
                    if (emp.faceTemplateId != null) {
                        StatusChip("Face ✓", StatusPresent, StatusPresentBg)
                    } else {
                        StatusChip("No face", StatusHalf, StatusHalfBg)
                    }
                }
            }
            OutlinedButton(onClick = onEnroll, enabled = !enrolling) {
                if (enrolling) {
                    CircularProgressIndicator(Modifier.size(16.dp), strokeWidth = 2.dp)
                } else {
                    Icon(Icons.Filled.Face, contentDescription = null, modifier = Modifier.size(16.dp))
                    Text(if (emp.faceTemplateId != null) " Re-enroll" else " Enroll")
                }
            }
        }
    }
}

/** Onboarding form: identity, salary, app password + org assignment dropdowns. */
@Composable
private fun AddEmployeeDialog(
    state: AdminEmployeesUiState,
    onCreate: (
        name: String, code: String, phone: String, salary: Double, password: String,
        branchId: String, departmentId: String, designationId: String, shiftId: String,
        reportingManagerId: String?,
    ) -> Unit,
    onDismiss: () -> Unit,
) {
    var name by remember { mutableStateOf("") }
    var code by remember { mutableStateOf("") }
    var phone by remember { mutableStateOf("") }
    var salary by remember { mutableStateOf("") }
    var password by remember { mutableStateOf("") }
    var branch by remember { mutableStateOf<MasterItemDto?>(state.branches.firstOrNull()) }
    var department by remember { mutableStateOf<MasterItemDto?>(state.departments.firstOrNull()) }
    var designation by remember { mutableStateOf<MasterItemDto?>(state.designations.firstOrNull()) }
    var shift by remember { mutableStateOf<MasterItemDto?>(state.shifts.firstOrNull()) }
    var manager by remember { mutableStateOf<MasterItemDto?>(null) }
    var localError by remember { mutableStateOf<String?>(null) }

    AlertDialog(
        onDismissRequest = onDismiss,
        title = { Text("Onboard Employee", fontWeight = FontWeight.Bold) },
        text = {
            Column(modifier = Modifier.verticalScroll(rememberScrollState())) {
                OutlinedTextField(value = name, onValueChange = { name = it }, label = { Text("Full name *") }, singleLine = true, modifier = Modifier.fillMaxWidth())
                Spacer(Modifier.height(8.dp))
                Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                    OutlinedTextField(value = code, onValueChange = { code = it.uppercase() }, label = { Text("Emp code *") }, singleLine = true, modifier = Modifier.weight(1f))
                    OutlinedTextField(
                        value = salary,
                        onValueChange = { salary = it.filter { c -> c.isDigit() || c == '.' } },
                        label = { Text("Salary ₹ *") },
                        singleLine = true,
                        keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Decimal),
                        modifier = Modifier.weight(1f),
                    )
                }
                Spacer(Modifier.height(8.dp))
                OutlinedTextField(
                    value = phone,
                    onValueChange = { phone = it },
                    label = { Text("Phone (login id) *") },
                    placeholder = { Text("+91XXXXXXXXXX") },
                    singleLine = true,
                    keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Phone),
                    modifier = Modifier.fillMaxWidth(),
                )
                Spacer(Modifier.height(8.dp))
                OutlinedTextField(
                    value = password,
                    onValueChange = { password = it },
                    label = { Text("App password (min 4)") },
                    singleLine = true,
                    modifier = Modifier.fillMaxWidth(),
                )
                Spacer(Modifier.height(8.dp))
                MasterDropdown("Branch", state.branches, branch) { branch = it }
                Spacer(Modifier.height(8.dp))
                MasterDropdown("Department", state.departments, department) { department = it }
                Spacer(Modifier.height(8.dp))
                MasterDropdown("Designation", state.designations, designation) { designation = it }
                Spacer(Modifier.height(8.dp))
                MasterDropdown("Shift", state.shifts, shift) { shift = it }
                Spacer(Modifier.height(8.dp))
                MasterDropdown("Reporting manager (approvals)", state.managers, manager) { manager = it }

                (localError ?: state.error)?.let {
                    Spacer(Modifier.height(8.dp))
                    Text(it, color = MaterialTheme.colorScheme.error, fontSize = 12.sp)
                }
            }
        },
        confirmButton = {
            TextButton(
                enabled = !state.saving,
                onClick = {
                    val sal = salary.toDoubleOrNull()
                    val br = branch?.id; val de = department?.id; val dg = designation?.id; val sh = shift?.id
                    if (name.isBlank() || code.isBlank() || phone.length < 10 || sal == null || sal <= 0) {
                        localError = "Fill name, code, a valid phone and salary"
                    } else if (br == null || de == null || dg == null || sh == null) {
                        localError = "Create branch/department/designation/shift on the web first"
                    } else {
                        localError = null
                        onCreate(name.trim(), code.trim(), phone.trim(), sal, password, br, de, dg, sh, manager?.id)
                    }
                },
            ) {
                if (state.saving) CircularProgressIndicator(Modifier.size(16.dp), strokeWidth = 2.dp)
                else Text("Onboard")
            }
        },
        dismissButton = { TextButton(onClick = onDismiss) { Text("Cancel") } },
    )
}

@OptIn(ExperimentalMaterial3Api::class)
@Composable
private fun MasterDropdown(
    label: String,
    items: List<MasterItemDto>,
    selected: MasterItemDto?,
    onSelect: (MasterItemDto) -> Unit,
) {
    var expanded by remember { mutableStateOf(false) }
    ExposedDropdownMenuBox(expanded = expanded, onExpandedChange = { expanded = it }) {
        OutlinedTextField(
            value = selected?.name ?: "Select…",
            onValueChange = {},
            readOnly = true,
            label = { Text(label) },
            trailingIcon = { ExposedDropdownMenuDefaults.TrailingIcon(expanded = expanded) },
            modifier = Modifier.fillMaxWidth().menuAnchor(),
        )
        ExposedDropdownMenu(expanded = expanded, onDismissRequest = { expanded = false }) {
            items.forEach { item ->
                DropdownMenuItem(
                    text = { Text(item.name ?: "—") },
                    onClick = {
                        onSelect(item)
                        expanded = false
                    },
                )
            }
        }
    }
}
