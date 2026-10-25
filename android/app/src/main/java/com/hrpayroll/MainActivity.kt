package com.hrpayroll

import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.activity.enableEdgeToEdge
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import com.hrpayroll.data.local.ConsentPrefs
import com.hrpayroll.ui.components.UpdatePrompt
import com.hrpayroll.ui.navigation.HrPayrollNavHost
import com.hrpayroll.ui.screens.consent.ConsentScreen
import com.hrpayroll.ui.theme.HrPayrollTheme
import dagger.hilt.android.AndroidEntryPoint
import javax.inject.Inject

@AndroidEntryPoint
class MainActivity : ComponentActivity() {

    @Inject lateinit var consent: ConsentPrefs

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        enableEdgeToEdge()
        if (consent.accepted) askForNotifications()
        setContent {
            HrPayrollTheme {
                // Nothing else — not sign-in, not a permission prompt — until the
                // terms and the location consent are agreed to.
                var agreed by remember { mutableStateOf(consent.accepted) }
                if (agreed) {
                    HrPayrollNavHost()
                } else {
                    ConsentScreen(
                        onAccept = {
                            consent.accept()
                            agreed = true
                            askForNotifications()
                        },
                        onDecline = { finishAndRemoveTask() },
                    )
                }
                UpdatePrompt() // self-update dialog when a newer APK is published
            }
        }
    }

    /** Android 13+ needs runtime consent to show notification banners. */
    private fun askForNotifications() {
        if (android.os.Build.VERSION.SDK_INT >= 33 &&
            checkSelfPermission(android.Manifest.permission.POST_NOTIFICATIONS) != android.content.pm.PackageManager.PERMISSION_GRANTED
        ) {
            requestPermissions(arrayOf(android.Manifest.permission.POST_NOTIFICATIONS), 100)
        }
    }
}
