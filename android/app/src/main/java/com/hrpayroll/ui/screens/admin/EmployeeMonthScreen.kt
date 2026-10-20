package com.hrpayroll.ui.screens.admin

import android.content.Intent
import android.net.Uri
import androidx.compose.foundation.Canvas
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.outlined.ReceiptLong
import androidx.compose.material.icons.outlined.AccessTime
import androidx.compose.material.icons.outlined.BeachAccess
import androidx.compose.material.icons.outlined.Block
import androidx.compose.material.icons.outlined.Call
import androidx.compose.material.icons.outlined.Event
import androidx.compose.material.icons.outlined.EventBusy
import androidx.compose.material.icons.outlined.HourglassTop
import androidx.compose.material.icons.outlined.Payments
import androidx.compose.material.icons.outlined.Schedule
import androidx.compose.material.icons.outlined.StarOutline
import androidx.compose.material.icons.outlined.Timelapse
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.draw.shadow
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.StrokeCap
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.hilt.navigation.compose.hiltViewModel
import com.hrpayroll.data.remote.dto.EmployeeDayDto
import com.hrpayroll.data.remote.dto.EmployeeMonthDto
import com.hrpayroll.data.remote.dto.EmployeeSalaryDto
import com.hrpayroll.data.remote.dto.LeaveDto
import com.hrpayroll.ui.components.BrandHeader
import com.hrpayroll.ui.components.IconBubble
import com.hrpayroll.ui.components.MonthDropdown
import com.hrpayroll.ui.components.SectionCard
import com.hrpayroll.ui.components.SectionTitle
import com.hrpayroll.ui.components.StatusChip
import com.hrpayroll.ui.components.monthLabel
import com.hrpayroll.ui.theme.BrandGold
import com.hrpayroll.ui.theme.BrandGreen
import com.hrpayroll.ui.theme.BrandGreenDark
import com.hrpayroll.ui.theme.BrandMint
import com.hrpayroll.ui.theme.BrandSurface
import com.hrpayroll.ui.theme.CardBorder
import com.hrpayroll.ui.theme.Ink
import com.hrpayroll.ui.theme.MutedText
import com.hrpayroll.ui.theme.StatusHalf
import com.hrpayroll.ui.theme.StatusHalfBg
import com.hrpayroll.ui.theme.StatusLeave
import com.hrpayroll.ui.theme.StatusLeaveBg
import com.hrpayroll.ui.theme.StatusMuted
import com.hrpayroll.ui.theme.StatusMutedBg
import com.hrpayroll.ui.theme.StatusOff
import com.hrpayroll.ui.theme.StatusOffBg
import com.hrpayroll.ui.theme.StatusPaid
import com.hrpayroll.ui.theme.StatusPaidBg
import com.hrpayroll.ui.theme.StatusPresent
import com.hrpayroll.ui.theme.StatusPresentBg
import com.hrpayroll.utils.days
import com.hrpayroll.utils.rupees

/**
 * One employee's whole month, for an admin: who they are, the month's totals,
 * a calendar and every day, their leave, the vouchers they raised and — for
 * the roles that see pay — the month's salary as payroll computes it.
 */
