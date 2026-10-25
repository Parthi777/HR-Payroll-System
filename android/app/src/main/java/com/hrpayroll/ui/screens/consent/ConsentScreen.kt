package com.hrpayroll.ui.screens.consent

import androidx.compose.foundation.Image
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.navigationBarsPadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.statusBarsPadding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.outlined.CameraAlt
import androidx.compose.material.icons.outlined.LocationOn
import androidx.compose.material.icons.outlined.Lock
import androidx.compose.material.icons.outlined.MyLocation
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Checkbox
import androidx.compose.material3.CheckboxDefaults
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.platform.LocalUriHandler
import androidx.compose.ui.res.painterResource
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextDecoration
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.hrpayroll.R
import com.hrpayroll.ui.components.BrandWash
import com.hrpayroll.ui.components.GradientButton
import com.hrpayroll.ui.components.IconBubble
import com.hrpayroll.ui.components.SectionCard
import com.hrpayroll.ui.theme.BrandGreen
import com.hrpayroll.ui.theme.BrandGreenDark
import com.hrpayroll.ui.theme.Ink
import com.hrpayroll.ui.theme.MutedText
import com.hrpayroll.ui.theme.StatusLeave
import com.hrpayroll.ui.theme.StatusOff

/** The public site, where the full Terms and Privacy Policy live. */
private const val LEGAL_SITE = "https://hr.kayaazh.com"

/**
 * Shown the first time the app is opened, before sign-in, and again whenever
 * the wording changes (ConsentPrefs.CURRENT_VERSION). Says plainly what the app
 * collects — selfies, location at check-in, and location during the shift when
 * the employer turns live tracking on — and needs both boxes ticked to go on.
 * Declining closes the app: attendance cannot work without location.
 */
@Composable
fun ConsentScreen(onAccept: () -> Unit, onDecline: () -> Unit) {
    var termsOk by remember { mutableStateOf(false) }
    var locationOk by remember { mutableStateOf(false) }
    var confirmDecline by remember { mutableStateOf(false) }
    val uri = LocalUriHandler.current

    if (confirmDecline) {
        AlertDialog(
            onDismissRequest = { confirmDecline = false },
            title = { Text("The app needs your agreement") },
            text = {
                Text(
                    "Attendance in Kayaazh Payroll works by checking your photo and your location. Without agreeing, " +
                        "the app cannot be used. Speak to your HR team if you have questions.",
                )
            },
            confirmButton = { TextButton(onClick = onDecline) { Text("Close the app") } },
            dismissButton = { TextButton(onClick = { confirmDecline = false }) { Text("Go back") } },
        )
    }

    Box(modifier = Modifier.fillMaxSize().background(Color.White)) {
        BrandWash(Modifier.fillMaxSize())
        Column(
            modifier = Modifier
                .fillMaxSize()
                .statusBarsPadding()
                .navigationBarsPadding()
                .verticalScroll(rememberScrollState())
                .padding(horizontal = 20.dp, vertical = 20.dp),
            verticalArrangement = Arrangement.spacedBy(14.dp),
        ) {
            Image(
                painter = painterResource(R.drawable.brand_payroll_lockup_light),
                contentDescription = "Kayaazh Payroll",
                modifier = Modifier.fillMaxWidth(0.5f).align(Alignment.CenterHorizontally).padding(top = 12.dp),
            )
            Text("Before you start", fontSize = 24.sp, fontWeight = FontWeight.Bold, color = Ink)
            Text(
                "Kayaazh Payroll records your attendance for your employer. Please read what it collects and why.",
                fontSize = 14.sp,
                color = MutedText,
            )

            Point(
                Icons.Outlined.CameraAlt, BrandGreen, "Your photo",
                "A selfie at every check-in and check-out, matched against the face photo your employer enrolled, " +
                    "so nobody can mark attendance for you.",
            )
            Point(
                Icons.Outlined.LocationOn, StatusOff, "Your location at check-in (geofencing)",
                "Your phone's GPS position when you check in and out, to confirm you are at your branch. " +
                    "Check-in may be refused, or held for approval, outside the branch area.",
            )
            Point(
                Icons.Outlined.MyLocation, StatusLeave, "Live tracking during your shift",
                "If your employer turns it on, your location is recorded every 2 minutes from check-in until check-out. " +
                    "You are told when it starts and stops, a notification shows the whole time, and nothing is recorded " +
                    "after you check out or sign out. Time with GPS switched off is reported to your employer.",
            )
            Point(
                Icons.Outlined.Lock, BrandGreenDark, "Who sees it",
                "Only your employer's HR team and your managers. Location history is deleted after 180 days. " +
                    "It is never sold or used for advertising.",
            )

            Row(horizontalArrangement = Arrangement.spacedBy(18.dp)) {
                Link("Terms of use") { uri.openUri("$LEGAL_SITE/terms") }
                Link("Privacy policy") { uri.openUri("$LEGAL_SITE/privacy") }
            }

            Tick(termsOk, { termsOk = it }, "I have read and agree to the Terms of use and the Privacy policy.")
            Tick(
                locationOk, { locationOk = it },
                "I consent to my photo and location being used for attendance, including geofencing at check-in and " +
                    "live location tracking between check-in and check-out when my employer enables it.",
            )

            Spacer(Modifier.height(4.dp))
            GradientButton(text = "Agree and continue", enabled = termsOk && locationOk, onClick = onAccept)
            TextButton(onClick = { confirmDecline = true }, modifier = Modifier.align(Alignment.CenterHorizontally)) {
                Text("I do not agree", color = MutedText)
            }
        }
    }
}

@Composable
private fun Point(icon: ImageVector, tint: Color, title: String, body: String) {
    SectionCard {
        Row(verticalAlignment = Alignment.Top) {
            IconBubble(icon, tint)
            Column(modifier = Modifier.weight(1f).padding(start = 14.dp)) {
                Text(title, fontWeight = FontWeight.SemiBold, color = Ink, fontSize = 15.sp)
                Text(body, fontSize = 13.sp, color = MutedText, lineHeight = 18.sp)
            }
        }
    }
}

@Composable
private fun Tick(checked: Boolean, onChange: (Boolean) -> Unit, label: String) {
    Row(
        verticalAlignment = Alignment.Top,
        modifier = Modifier.fillMaxWidth().clickable { onChange(!checked) },
    ) {
        Checkbox(
            checked = checked,
            onCheckedChange = onChange,
            colors = CheckboxDefaults.colors(checkedColor = BrandGreenDark),
        )
        Text(label, fontSize = 14.sp, color = Ink, modifier = Modifier.padding(top = 12.dp, end = 4.dp))
    }
}

@Composable
private fun Link(text: String, onClick: () -> Unit) {
    Text(
        text,
        color = BrandGreenDark,
        fontSize = 14.sp,
        fontWeight = FontWeight.SemiBold,
        textDecoration = TextDecoration.Underline,
        modifier = Modifier.clickable(onClick = onClick).padding(vertical = 4.dp),
    )
}
