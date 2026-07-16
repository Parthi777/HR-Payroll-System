package com.hrpayroll

import android.app.Application
import android.app.NotificationChannel
import android.app.NotificationManager
import android.os.Build
import com.google.firebase.FirebaseApp
import com.google.firebase.FirebaseOptions
import dagger.hilt.android.HiltAndroidApp

@HiltAndroidApp
class HrPayrollApp : Application() {
    override fun onCreate() {
        super.onCreate()

        // Alerts channel (claims to approve / approved claims to pay). Created up
        // front so background FCM "notification" messages can post to it.
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            getSystemService(NotificationManager::class.java).createNotificationChannel(
                NotificationChannel(
                    PUSH_CHANNEL_ID,
                    "HR Payroll alerts",
                    NotificationManager.IMPORTANCE_HIGH,
                ),
            )
        }

        // Manual Firebase init from local.properties-injected BuildConfig — no
        // google-services plugin needed. Blank config = push simply disabled.
        if (BuildConfig.FIREBASE_APP_ID.isNotBlank()) {
            runCatching {
                FirebaseApp.initializeApp(
                    this,
                    FirebaseOptions.Builder()
                        .setApplicationId(BuildConfig.FIREBASE_APP_ID)
                        .setApiKey(BuildConfig.FIREBASE_API_KEY)
                        .setProjectId(BuildConfig.FIREBASE_PROJECT_ID)
                        .setGcmSenderId(BuildConfig.FIREBASE_SENDER_ID)
                        .build(),
                )
            }
        }
    }

    companion object {
        const val PUSH_CHANNEL_ID = "hr_payroll_alerts"
    }
}
