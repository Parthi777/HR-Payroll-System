package com.hrpayroll.ui.navigation

import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.padding
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Assessment
import androidx.compose.material.icons.filled.CalendarMonth
import androidx.compose.material.icons.filled.CheckCircle
import androidx.compose.material.icons.filled.Dashboard
import androidx.compose.material.icons.filled.Groups
import androidx.compose.material.icons.filled.Home
import androidx.compose.material.icons.filled.Payments
import androidx.compose.material.icons.filled.ReceiptLong
import androidx.compose.material.icons.filled.Wallet
import androidx.compose.material.icons.filled.Schedule
import androidx.compose.material.icons.filled.Sensors
import androidx.compose.material3.Icon
import androidx.compose.material3.NavigationBar
import androidx.compose.material3.NavigationBarItem
import androidx.compose.material3.NavigationBarItemDefaults
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.navigation.NavGraph.Companion.findStartDestination
import androidx.navigation.NavType
import androidx.navigation.compose.NavHost
import androidx.navigation.compose.composable
import androidx.navigation.compose.currentBackStackEntryAsState
import androidx.navigation.compose.rememberNavController
import androidx.navigation.navArgument
import com.hrpayroll.ui.screens.admin.AdminClaimsScreen
import com.hrpayroll.ui.screens.admin.AdminDashboardScreen
import com.hrpayroll.ui.screens.admin.AdminEmployeesScreen
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
import com.hrpayroll.ui.screens.payroll.PayrollScreen
import com.hrpayroll.ui.screens.shift.ShiftScreen
import com.hrpayroll.ui.theme.BrandGreen
import com.hrpayroll.ui.theme.BrandMint

object Routes {
    const val LOGIN = "login"
    const val HOME = "home"
    const val ATTENDANCE = "attendance"
    const val CAMERA = "camera/{mode}" // mode: checkin | checkout
    const val SHIFT = "shift"
    const val LEAVE = "leave"
    const val CLAIMS = "claims"
    const val CLAIM_SUBMIT = "claim_submit/{claimId}"
    const val PAYROLL = "payroll"

    // Admin section
    const val ADMIN_DASHBOARD = "admin_dashboard"
    const val ADMIN_LIVE = "admin_live"
    const val ADMIN_PERFORMANCE = "admin_performance"
    const val ADMIN_CLAIMS = "admin_claims"
    const val ADMIN_PEOPLE = "admin_people"
    const val ADMIN_USERS = "admin_users" // pushed from People (SUPER_ADMIN)
    const val ADMIN_EMPLOYEE_MONTH = "admin_employee/{employeeId}?month={month}&year={year}" // pushed from Performance
}

/** Build the claim submit route; pass "new" for a fresh claim or a claim id to resubmit. */
fun claimSubmitRoute(claimId: String): String = "claim_submit/$claimId"

/** Selfie camera route for the given attendance action ("checkin" | "checkout"). */
fun cameraRoute(mode: String): String = "camera/$mode"

private data class BottomTab(val route: String, val label: String, val icon: ImageVector)

private val employeeTabs = listOf(
    BottomTab(Routes.HOME, "Home", Icons.Filled.Home),
    BottomTab(Routes.ATTENDANCE, "Attendance", Icons.Filled.CheckCircle),
    BottomTab(Routes.LEAVE, "Leave", Icons.Filled.CalendarMonth),
    BottomTab(Routes.CLAIMS, "Vouchers", Icons.Filled.ReceiptLong),
)

// Pay, and the days behind it: payslips and the monthly statement. Shown only
// while the dealer shares payroll with staff (Settings → "Show payroll to
// employees", off by default) — see PayrollAccess.
private val payrollTab = BottomTab(Routes.PAYROLL, "Payroll", Icons.Filled.Wallet)

