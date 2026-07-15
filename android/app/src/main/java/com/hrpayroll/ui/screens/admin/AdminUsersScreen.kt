package com.hrpayroll.ui.screens.admin

import androidx.compose.foundation.background
import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.rememberScrollState
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.PersonAdd
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Card
import androidx.compose.material3.CardDefaults
import androidx.compose.material3.ExtendedFloatingActionButton
import androidx.compose.material3.FilterChip
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Switch
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.PasswordVisualTransformation
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.hilt.navigation.compose.hiltViewModel
import com.hrpayroll.data.remote.dto.AdminUserDto
import com.hrpayroll.ui.components.BrandHeader
import com.hrpayroll.ui.components.StatusChip
import com.hrpayroll.ui.theme.StatusLeave
import com.hrpayroll.ui.theme.StatusLeaveBg
import com.hrpayroll.ui.theme.StatusOff
import com.hrpayroll.ui.theme.StatusOffBg
import com.hrpayroll.ui.theme.StatusPresent
import com.hrpayroll.ui.theme.StatusPresentBg

/** User access control (SUPER_ADMIN): admins/managers for web + mobile admin mode. */
@Composable
fun AdminUsersScreen(
    onBack: (() -> Unit)? = null,
    viewModel: AdminUsersViewModel = hiltViewModel(),
) {
    val state by viewModel.uiState.collectAsState()
    var showAdd by remember { mutableStateOf(false) }

    Scaffold(
        floatingActionButton = {
            if (state.isSuperAdmin) {
                ExtendedFloatingActionButton(
                    onClick = { showAdd = true },
                    icon = { Icon(Icons.Filled.PersonAdd, contentDescription = null) },
                    text = { Text("Add Admin") },
                    containerColor = MaterialTheme.colorScheme.primary,
                )
            }
        },
    ) { pad ->
        Box(modifier = Modifier.fillMaxSize().padding(pad).background(MaterialTheme.colorScheme.background)) {
            Column(modifier = Modifier.fillMaxSize()) {
                BrandHeader(title = "User Access", onBack = onBack)
                Spacer(Modifier.height(8.dp))

                if (!state.isSuperAdmin) {
                    Text(
                        "Only a Super Admin can manage user access.",
                        fontSize = 13.sp,
                        color = MaterialTheme.colorScheme.onBackground.copy(alpha = 0.6f),
                        modifier = Modifier.padding(16.dp),
                    )
                } else if (state.admins.isEmpty()) {
                    Text(
                        state.error ?: "Loading…",
                        fontSize = 13.sp,
                        color = MaterialTheme.colorScheme.onBackground.copy(alpha = 0.6f),
                        modifier = Modifier.padding(16.dp),
                    )
                } else {
                    state.error?.let {
                        Text(it, fontSize = 12.sp, color = StatusOff, modifier = Modifier.padding(horizontal = 16.dp))
                    }
                    LazyColumn(
                        modifier = Modifier.fillMaxSize().padding(horizontal = 16.dp),
                        verticalArrangement = Arrangement.spacedBy(10.dp),
                    ) {
                        items(state.admins) { admin -> AdminRow(admin, onToggle = { on -> admin.id?.let { viewModel.setActive(it, on) } }) }
                        item { Spacer(Modifier.height(80.dp)) }
                    }
                }
            }
        }
    }

    if (showAdd) {
        AddAdminDialog(
            onCreate = { n, e, r, p, done -> viewModel.create(n, e, r, p) { ok -> if (ok) done() } },
            onDismiss = { showAdd = false },
        )
    }
}

@Composable
private fun AdminRow(admin: AdminUserDto, onToggle: (Boolean) -> Unit) {
    Card(
        shape = MaterialTheme.shapes.medium,
        colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.surface),
        elevation = CardDefaults.cardElevation(defaultElevation = 2.dp),
    ) {
        Row(
            modifier = Modifier.fillMaxWidth().padding(14.dp),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            Column(modifier = Modifier.weight(1f)) {
                Text(admin.name ?: "—", fontWeight = FontWeight.SemiBold, color = MaterialTheme.colorScheme.onSurface)
                Text(
                    admin.email ?: "",
                    fontSize = 12.sp,
                    color = MaterialTheme.colorScheme.onSurface.copy(alpha = 0.6f),
                )
                Spacer(Modifier.height(6.dp))
                val (fg, bg) = if (admin.role == "SUPER_ADMIN") StatusOff to StatusOffBg else StatusLeave to StatusLeaveBg
                StatusChip((admin.role ?: "").replace('_', ' '), fg, bg)
            }
            Column(horizontalAlignment = Alignment.CenterHorizontally) {
                Switch(checked = admin.isActive, onCheckedChange = onToggle)
                val (fg, bg) = if (admin.isActive) StatusPresent to StatusPresentBg else StatusOff to StatusOffBg
                StatusChip(if (admin.isActive) "Enabled" else "Disabled", fg, bg)
            }
        }
    }
}

@Composable
private fun AddAdminDialog(
    onCreate: (name: String, email: String, role: String, password: String, done: () -> Unit) -> Unit,
    onDismiss: () -> Unit,
) {
    var name by remember { mutableStateOf("") }
    var email by remember { mutableStateOf("") }
    var role by remember { mutableStateOf("HR_MANAGER") }
    var password by remember { mutableStateOf("") }
    var error by remember { mutableStateOf<String?>(null) }

    AlertDialog(
        onDismissRequest = onDismiss,
        title = { Text("Add Admin / Manager") },
        text = {
            Column {
                OutlinedTextField(value = name, onValueChange = { name = it }, label = { Text("Full name") }, singleLine = true, modifier = Modifier.fillMaxWidth())
                Spacer(Modifier.height(8.dp))
                OutlinedTextField(value = email, onValueChange = { email = it }, label = { Text("Email") }, singleLine = true, modifier = Modifier.fillMaxWidth())
                Spacer(Modifier.height(8.dp))
                Row(modifier = Modifier.horizontalScroll(rememberScrollState()), horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                    ADMIN_ROLES.forEach { r ->
                        FilterChip(selected = role == r, onClick = { role = r }, label = { Text(r.replace('_', ' '), fontSize = 11.sp) })
                    }
                }
                Spacer(Modifier.height(8.dp))
                OutlinedTextField(
                    value = password,
                    onValueChange = { password = it },
                    label = { Text("Password (min 8)") },
                    singleLine = true,
                    visualTransformation = PasswordVisualTransformation(),
                    modifier = Modifier.fillMaxWidth(),
                )
                error?.let { Spacer(Modifier.height(8.dp)); Text(it, color = StatusOff, fontSize = 12.sp) }
            }
        },
        confirmButton = {
            TextButton(onClick = {
                if (name.isBlank() || email.isBlank() || password.length < 8) {
                    error = "Fill all fields — password min 8 characters"
                } else {
                    onCreate(name.trim(), email.trim(), role, password, onDismiss)
                }
            }) { Text("Create") }
        },
        dismissButton = { TextButton(onClick = onDismiss) { Text("Cancel") } },
    )
}
