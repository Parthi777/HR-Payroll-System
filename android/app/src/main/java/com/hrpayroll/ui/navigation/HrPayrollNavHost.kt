package com.hrpayroll.ui.navigation

import androidx.compose.foundation.layout.padding
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.CalendarMonth
import androidx.compose.material.icons.filled.CheckCircle
import androidx.compose.material.icons.filled.Payments
import androidx.compose.material.icons.filled.Schedule
import androidx.compose.material3.Icon
import androidx.compose.material3.NavigationBar
import androidx.compose.material3.NavigationBarItem
import androidx.compose.material3.NavigationBarItemDefaults
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.navigation.NavGraph.Companion.findStartDestination
import androidx.navigation.compose.NavHost
import androidx.navigation.compose.composable
import androidx.navigation.compose.currentBackStackEntryAsState
import androidx.navigation.compose.rememberNavController
import com.hrpayroll.ui.screens.attendance.AttendanceScreen
import com.hrpayroll.ui.screens.attendance.CameraCaptureScreen
import com.hrpayroll.ui.screens.leave.LeaveScreen
import com.hrpayroll.ui.screens.login.LoginScreen
import com.hrpayroll.ui.screens.payslip.PayslipScreen
import com.hrpayroll.ui.screens.shift.ShiftScreen
import com.hrpayroll.ui.theme.BrandIndigo

object Routes {
    const val LOGIN = "login"
    const val ATTENDANCE = "attendance"
    const val CAMERA = "camera"
    const val SHIFT = "shift"
    const val LEAVE = "leave"
    const val PAYSLIP = "payslip"
}

private data class BottomTab(val route: String, val label: String, val icon: ImageVector)

private val bottomTabs = listOf(
    BottomTab(Routes.ATTENDANCE, "Attendance", Icons.Filled.CheckCircle),
    BottomTab(Routes.SHIFT, "Shift", Icons.Filled.Schedule),
    BottomTab(Routes.LEAVE, "Leave", Icons.Filled.CalendarMonth),
    BottomTab(Routes.PAYSLIP, "Payslip", Icons.Filled.Payments),
)

@Composable
fun HrPayrollNavHost() {
    val navController = rememberNavController()
    val backStackEntry by navController.currentBackStackEntryAsState()
    val currentRoute = backStackEntry?.destination?.route

    // Bottom bar only on the main employee tabs (not login / full-screen camera).
    val showBottomBar = currentRoute in bottomTabs.map { it.route }

    Scaffold(
        bottomBar = {
            if (showBottomBar) {
                NavigationBar(containerColor = Color.White) {
                    bottomTabs.forEach { tab ->
                        NavigationBarItem(
                            selected = currentRoute == tab.route,
                            onClick = {
                                navController.navigate(tab.route) {
                                    popUpTo(navController.graph.findStartDestination().id) { saveState = true }
                                    launchSingleTop = true
                                    restoreState = true
                                }
                            },
                            icon = { Icon(tab.icon, contentDescription = tab.label) },
                            label = { Text(tab.label) },
                            colors = NavigationBarItemDefaults.colors(
                                selectedIconColor = BrandIndigo,
                                selectedTextColor = BrandIndigo,
                                indicatorColor = Color(0xFFEFEEFB),
                            ),
                        )
                    }
                }
            }
        },
    ) { innerPadding ->
        NavHost(
            navController = navController,
            startDestination = Routes.LOGIN,
            modifier = androidx.compose.ui.Modifier.padding(innerPadding),
        ) {
            composable(Routes.LOGIN) {
                LoginScreen(onLoggedIn = {
                    navController.navigate(Routes.ATTENDANCE) {
                        popUpTo(Routes.LOGIN) { inclusive = true }
                    }
                })
            }
            composable(Routes.ATTENDANCE) {
                AttendanceScreen(onCheckIn = { navController.navigate(Routes.CAMERA) })
            }
            composable(Routes.CAMERA) {
                CameraCaptureScreen(
                    onDone = { navController.popBackStack() },
                    onCancel = { navController.popBackStack() },
                )
            }
            composable(Routes.SHIFT) { ShiftScreen() }
            composable(Routes.LEAVE) { LeaveScreen() }
            composable(Routes.PAYSLIP) { PayslipScreen() }
        }
    }
}