@Composable
fun EmployeeMonthScreen(
    onBack: () -> Unit,
    viewModel: EmployeeMonthViewModel = hiltViewModel(),
) {
    val state by viewModel.uiState.collectAsState()
    val d = state.data
    val options = d?.months?.map { it.month to it.year }?.takeIf { it.isNotEmpty() } ?: listOf(state.month to state.year)

    Box(modifier = Modifier.fillMaxSize().background(MaterialTheme.colorScheme.background)) {
        Column(modifier = Modifier.fillMaxSize().verticalScroll(rememberScrollState())) {
            BrandHeader(
                title = d?.employee?.name ?: "Employee",
                subtitle = listOfNotNull(d?.employee?.employeeCode, d?.employee?.designation).joinToString(" · ").ifBlank { null },
                onBack = onBack,
            ) {
                MonthDropdown(state.month, state.year, options, onSelect = viewModel::selectMonth)
            }

            when {
                state.isLoading && d == null -> CircularProgressIndicator(
                    Modifier.padding(32.dp).align(Alignment.CenterHorizontally), color = BrandGreen,
                )
                d == null -> Text(state.error ?: "Nothing to show.", color = MutedText, modifier = Modifier.padding(20.dp))
                else -> Column(Modifier.padding(horizontal = 16.dp)) {
                    if (state.isLoading) {
                        androidx.compose.material3.LinearProgressIndicator(
                            modifier = Modifier.fillMaxWidth().height(3.dp).clip(RoundedCornerShape(50)),
                            color = BrandGreen,
                            trackColor = BrandMint,
                        )
                        Spacer(Modifier.height(10.dp))
                    }
                    state.error?.let { Text(it, color = StatusOff, fontSize = 13.sp); Spacer(Modifier.height(10.dp)) }

                    ProfileCard(d)
                    Spacer(Modifier.height(14.dp))
                    MonthHero(d)
                    Spacer(Modifier.height(14.dp))
                    SummaryGrid(d)

                    SectionTitle("Calendar", modifier = Modifier.padding(top = 24.dp, bottom = 10.dp, start = 4.dp))
                    CalendarCard(d)

                    SectionTitle("Day by day", modifier = Modifier.padding(top = 24.dp, bottom = 10.dp, start = 4.dp))
                    DayList(d.attendance.days)

                    SectionTitle("Leave", modifier = Modifier.padding(top = 24.dp, bottom = 10.dp, start = 4.dp))
                    LeaveList(d.leaves)

                    SectionTitle(
                        if (d.voucherTotals.count > 0) "Vouchers · ${rupees(d.voucherTotals.amount)}" else "Vouchers",
                        modifier = Modifier.padding(top = 24.dp, bottom = 10.dp, start = 4.dp),
                    )
                    VoucherList(d)

                    d.salary?.let {
                        SectionTitle("Salary · ${monthLabel(d.month, d.year)}", modifier = Modifier.padding(top = 24.dp, bottom = 10.dp, start = 4.dp))
                        SalaryCard(it)
                    }
                    Spacer(Modifier.height(28.dp))
                }
            }
        }
    }
}

private fun isoDay(iso: String?, pattern: String = "d MMM yyyy"): String? = runCatching {
    java.time.LocalDate.parse(iso?.take(10)).format(java.time.format.DateTimeFormatter.ofPattern(pattern))
}.getOrNull()

@Composable
private fun ProfileCard(d: EmployeeMonthDto) {
    val e = d.employee
    val context = LocalContext.current
    SectionCard {
        Row(verticalAlignment = Alignment.CenterVertically) {
            val initials = (e.name ?: "?").split(" ").filter { it.isNotBlank() }.take(2).joinToString("") { it.first().uppercase() }
            Box(Modifier.size(52.dp).clip(CircleShape).background(BrandMint), contentAlignment = Alignment.Center) {
                Text(initials, color = BrandGreen, fontWeight = FontWeight.Bold, fontSize = 18.sp)
            }
            Spacer(Modifier.width(14.dp))
            Column(Modifier.weight(1f)) {
                Text(e.name ?: "—", color = Ink, fontWeight = FontWeight.Bold, fontSize = 17.sp)
                Text(listOfNotNull(e.employeeCode, e.branch).joinToString(" · "), color = MutedText, fontSize = 12.sp)
            }
            if (!e.phone.isNullOrBlank()) {
                Box(
                    Modifier.size(44.dp).clip(CircleShape).background(BrandMint)
                        .clickable { runCatching { context.startActivity(Intent(Intent.ACTION_DIAL, Uri.parse("tel:${e.phone}"))) } },
                    contentAlignment = Alignment.Center,
                ) { Icon(Icons.Outlined.Call, contentDescription = "Call ${e.name}", tint = BrandGreen) }
            }
        }
        Spacer(Modifier.height(14.dp))
        HorizontalDivider(color = CardBorder)
        Spacer(Modifier.height(10.dp))
        InfoLine("Department", e.department ?: "—")
        InfoLine("Designation", e.designation ?: "—")
        InfoLine("Shift", listOfNotNull(e.shift?.name, listOfNotNull(e.shift?.startTime, e.shift?.endTime).joinToString("–").ifBlank { null }).joinToString(" · ").ifBlank { "—" })
        InfoLine("Joined", isoDay(e.joiningDate) ?: "—")
        InfoLine("Phone", e.phone ?: "—")
    }
}

@Composable
private fun InfoLine(label: String, value: String) {
    Row(Modifier.fillMaxWidth().padding(vertical = 4.dp)) {
        Text(label, color = MutedText, fontSize = 13.sp, modifier = Modifier.weight(0.38f))
        Text(value, color = Ink, fontSize = 13.sp, fontWeight = FontWeight.Medium, modifier = Modifier.weight(0.62f))
    }
}

