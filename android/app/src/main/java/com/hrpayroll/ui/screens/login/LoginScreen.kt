package com.hrpayroll.ui.screens.login

import androidx.compose.animation.animateColorAsState
import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.Canvas
import androidx.compose.foundation.Image
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.imePadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.statusBarsPadding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.ArrowForward
import androidx.compose.material.icons.filled.Visibility
import androidx.compose.material.icons.filled.VisibilityOff
import androidx.compose.material.icons.outlined.AdminPanelSettings
import androidx.compose.material.icons.outlined.Badge
import androidx.compose.material.icons.outlined.Business
import androidx.compose.material.icons.outlined.Email
import androidx.compose.material.icons.outlined.ErrorOutline
import androidx.compose.material.icons.outlined.Face
import androidx.compose.material.icons.outlined.LocationOn
import androidx.compose.material.icons.outlined.Lock
import androidx.compose.material.icons.outlined.Payments
import androidx.compose.material.icons.outlined.Person
import androidx.compose.material3.Card
import androidx.compose.material3.CardDefaults
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.OutlinedTextFieldDefaults
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.alpha
import androidx.compose.ui.draw.clip
import androidx.compose.ui.draw.shadow
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.res.painterResource
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.KeyboardCapitalization
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.text.input.PasswordVisualTransformation
import androidx.compose.ui.text.input.VisualTransformation
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.hilt.navigation.compose.hiltViewModel
import com.hrpayroll.BuildConfig
import com.hrpayroll.R
import com.hrpayroll.ui.theme.BrandGold
import com.hrpayroll.ui.theme.BrandGreen
import com.hrpayroll.ui.theme.BrandGreenBright
import com.hrpayroll.ui.theme.BrandGreenDark
import com.hrpayroll.ui.theme.BrandMint
import com.hrpayroll.ui.theme.Ink

/** Soft greys that sit with the brand green on white. */
private val Muted = Color(0xFF66716D)
private val FieldBorder = Color(0xFFDDE6E2)
private val FieldFill = Color(0xFFF6FAF8)
private val TrackFill = Color(0xFFEDF5F1)

/**
 * Sign-in with credentials an administrator issued: an employee's user ID
 * (employee code or phone) + password, or an admin's email + password and then
 * a code from an authenticator app. Wired to /api/auth via LoginViewModel.
 *
 * Light, on purpose: the coloured logo sits on white (the brand kit's rule),
 * brand green carries the actions, and a wash of green and yellow at the top is
 * the only decoration.
 */
