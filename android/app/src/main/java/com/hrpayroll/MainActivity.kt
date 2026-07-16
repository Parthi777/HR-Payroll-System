package com.hrpayroll

import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.activity.enableEdgeToEdge
import com.hrpayroll.ui.components.UpdatePrompt
import com.hrpayroll.ui.navigation.HrPayrollNavHost
import com.hrpayroll.ui.theme.HrPayrollTheme
import dagger.hilt.android.AndroidEntryPoint

@AndroidEntryPoint
class MainActivity : ComponentActivity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        enableEdgeToEdge()
        // Android 13+ needs runtime consent to show notification banners.
        if (android.os.Build.VERSION.SDK_INT >= 33 &&
            checkSelfPermission(android.Manifest.permission.POST_NOTIFICATIONS) != android.content.pm.PackageManager.PERMISSION_GRANTED
        ) {
            requestPermissions(arrayOf(android.Manifest.permission.POST_NOTIFICATIONS), 100)
        }
        setContent {
            HrPayrollTheme {
                HrPayrollNavHost()
                UpdatePrompt() // self-update dialog when a newer APK is published
            }
        }
    }
}