/** Attendance for the month on the brand green: the rate as a ring, present out of days served. */
@Composable
private fun MonthHero(d: EmployeeMonthDto) {
    val s = d.attendance.summary
    val denom = s.present + s.absent
    val rate = if (denom > 0) (s.present * 100 / denom).toInt() else 0
    Box(
        Modifier.fillMaxWidth()
            .shadow(14.dp, RoundedCornerShape(28.dp), ambientColor = BrandGreen, spotColor = BrandGreen)
            .clip(RoundedCornerShape(28.dp))
            .background(Brush.linearGradient(listOf(BrandGreen, BrandGreenDark))),
    ) {
        Canvas(Modifier.matchParentSize()) {
            val c = Offset(size.width * 0.95f, 0f)
            drawCircle(Brush.radialGradient(listOf(BrandGold.copy(alpha = 0.35f), Color.Transparent), center = c, radius = size.width * 0.55f), radius = size.width * 0.55f, center = c)
        }
        Row(Modifier.padding(20.dp), verticalAlignment = Alignment.CenterVertically) {
            Box(contentAlignment = Alignment.Center, modifier = Modifier.size(86.dp)) {
                CircularProgressIndicator(progress = { 1f }, modifier = Modifier.fillMaxSize(), color = Color.White.copy(alpha = 0.22f), strokeWidth = 9.dp)
                CircularProgressIndicator(
                    progress = { (rate / 100f).coerceIn(0f, 1f) },
                    modifier = Modifier.fillMaxSize(),
                    color = Color.White,
                    strokeWidth = 9.dp,
                    strokeCap = StrokeCap.Round,
                    trackColor = Color.Transparent,
                )
                Text("$rate%", color = Color.White, fontWeight = FontWeight.Bold, fontSize = 19.sp)
            }
            Spacer(Modifier.width(18.dp))
            Column {
                Text(monthLabel(d.month, d.year).uppercase(), color = Color.White.copy(alpha = 0.8f), fontSize = 11.sp, fontWeight = FontWeight.SemiBold, letterSpacing = 0.8.sp)
                Spacer(Modifier.height(4.dp))
                Row(verticalAlignment = Alignment.Bottom) {
                    Text(days(s.present), color = Color.White, fontSize = 34.sp, fontWeight = FontWeight.Bold)
                    Text(" days present", color = Color.White.copy(alpha = 0.85f), fontSize = 14.sp, modifier = Modifier.padding(bottom = 6.dp))
                }
                Text("of ${days(s.served)} days so far · ${days(s.workedHours)} h worked", color = Color.White.copy(alpha = 0.8f), fontSize = 12.sp)
            }
        }
    }
}

@Composable
private fun SummaryGrid(d: EmployeeMonthDto) {
    val s = d.attendance.summary
    val tiles = listOf(
        Triple("Late", days(s.late), Icons.Outlined.Schedule) to StatusHalf,
        Triple("Half day", days(s.half), Icons.Outlined.Timelapse) to StatusPaid,
        Triple("Absent", days(s.absent), Icons.Outlined.EventBusy) to StatusOff,
        Triple("Leave", days(s.leave), Icons.Outlined.BeachAccess) to StatusLeave,
        Triple("Loss of pay", days(s.lop), Icons.Outlined.Block) to StatusOff,
        Triple("Awaiting approval", days(s.pending), Icons.Outlined.HourglassTop) to Color(0xFFB07D0C),
        Triple("Sunday / holiday duty", days(s.offDuty), Icons.Outlined.StarOutline) to BrandGreen,
        Triple("Weekly offs & holidays", days(s.off), Icons.Outlined.Event) to StatusMuted,
    )
    Column(verticalArrangement = Arrangement.spacedBy(10.dp)) {
        tiles.chunked(2).forEach { pair ->
            Row(horizontalArrangement = Arrangement.spacedBy(10.dp)) {
                pair.forEach { (t, tint) ->
                    SectionCard(modifier = Modifier.weight(1f)) {
                        Row(verticalAlignment = Alignment.CenterVertically) {
                            IconBubble(t.third, tint, size = 38.dp)
                            Spacer(Modifier.width(10.dp))
                            Column {
                                Text(t.second, color = Ink, fontSize = 19.sp, fontWeight = FontWeight.Bold)
                                Text(t.first, color = MutedText, fontSize = 11.sp, maxLines = 1, overflow = TextOverflow.Ellipsis)
                            }
                        }
                    }
                }
            }
        }
    }
}

