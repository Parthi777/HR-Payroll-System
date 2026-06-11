package com.hrpayroll.data.repository

import com.hrpayroll.data.remote.HrApi
import com.hrpayroll.data.remote.dto.ApplyLeaveRequest
import com.hrpayroll.data.remote.dto.LeaveBalanceDto
import com.hrpayroll.data.remote.dto.LeaveDto
import com.hrpayroll.data.remote.dto.MeDto
import com.hrpayroll.data.remote.dto.PayslipDto
import com.hrpayroll.data.remote.dto.ScheduleDayDto
import javax.inject.Inject

/** Employee-facing read/write: profile, leaves, payslips, shift schedule. */
class EmployeeDataRepository @Inject constructor(
    private val api: HrApi,
) {
    suspend fun me(): MeDto = api.me()
    suspend fun applyLeave(req: ApplyLeaveRequest): LeaveDto? = api.applyLeave(req).leave
    suspend fun myLeaves(): List<LeaveDto> = api.myLeaves().leaves
    suspend fun leaveBalance(): List<LeaveBalanceDto> = api.leaveBalance().balances
    suspend fun myPayslips(): List<PayslipDto> = api.myPayslips().payslips
    suspend fun mySchedule(): List<ScheduleDayDto> = api.mySchedule().schedule
}
