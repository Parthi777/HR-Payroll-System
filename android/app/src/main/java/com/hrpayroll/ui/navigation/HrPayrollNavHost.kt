package com.hrpayroll.ui.navigation

import androidx.compose.foundation.layout.padding
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Assessment
import androidx.compose.material.icons.filled.CalendarMonth
import androidx.compose.material.icons.filled.CheckCircle
import androidx.compose.material.icons.filled.Dashboard
import androidx.compose.material.icons.filled.Groups
import androidx.compose.material.icons.filled.Home
import androidx.compose.material.icons.filled.ManageAccounts
import androidx.compose.material.icons.filled.Payments
import androidx.compose.material.icons.filled.ReceiptLong
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
import androidx.navigation.NavType
import androidx.navigation.compose.NavHost
import androidx.navigation.compose.composable
import androidx.navigation.compose.currentBackStackEntryAsState
import androidx.navigation.compose.rememberNavController
import androidx.navigation.navArgument
import com.hrpayroll.ui.screens.admin.AdminClaimsScreen
import com.hrpayroll.ui.screens.admin.AdminDashboardScreen
import com.hrpayroll.ui.screens.admin.AdminUsersScreen
import com.hrpayroll.ui.screens.admin.LiveAttendanceScreen
import com.hrpayroll.ui.screens.admin.PerformanceScreen
import com.hrpayroll.ui.screens.claim.ClaimSubmitScreen
import com.hrpayroll.ui.screens.claim.MyClaimsScreen
import com.hrpayroll.ui.screens.home.HomeScreen
import com.hrpayroll.ui.screens.attendance.AttendanceScreen
import com.hrpayroll.ui.screens.attendance.CameraCaptureScreen
import com.hrpayroll.ui.screens.leave.LeaveScreen
import com.hrpayroll.ui.screens.login.LoginScreen
import com.hrpayroll.ui.screens.payslip.PayslipScreen
import com.hrpayroll.ui.screens.shift.ShiftScreen
import com.hrpayroll.ui.theme.BrandIndigo

object Routes {
    const val LOGIN = "login"
    const val HOME = "home"
    const val ATTENDANCE = "attendance"
    const val CAMERA = "camera"
    const val SHIFT = "shift"
    const val LEAVE = "leave"
    const val CLAIMS = "claims"
    const val CLAIM_SUBMIT = "claim_submit/{claimId}"
    const val PAYSLIP = "payslip"

    // Admin section
    const val ADMIN_DASHBOARD = "admin_dashboard"
    const val ADMIN_LIVE = "admin_live"
    const val ADMIN_PERFORMANCE = "admin_performance"
    const val ADMIN_CLAIMS = "admin_claims"
    const val ADMIN_USERS = "admin_users"
}

/** Build the claim submit route; pass "new" for a fresh claim or a claim id to resubmit. */
fun claimSubmitRoute(claimId: String): String = "claim_submit/$claimId"

private data class BottomTab(val route: String, val label: String, val icon: ImageVector)

private val employeeTabs = listOf(
    BottomTab(Routes.HOME, "Home", Icons.Filled.Home),
    BottomTab(Routes.ATTENDANCE, "Attendance", Icons.Filled.CheckCircle),
    BottomTab(Routes.LEAVE, "Leave", Icons.Filled.CalendarMonth),
    BottomTab(Routes.CLAIMS, "Claims", Icons.Filled.ReceiptLong),
    BottomTab(Routes.PAYSLIP, "Payslip", Icons.Filled.Payments),
)

private val adminTabs = listOf(
    BottomTab(Routes.ADMIN_DASHBOARD, "Dashboard", Icons.Filled.Dashboard),
    BottomTab(Routes.ADMIN_LIVE, "Live", Icons.Filled.Groups),
    BottomTab(Routes.ADMIN_CLAIMS, "Claims", Icons.Filled.ReceiptLong),
    BottomTab(Routes.ADMIN_PERFORMANCE, "Performance", Icons.Filled.Assessment),
    BottomTab(Routes.ADMIN_USERS, "Users", Icons.Filled.ManageAccounts),
)

@Composable
fun HrPayrollNavHost() {
    val navController = rememberNavController()
    val backStackEntry by navController.currentBackStackEntryAsState()
    val currentRoute = backStackEntry?.destination?.route

    // Pick the tab set for the active section (employee vs admin); null = no bottom bar.
    val tabs = when (currentRoute) {
        in adminTabs.map { it.route } -> adminTabs
        in employeeTabs.map { it.route } -> employeeTabs
        else -> null
    }

    Scaffold(
        bottomBar = {
            if (tabs != null) {
                NavigationBar(containerColor = Color.White) {
                    tabs.forEach { tab ->
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
                LoginScreen(onLoggedIn = { isAdmin ->
                    val dest = if (isAdmin) Routes.ADMIN_DASHBOARD else Routes.HOME
                    navController.navigate(dest) {
                        popUpTo(Routes.LOGIN) { inclusive = true }
                    }
                })
            }

            // Employee
            composable(Routes.HOME) {
                HomeScreen(
                    onCheckIn = { navController.navigate(Routes.CAMERA) },
                    onPayslip = { navController.navigate(Routes.PAYSLIP) },
                )
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

            // Claims
            composable(Routes.CLAIMS) {
                MyClaimsScreen(
                    onNew = { navController.navigate(claimSubmitRoute("new")) },
                    onResubmit = { id -> navController.navigate(claimSubmitRoute(id)) },
                )
            }
            composable(
                Routes.CLAIM_SUBMIT,
                arguments = listOf(navArgument("claimId") { type = NavType.StringType }),
            ) {
                ClaimSubmitScreen(
                    onSubmitted = { navController.popBackStack() },
                    onBack = { navController.popBackStack() },
                )
            }

            // Admin
            composable(Routes.ADMIN_DASHBOARD) {
                AdminDashboardScreen(onLogout = {
                    navController.navigate(Routes.LOGIN) {
                        popUpTo(0) { inclusive = true } // clear the whole back stack
                    }
                })
            }
            composable(Routes.ADMIN_LIVE) { LiveAttendanceScreen() }
            composable(Routes.ADMIN_CLAIMS) { AdminClaimsScreen() }
            composable(Routes.ADMIN_PERFORMANCE) { PerformanceScreen() }
            composable(Routes.ADMIN_USERS) { AdminUsersScreen() }
        }
    }
}