/** Status word from the server → label and colours for chips and calendar cells. */
private fun statusStyle(status: String?): Triple<String, Color, Color> = when (status) {
    "PRESENT" -> Triple("Present", StatusPresent, StatusPresentBg)
    "LATE" -> Triple("Late", StatusHalf, StatusHalfBg)
    "HALF_DAY" -> Triple("Half day", StatusPaid, StatusPaidBg)
    "ABSENT" -> Triple("Absent", StatusOff, StatusOffBg)
    "PENDING" -> Triple("Awaiting approval", Color(0xFF8A5A00), Color(0xFFFDF1D6))
    "ON_LEAVE" -> Triple("Leave", StatusLeave, StatusLeaveBg)
    "LOP" -> Triple("Loss of pay", StatusOff, StatusOffBg)
    "WEEKLY_OFF" -> Triple("Weekly off", StatusMuted, StatusMutedBg)
    "WEEKLY_OFF_WORKED" -> Triple("Sunday worked", BrandGreen, BrandMint)
    "HOLIDAY" -> Triple("Holiday", StatusMuted, StatusMutedBg)
    "HOLIDAY_WORKED" -> Triple("Holiday worked", BrandGreen, BrandMint)
    else -> Triple("—", StatusMuted.copy(alpha = 0.5f), Color(0xFFF4F6F5))
}

private val WEEKDAY_SHORT = listOf("Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat")

@Composable
private fun CalendarCard(d: EmployeeMonthDto) {
    val daysList = d.attendance.days
    var selected by remember(d.month, d.year) { mutableStateOf<EmployeeDayDto?>(null) }
    SectionCard {
        Row(Modifier.fillMaxWidth()) {
            listOf("S", "M", "T", "W", "T", "F", "S").forEach {
                Text(it, Modifier.weight(1f), textAlign = TextAlign.Center, fontSize = 11.sp, color = MutedText)
            }
        }
        Spacer(Modifier.height(6.dp))
        val first = daysList.firstOrNull()?.weekday ?: 0
        val cells: List<EmployeeDayDto?> = List(first) { null } + daysList
        cells.chunked(7).forEach { week ->
            Row(Modifier.fillMaxWidth().padding(vertical = 2.dp)) {
                week.forEach { day ->
                    Box(Modifier.weight(1f).padding(2.dp), contentAlignment = Alignment.Center) {
                        if (day != null) {
                            val (_, fg, bg) = statusStyle(day.status)
                            val isSel = selected?.day == day.day
                            Box(
                                Modifier.size(36.dp).clip(CircleShape).background(bg)
                                    .then(if (isSel) Modifier.border(2.dp, Ink, CircleShape) else Modifier)
                                    .clickable { selected = if (isSel) null else day },
                                contentAlignment = Alignment.Center,
                            ) { Text("${day.day}", fontSize = 12.sp, fontWeight = FontWeight.SemiBold, color = fg) }
                        }
                    }
                }
                repeat(7 - week.size) { Box(Modifier.weight(1f)) }
            }
        }
        Spacer(Modifier.height(10.dp))
        Row(horizontalArrangement = Arrangement.spacedBy(10.dp)) {
            Legend(StatusPresent, "Present")
            Legend(StatusHalf, "Late")
            Legend(StatusOff, "Absent")
            Legend(StatusLeave, "Leave")
        }
        selected?.let { day ->
            Spacer(Modifier.height(12.dp))
            DayRow(day, highlighted = true)
        }
        if (selected == null) {
            Spacer(Modifier.height(8.dp))
            Text("Tap a day to see its punches", fontSize = 11.sp, color = MutedText)
        }
    }
}

@Composable
private fun Legend(color: Color, label: String) {
    Row(verticalAlignment = Alignment.CenterVertically) {
        Box(Modifier.size(8.dp).clip(CircleShape).background(color))
        Text(" $label", fontSize = 11.sp, color = MutedText)
    }
}

/** Every day of the month that has happened, newest first. */
@Composable
private fun DayList(daysList: List<EmployeeDayDto>) {
    val served = daysList.filter { it.status != null && it.status != "NOT_JOINED" }.reversed()
    if (served.isEmpty()) {
        Text("No days to show for this month yet.", color = MutedText, fontSize = 13.sp, modifier = Modifier.padding(start = 4.dp))
        return
    }
    Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
        served.forEach { DayRow(it) }
    }
}

