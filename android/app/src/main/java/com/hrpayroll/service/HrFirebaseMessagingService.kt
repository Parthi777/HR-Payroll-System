package com.hrpayroll.service

import com.google.firebase.messaging.FirebaseMessagingService
import com.google.firebase.messaging.RemoteMessage

/** Receives FCM push (shift changes, leave status, payslip). TODO: post notifications. */
class HrFirebaseMessagingService : FirebaseMessagingService() {
    override fun onNewToken(token: String) {
        // TODO: register device token with backend
    }

    override fun onMessageReceived(message: RemoteMessage) {
        // TODO: build + show a notification from message.notification / message.data
    }
}
