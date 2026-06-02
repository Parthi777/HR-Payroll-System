package com.hrpayroll.ui.navigation

import androidx.compose.runtime.Composable
import androidx.navigation.compose.NavHost
import androidx.navigation.compose.composable
import androidx.navigation.compose.rememberNavController
import com.hrpayroll.ui.screens.attendance.AttendanceScreen
import com.hrpayroll.ui.screens.leave.LeaveScreen
import com.hrpayroll.ui.screens.login.LoginScreen
import com.hrpayroll.ui.screens.payslip.PayslipScreen
import com.hrpayroll.ui.screens.shift.ShiftScreen

object Routes {
    const val LOGIN = "login"
    const val ATTENDANCE = "attendance"
    const val SHIFT = "shift"
    const val LEAVE = "leave"
    const val PAYSLIP = "payslip"
}

@Composable
fun HrPayrollNavHost() {
    val navController = rememberNavController()

    NavHost(navController = navController, startDestination = Routes.LOGIN) {
        composable(Routes.LOGIN) { LoginScreen(onLoggedIn = { navController.navigate(Routes.ATTENDANCE) }) }
        composable(Routes.ATTENDANCE) { AttendanceScreen() }
        composable(Routes.SHIFT) { ShiftScreen() }
        composable(Routes.LEAVE) { LeaveScreen() }
        composable(Routes.PAYSLIP) { PayslipScreen() }
    }
}