@Composable
private fun DayRow(day: EmployeeDayDto, highlighted: Boolean = false) {
    val (label, fg, bg) = statusStyle(day.status)
    Row(
        Modifier.fillMaxWidth()
            .clip(RoundedCornerShape(16.dp))
            .background(if (highlighted) BrandSurface else Color.White)
            .border(1.dp, CardBorder, RoundedCornerShape(16.dp))
            .padding(12.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Column(Modifier.width(46.dp), horizontalAlignment = Alignment.CenterHorizontally) {
            Text("${day.day}", color = Ink, fontWeight = FontWeight.Bold, fontSize = 18.sp)
            Text(WEEKDAY_SHORT.getOrElse(day.weekday) { "" }, color = MutedText, fontSize = 11.sp)
        }
        Spacer(Modifier.width(10.dp))
        Column(Modifier.weight(1f)) {
            Row(verticalAlignment = Alignment.CenterVertically) {
                Icon(Icons.Outlined.AccessTime, contentDescription = null, tint = MutedText, modifier = Modifier.size(14.dp))
                Text(
                    "  ${day.checkIn ?: "--:--"}  →  ${day.checkOut ?: "--:--"}",
                    color = Ink, fontSize = 13.sp, fontWeight = FontWeight.Medium,
                )
            }
            Spacer(Modifier.height(2.dp))
            Text(
                listOfNotNull(
                    day.workedHours?.let { "${days(it)} h worked" },
                    when (day.punchMode) { "MANUAL" -> "Manual punch"; "SELFIE" -> "Selfie punch"; "KIOSK" -> "Kiosk"; else -> null },
                ).joinToString(" · ").ifBlank { "No punch" },
                color = MutedText, fontSize = 11.sp,
            )
        }
        StatusChip(label, fg, bg)
    }
}

@Composable
private fun LeaveList(leaves: List<LeaveDto>) {
    if (leaves.isEmpty()) {
        Text("No leave this month.", color = MutedText, fontSize = 13.sp, modifier = Modifier.padding(start = 4.dp))
        return
    }
    Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
        leaves.forEach { lv ->
            val (fg, bg) = when (lv.status) {
                "APPROVED" -> StatusPresent to StatusPresentBg
                "REJECTED" -> StatusOff to StatusOffBg
                else -> StatusHalf to StatusHalfBg
            }
            val name = when (lv.type) {
                "CL" -> "Casual Leave"; "SL" -> "Sick Leave"; "EL" -> "Earned Leave"; "LOP" -> "Loss of Pay"; "HALF_DAY" -> "Half Day"
                else -> lv.type ?: "Leave"
            }
            val from = isoDay(lv.fromDate, "d MMM")
            val to = isoDay(lv.toDate, "d MMM")
            val n = lv.days ?: 1.0
            SectionCard {
                Row(verticalAlignment = Alignment.CenterVertically) {
                    IconBubble(Icons.Outlined.BeachAccess, StatusLeave, size = 40.dp)
                    Spacer(Modifier.width(12.dp))
                    Column(Modifier.weight(1f)) {
                        Text(name, color = Ink, fontWeight = FontWeight.SemiBold, fontSize = 14.sp)
                        Text(
                            listOfNotNull(if (to == null || to == from) from else "$from – $to", "${days(n)} day${if (n == 1.0) "" else "s"}").joinToString(" · "),
                            color = MutedText, fontSize = 12.sp,
                        )
                        if (!lv.reason.isNullOrBlank()) Text(lv.reason, color = MutedText.copy(alpha = 0.8f), fontSize = 12.sp, maxLines = 1, overflow = TextOverflow.Ellipsis)
                    }
                    StatusChip((lv.status ?: "PENDING").lowercase().replaceFirstChar { it.uppercase() }, fg, bg)
                }
            }
        }
    }
}

