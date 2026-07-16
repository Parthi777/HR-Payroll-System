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
        setContent {
            HrPayrollTheme {
                HrPayrollNavHost()
                UpdatePrompt() // self-update dialog when a newer APK is published
            }
        }
    }
}
