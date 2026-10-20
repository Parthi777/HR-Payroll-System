package com.hrpayroll.data.local

import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import javax.inject.Inject
import javax.inject.Singleton

/**
 * Whether this employee's dealer shares payroll with staff (Master Control →
 * Settings → "Show payroll to employees"). Read from `/me` when the home screen
 * loads; the bottom bar shows the Payroll tab only while it is true. The server
 * refuses the payroll requests when it is off, so this is presentation only.
 */
@Singleton
class PayrollAccess @Inject constructor() {
    private val _visible = MutableStateFlow(false)
    val visible: StateFlow<Boolean> = _visible.asStateFlow()

    fun set(visible: Boolean) { _visible.value = visible }
}