@Composable
private fun VoucherList(d: EmployeeMonthDto) {
    if (d.vouchers.isEmpty()) {
        Text("No vouchers raised this month.", color = MutedText, fontSize = 13.sp, modifier = Modifier.padding(start = 4.dp))
        return
    }
    Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
        if (d.voucherTotals.paid > 0) {
            Text("${rupees(d.voucherTotals.paid)} paid so far", color = MutedText, fontSize = 12.sp, modifier = Modifier.padding(start = 4.dp))
        }
        d.vouchers.forEach { v ->
            val (fg, bg) = when (v.status) {
                "APPROVED" -> StatusPresent to StatusPresentBg
                "PAID" -> StatusPaid to StatusPaidBg
                "REJECTED" -> StatusOff to StatusOffBg
                "NEEDS_CLARIFICATION" -> StatusLeave to StatusLeaveBg
                else -> StatusHalf to StatusHalfBg
            }
            SectionCard {
                Row(verticalAlignment = Alignment.CenterVertically) {
                    IconBubble(Icons.AutoMirrored.Outlined.ReceiptLong, BrandGreen, size = 40.dp)
                    Spacer(Modifier.width(12.dp))
                    Column(Modifier.weight(1f)) {
                        Text(v.title ?: "Voucher", color = Ink, fontWeight = FontWeight.SemiBold, fontSize = 14.sp, maxLines = 1, overflow = TextOverflow.Ellipsis)
                        Text(
                            listOfNotNull(v.claimNo?.let { "No. %03d".format(it) }, v.typeLabel, isoDay(v.createdAt, "d MMM")).joinToString(" · "),
                            color = MutedText, fontSize = 12.sp, maxLines = 1, overflow = TextOverflow.Ellipsis,
                        )
                    }
                    Column(horizontalAlignment = Alignment.End) {
                        Text(rupees(v.amount), color = Ink, fontWeight = FontWeight.Bold, fontSize = 14.sp)
                        Spacer(Modifier.height(4.dp))
                        StatusChip((v.status ?: "PENDING").replace("_", " ").lowercase().replaceFirstChar { it.uppercase() }, fg, bg)
                    }
                }
            }
        }
    }
}

/** The month's pay as the payroll engine computes it — the same figure the payroll run would save. */
@Composable
private fun SalaryCard(s: EmployeeSalaryDto) {
    SectionCard(floating = true) {
        Row(verticalAlignment = Alignment.CenterVertically) {
            IconBubble(Icons.Outlined.Payments, BrandGreen, size = 40.dp)
            Spacer(Modifier.width(12.dp))
            Column(Modifier.weight(1f)) {
                Text("Net pay", color = MutedText, fontSize = 12.sp)
                Text(rupees(s.netSalary), color = Ink, fontWeight = FontWeight.Bold, fontSize = 24.sp)
            }
            Text(
                if (s.payrollBasis == "PRESENT_DAYS") "Paid per day worked" else "Monthly salary",
                color = BrandGreenDark, fontSize = 11.sp, fontWeight = FontWeight.SemiBold,
                modifier = Modifier.clip(RoundedCornerShape(50)).background(BrandMint).padding(horizontal = 10.dp, vertical = 4.dp),
            )
        }
        Spacer(Modifier.height(14.dp))
        HorizontalDivider(color = CardBorder)
        Spacer(Modifier.height(8.dp))
        PayLine("Monthly salary", rupees(s.monthlySalary))
        PayLine("Per day (salary ÷ 30)", rupees(Math.round(s.perDaySalary * 100) / 100.0))
        PayLine("Paid days", "${days(s.paidDays)} of ${days(s.servedDays)}")
        PayLine("Earned", rupees(s.basePay))
        if (s.otPay > 0) PayLine("Overtime (${days(s.otHours)} h)", "+ " + rupees(s.otPay))
        if (s.sundayPay > 0) PayLine("Sunday duty (${days(s.sundayDays)})", "+ " + rupees(s.sundayPay))
        PayLine("Gross", rupees(s.grossSalary), bold = true)
        if (s.leaveDeduction > 0) PayLine("Unpaid days withheld", rupees(s.leaveDeduction), muted = true)
        if (s.pf > 0) PayLine("PF", "− " + rupees(s.pf))
        if (s.esi > 0) PayLine("ESI", "− " + rupees(s.esi))
        Spacer(Modifier.height(6.dp))
        HorizontalDivider(color = CardBorder)
        PayLine("Net pay", rupees(s.netSalary), bold = true, color = BrandGreen)
        Spacer(Modifier.height(6.dp))
        Text(
            "Worked out live by the payroll engine for this month. Approve pending punches and re-run payroll to change the payslip.",
            color = MutedText, fontSize = 11.sp,
        )
    }
}

@Composable
private fun PayLine(label: String, value: String, bold: Boolean = false, muted: Boolean = false, color: Color = Ink) {
    Row(Modifier.fillMaxWidth().padding(vertical = 5.dp)) {
        Text(label, color = if (muted) MutedText else MutedText, fontSize = 13.sp, modifier = Modifier.weight(1f))
        Text(
            value,
            color = if (muted) MutedText else color,
            fontSize = if (bold) 15.sp else 13.sp,
            fontWeight = if (bold) FontWeight.Bold else FontWeight.Medium,
        )
    }
}