@Composable
fun LoginScreen(
    onLoggedIn: (isAdmin: Boolean) -> Unit,
    viewModel: LoginViewModel = hiltViewModel(),
) {
    val state by viewModel.uiState.collectAsState()

    LaunchedEffect(state.loggedIn) {
        if (state.loggedIn) onLoggedIn(state.isAdmin)
    }

    Box(modifier = Modifier.fillMaxSize().background(Color.White)) {
        BrandWash()

        Column(
            modifier = Modifier
                .fillMaxSize()
                .statusBarsPadding()
                .imePadding()
                .verticalScroll(rememberScrollState())
                .padding(horizontal = 22.dp, vertical = 20.dp),
            horizontalAlignment = Alignment.CenterHorizontally,
        ) {
            Spacer(Modifier.height(28.dp))
            Image(
                painter = painterResource(R.drawable.brand_payroll_lockup_light),
                contentDescription = "Kayaazh Payroll",
                modifier = Modifier.fillMaxWidth(0.64f),
            )
            Spacer(Modifier.height(30.dp))

            val twoStep = state.twoStep
            if (twoStep != null) {
                TwoStepCard(stage = twoStep, state = state, viewModel = viewModel)
                Footer()
                return@Column
            }

            Text(
                "Welcome back",
                color = Ink,
                fontSize = 28.sp,
                fontWeight = FontWeight.Bold,
                textAlign = TextAlign.Center,
            )
            Spacer(Modifier.height(6.dp))
            Text(
                if (state.adminMode) "Sign in to manage attendance, approvals and payroll."
                else "Sign in to mark attendance, see your shifts and payslips.",
                color = Muted,
                fontSize = 14.sp,
                textAlign = TextAlign.Center,
                modifier = Modifier.padding(horizontal = 12.dp),
            )
            Spacer(Modifier.height(24.dp))

            Card(
                modifier = Modifier.fillMaxWidth(),
                shape = RoundedCornerShape(28.dp),
                colors = CardDefaults.cardColors(containerColor = Color.White),
                border = BorderStroke(1.dp, Color(0xFFE8EFEC)),
                elevation = CardDefaults.cardElevation(defaultElevation = 6.dp),
            ) {
                Column(modifier = Modifier.padding(20.dp)) {
                    RoleSwitch(adminMode = state.adminMode, onChange = viewModel::setAdminMode)
                    Spacer(Modifier.height(20.dp))

                    if (state.adminMode) {
                        LoginField(
                            value = state.email,
                            onValueChange = viewModel::onEmailChange,
                            label = "Email address",
                            placeholder = "you@company.com",
                            icon = Icons.Outlined.Email,
                            keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Email),
                        )
                    } else {
                        LoginField(
                            value = state.userId,
                            onValueChange = viewModel::onUserIdChange,
                            label = "Employee ID or phone",
                            placeholder = "EMP001 or 9000000001",
                            icon = Icons.Outlined.Badge,
                            keyboardOptions = KeyboardOptions(
                                keyboardType = KeyboardType.Ascii,
                                capitalization = KeyboardCapitalization.Characters,
                            ),
                        )
                    }
                    Spacer(Modifier.height(14.dp))
                    LoginField(
                        value = state.password,
                        onValueChange = viewModel::onPasswordChange,
                        label = "Password",
                        placeholder = null,
                        icon = Icons.Outlined.Lock,
                        keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Password),
                        isPassword = true,
                    )
                    // Only shown once the server says it cannot tell which
                    // workspace this is — with a single dealer it never appears.
                    if (state.needsCompanyCode) {
                        Spacer(Modifier.height(14.dp))
                        LoginField(
                            value = state.companyCode,
                            onValueChange = viewModel::onCompanyCodeChange,
                            label = "Company code",
                            placeholder = "e.g. abc-motors",
                            icon = Icons.Outlined.Business,
                            keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Text),
                        )
                    }

                    state.error?.let {
                        Spacer(Modifier.height(14.dp))
                        ErrorNote(it)
                    }

                    Spacer(Modifier.height(20.dp))
                    PrimaryButton(
                        text = if (state.adminMode) "Sign in to Master Control" else "Sign in",
                        loading = state.isLoading,
                        onClick = if (state.adminMode) viewModel::adminLogin else viewModel::login,
                    )
                    Spacer(Modifier.height(12.dp))
                    Text(
                        if (state.adminMode) "You will also enter a code from your authenticator app."
                        else "Your ID and password are issued by your HR team.",
                        color = Muted,
                        fontSize = 12.sp,
                        textAlign = TextAlign.Center,
                        modifier = Modifier.fillMaxWidth(),
                    )
                }
            }

            Spacer(Modifier.height(22.dp))
            Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                FeatureChip(Icons.Outlined.Face, "Face check-in", BrandGreen)
                FeatureChip(Icons.Outlined.LocationOn, "GPS verified", BrandGreen)
                FeatureChip(Icons.Outlined.Payments, "Payslips", Color(0xFFB07D0C))
            }
            Footer()
        }
    }
}

/** A light wash of the brand at the top of the screen: mint, with a green and a yellow glow. */
@Composable
private fun BrandWash() {
    Canvas(modifier = Modifier.fillMaxWidth().height(420.dp)) {
        drawRect(Brush.verticalGradient(listOf(Color(0xFFE3F5EE), Color(0xFFF4FBF8), Color.White)))
        val green = Offset(size.width * 0.08f, size.height * 0.12f)
        drawCircle(
            brush = Brush.radialGradient(listOf(BrandGreenBright.copy(alpha = 0.20f), Color.Transparent), center = green, radius = size.width * 0.75f),
            radius = size.width * 0.75f,
            center = green,
        )
        val gold = Offset(size.width * 0.96f, size.height * 0.22f)
        drawCircle(
            brush = Brush.radialGradient(listOf(BrandGold.copy(alpha = 0.22f), Color.Transparent), center = gold, radius = size.width * 0.55f),
            radius = size.width * 0.55f,
            center = gold,
        )
    }
}

/** Employee / Admin, as a two-way switch: a white pill sliding on a mint track. */
@Composable
private fun RoleSwitch(adminMode: Boolean, onChange: (Boolean) -> Unit) {
    Row(
        modifier = Modifier
            .fillMaxWidth()
            .clip(RoundedCornerShape(18.dp))
            .background(TrackFill)
            .padding(4.dp),
        horizontalArrangement = Arrangement.spacedBy(4.dp),
    ) {
        RoleOption("Employee", Icons.Outlined.Person, selected = !adminMode, modifier = Modifier.weight(1f)) { onChange(false) }
        RoleOption("Admin", Icons.Outlined.AdminPanelSettings, selected = adminMode, modifier = Modifier.weight(1f)) { onChange(true) }
    }
}

@Composable
private fun RoleOption(text: String, icon: ImageVector, selected: Boolean, modifier: Modifier, onClick: () -> Unit) {
    val content by animateColorAsState(if (selected) BrandGreen else Muted, label = "role-content")
    val fill by animateColorAsState(if (selected) Color.White else Color.Transparent, label = "role-fill")
    Row(
        modifier = modifier
            .then(if (selected) Modifier.shadow(3.dp, RoundedCornerShape(14.dp)) else Modifier)
            .clip(RoundedCornerShape(14.dp))
            .background(fill)
            .clickable(onClick = onClick)
            .padding(vertical = 12.dp),
        horizontalArrangement = Arrangement.Center,
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Icon(icon, contentDescription = null, tint = content, modifier = Modifier.size(18.dp))
        Spacer(Modifier.width(6.dp))
        Text(text, color = content, fontSize = 14.sp, fontWeight = FontWeight.SemiBold)
    }
}