private val adminTabs = listOf(
    BottomTab(Routes.ADMIN_DASHBOARD, "Dashboard", Icons.Filled.Dashboard),
    BottomTab(Routes.ADMIN_LIVE, "Live", Icons.Filled.Sensors),
    BottomTab(Routes.ADMIN_CLAIMS, "Vouchers", Icons.Filled.ReceiptLong),
    BottomTab(Routes.ADMIN_PERFORMANCE, "Reports", Icons.Filled.Assessment),
    BottomTab(Routes.ADMIN_PEOPLE, "People", Icons.Filled.Groups),
)

@Composable
fun HrPayrollNavHost(navViewModel: NavViewModel = androidx.hilt.navigation.compose.hiltViewModel()) {
    val navController = rememberNavController()
    val backStackEntry by navController.currentBackStackEntryAsState()
    val currentRoute = backStackEntry?.destination?.route

    // Admin tabs depend on the signed-in role: cashiers get Dashboard + Claims only.
    // (Admin-account management lives inside People, gated to SUPER_ADMIN there.)
    val role = navViewModel.role()
    val visibleAdminTabs = when (role) {
        "CASHIER" -> adminTabs.filter { it.route == Routes.ADMIN_DASHBOARD || it.route == Routes.ADMIN_CLAIMS }
        else -> adminTabs
    }

    val payrollVisible by navViewModel.payrollVisible.collectAsState()
    val visibleEmployeeTabs = if (payrollVisible) employeeTabs.take(3) + payrollTab + employeeTabs.drop(3) else employeeTabs

    // Pick the tab set for the active section (employee vs admin); null = no bottom bar.
    val tabs = when (currentRoute) {
        in adminTabs.map { it.route } -> visibleAdminTabs
        in (employeeTabs + payrollTab).map { it.route } -> visibleEmployeeTabs
        else -> null
    }

    Scaffold(
        bottomBar = {
            if (tabs != null) {
                // Labels always shown — an icon alone makes people guess. The
                // active tab sits in a mint pill; a hairline separates the bar
                // from the page instead of a heavy shadow.
                Column {
                    androidx.compose.material3.HorizontalDivider(color = com.hrpayroll.ui.theme.CardBorder)
                    NavigationBar(containerColor = Color.White, tonalElevation = 0.dp) {
                        tabs.forEach { tab ->
                            val selected = currentRoute == tab.route
                            NavigationBarItem(
                                selected = selected,
                                onClick = {
                                    navController.navigate(tab.route) {
                                        popUpTo(navController.graph.findStartDestination().id) { saveState = true }
                                        launchSingleTop = true
                                        restoreState = true
                                    }
                                },
                                icon = { Icon(tab.icon, contentDescription = tab.label) },
                                label = {
                                    Text(
                                        tab.label,
                                        fontSize = 11.sp,
                                        fontWeight = if (selected) androidx.compose.ui.text.font.FontWeight.Bold
                                        else androidx.compose.ui.text.font.FontWeight.Medium,
                                    )
                                },
                                alwaysShowLabel = true,
                                colors = NavigationBarItemDefaults.colors(
                                    selectedIconColor = BrandGreen,
                                    selectedTextColor = BrandGreen,
                                    unselectedIconColor = Color(0xFF8E989F),
                                    unselectedTextColor = Color(0xFF8E989F),
                                    indicatorColor = BrandMint,
                                ),
                            )
                        }
                    }
                }
            }
        },
    ) { innerPadding ->
        // Whether the phone wants animation at all — read once, here, so every
        // destination below agrees rather than each deciding for itself.
        val animate = com.hrpayroll.utils.Motion.rememberEnabled()

        NavHost(
            navController = navController,
            startDestination = Routes.LOGIN,
            modifier = androidx.compose.ui.Modifier.padding(innerPadding),
            enterTransition = { com.hrpayroll.utils.Motion.enter(animate) },
            exitTransition = { com.hrpayroll.utils.Motion.exit(animate) },
            popEnterTransition = { com.hrpayroll.utils.Motion.popEnter(animate) },
            popExitTransition = { com.hrpayroll.utils.Motion.popExit(animate) },
        ) {
            // Signing in is not a step sideways through the app; it is the way
            // in and the way out, so it fades rather than slides.
            composable(
                Routes.LOGIN,
                enterTransition = { com.hrpayroll.utils.Motion.fade(animate) },
                exitTransition = { com.hrpayroll.utils.Motion.fadeAway(animate) },
            ) {
                LoginScreen(onLoggedIn = { isAdmin ->
                    val dest = if (isAdmin) Routes.ADMIN_DASHBOARD else Routes.HOME
                    navController.navigate(dest) {
                        popUpTo(Routes.LOGIN) { inclusive = true }
                    }
                })
            }

            // Employee
            composable(Routes.HOME) {
                // The shortcuts open a tab the way tapping it in the bar would.
                val openTab: (String) -> Unit = { route ->
                    navController.navigate(route) {
                        popUpTo(navController.graph.findStartDestination().id) { saveState = true }
                        launchSingleTop = true
                        restoreState = true
                    }
                }
                HomeScreen(
                    onOpenAttendance = { openTab(Routes.ATTENDANCE) },
                    onApplyLeave = { openTab(Routes.LEAVE) },
                    onNewVoucher = { navController.navigate(claimSubmitRoute("new")) },
                    onOpenPayroll = { openTab(Routes.PAYROLL) },
                    onCheckIn = { navController.navigate(cameraRoute("checkin")) },
                    onCheckOut = { navController.navigate(cameraRoute("checkout")) },
                    onLogout = {
                        navController.navigate(Routes.LOGIN) {
                            popUpTo(0) { inclusive = true } // clear the whole back stack
                        }
                    },
                )
            }
            composable(Routes.ATTENDANCE) {
                AttendanceScreen(
                    onCheckIn = { navController.navigate(cameraRoute("checkin")) },
                    onCheckOut = { navController.navigate(cameraRoute("checkout")) },
                )
            }
            composable(
                Routes.CAMERA,
                arguments = listOf(navArgument("mode") { type = NavType.StringType }),
                // The camera takes over the screen; sliding a viewfinder in looks
                // like a mistake.
                enterTransition = { com.hrpayroll.utils.Motion.fade(animate) },
                exitTransition = { com.hrpayroll.utils.Motion.fadeAway(animate) },
                popEnterTransition = { com.hrpayroll.utils.Motion.fade(animate) },
                popExitTransition = { com.hrpayroll.utils.Motion.fadeAway(animate) },
            ) {
                CameraCaptureScreen(
                    onDone = { navController.popBackStack() },
                    onCancel = { navController.popBackStack() },
                )
            }
            composable(Routes.SHIFT) { ShiftScreen() }
            composable(Routes.LEAVE) { LeaveScreen() }
            composable(Routes.PAYROLL) { PayrollScreen() }

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
            composable(Routes.ADMIN_PERFORMANCE) {
                PerformanceScreen(onOpenEmployee = { id, month, year ->
                    navController.navigate("admin_employee/$id?month=$month&year=$year")
                })
            }
            composable(
                Routes.ADMIN_EMPLOYEE_MONTH,
                arguments = listOf(
                    navArgument("employeeId") { type = NavType.StringType },
                    navArgument("month") { type = NavType.IntType; defaultValue = 0 },
                    navArgument("year") { type = NavType.IntType; defaultValue = 0 },
                ),
            ) {
                com.hrpayroll.ui.screens.admin.EmployeeMonthScreen(onBack = { navController.popBackStack() })
            }
            composable(Routes.ADMIN_PEOPLE) {
                AdminEmployeesScreen(onOpenUsers = { navController.navigate(Routes.ADMIN_USERS) })
            }
            composable(Routes.ADMIN_USERS) {
                AdminUsersScreen(onBack = { navController.popBackStack() })
            }
        }
    }
}