@Composable
private fun LoginField(
    value: String,
    onValueChange: (String) -> Unit,
    label: String,
    placeholder: String?,
    icon: ImageVector,
    keyboardOptions: KeyboardOptions,
    isPassword: Boolean = false,
) {
    var visible by remember { mutableStateOf(false) }
    OutlinedTextField(
        value = value,
        onValueChange = onValueChange,
        label = { Text(label) },
        placeholder = placeholder?.let { { Text(it, color = Color(0xFFA3ADA9)) } },
        leadingIcon = { Icon(icon, contentDescription = null, tint = BrandGreen) },
        trailingIcon = if (isPassword) {
            {
                IconButton(onClick = { visible = !visible }) {
                    Icon(
                        if (visible) Icons.Filled.VisibilityOff else Icons.Filled.Visibility,
                        contentDescription = if (visible) "Hide password" else "Show password",
                        tint = Muted,
                    )
                }
            }
        } else null,
        visualTransformation = if (isPassword && !visible) PasswordVisualTransformation() else VisualTransformation.None,
        singleLine = true,
        shape = RoundedCornerShape(16.dp),
        keyboardOptions = keyboardOptions,
        colors = OutlinedTextFieldDefaults.colors(
            focusedBorderColor = BrandGreen,
            unfocusedBorderColor = FieldBorder,
            focusedContainerColor = Color.White,
            unfocusedContainerColor = FieldFill,
            focusedLabelColor = BrandGreen,
            unfocusedLabelColor = Muted,
            cursorColor = BrandGreen,
            focusedTextColor = Ink,
            unfocusedTextColor = Ink,
        ),
        modifier = Modifier.fillMaxWidth(),
    )
}

@Composable
private fun ErrorNote(message: String) {
    Row(
        modifier = Modifier
            .fillMaxWidth()
            .clip(RoundedCornerShape(14.dp))
            .background(Color(0xFFFDECEE))
            .border(1.dp, Color(0xFFF7C9CF), RoundedCornerShape(14.dp))
            .padding(horizontal = 12.dp, vertical = 10.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Icon(Icons.Outlined.ErrorOutline, contentDescription = null, tint = Color(0xFFC81E3A), modifier = Modifier.size(18.dp))
        Spacer(Modifier.width(8.dp))
        Text(message, color = Color(0xFF9F1830), fontSize = 13.sp, fontWeight = FontWeight.Medium)
    }
}

@Composable
private fun FeatureChip(icon: ImageVector, text: String, tint: Color) {
    Row(
        modifier = Modifier
            .clip(RoundedCornerShape(50))
            .background(BrandMint.copy(alpha = 0.7f))
            .padding(horizontal = 10.dp, vertical = 6.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Icon(icon, contentDescription = null, tint = tint, modifier = Modifier.size(14.dp))
        Spacer(Modifier.width(4.dp))
        Text(text, color = Ink.copy(alpha = 0.75f), fontSize = 11.sp, fontWeight = FontWeight.Medium)
    }
}

@Composable
private fun Footer() {
    Spacer(Modifier.height(18.dp))
    Text(
        "Kayaazh Payroll · v${BuildConfig.VERSION_NAME}",
        color = Muted,
        fontSize = 11.sp,
        modifier = Modifier.alpha(0.8f),
    )
}

/**
 * The main action: a green pill with an arrow. Shaded from the deeper brand
 * green, which is what keeps the white label readable.
 */
@Composable
internal fun PrimaryButton(text: String, loading: Boolean, onClick: () -> Unit) {
    Box(
        modifier = Modifier
            .fillMaxWidth()
            .height(56.dp)
            .shadow(if (loading) 0.dp else 8.dp, RoundedCornerShape(18.dp), ambientColor = BrandGreen, spotColor = BrandGreen)
            .clip(RoundedCornerShape(18.dp))
            .background(Brush.horizontalGradient(listOf(BrandGreen, BrandGreenDark)))
            .clickable(enabled = !loading, onClick = onClick),
        contentAlignment = Alignment.Center,
    ) {
        if (loading) {
            CircularProgressIndicator(modifier = Modifier.size(22.dp), color = Color.White, strokeWidth = 2.dp)
        } else {
            Row(verticalAlignment = Alignment.CenterVertically) {
                Text(text, color = Color.White, fontSize = 16.sp, fontWeight = FontWeight.Bold)
                Spacer(Modifier.width(8.dp))
                Icon(Icons.AutoMirrored.Filled.ArrowForward, contentDescription = null, tint = Color.White, modifier = Modifier.size(20.dp))
            }
        }
    }
}
