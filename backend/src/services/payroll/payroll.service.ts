/**
 * Payroll calculation engine. See CLAUDE.md "Payroll Calculation Engine".
 * Pure functions — no DB access — so they are unit-testable.
 */

export interface SalaryStructure {
  basic: number;
  hra: number;
  da: number;
  otherAllowances: number;
}

export interface AttendanceSummary {
  workingDays: number; // working days in month (minus holidays)
  presentDays: number;
  paidLeaveDays: number;
  lopDays: number;
}

export interface Deductions {
  pf: number;
  esi: number;
  pt: number;
  tds: number;
  advances: number;
}

export interface PayrollResult {
  effectiveDays: number;
  perDaySalary: number;
  earnedGross: number;
  deductions: Deductions;
  netSalary: number;
}

const PF_RATE = 0.12;
const PF_WAGE_CEILING = 15000;
const PF_CAP = 1800; // 12% of 15000
const ESI_RATE = 0.0075;
const ESI_GROSS_LIMIT = 21000;

export function calculatePF(basic: number): number {
  const pfBase = Math.min(basic, PF_WAGE_CEILING);
  return Math.min(pfBase * PF_RATE, PF_CAP);
}

export function calculateESI(gross: number): number {
  return gross <= ESI_GROSS_LIMIT ? Math.round(gross * ESI_RATE) : 0;
}

export interface CalcInput {
  structure: SalaryStructure;
  attendance: AttendanceSummary;
  ptSlab?: number; // state-specific professional tax
  tds?: number;
  advances?: number;
}

export function calculateNetSalary(input: CalcInput): PayrollResult {
  const { structure, attendance } = input;
  const fullGross = structure.basic + structure.hra + structure.da + structure.otherAllowances;

  const effectiveDays = attendance.presentDays + attendance.paidLeaveDays;
  const perDaySalary = attendance.workingDays > 0 ? fullGross / attendance.workingDays : 0;
  const earnedGross = perDaySalary * effectiveDays;

  const pf = calculatePF(structure.basic);
  const esi = calculateESI(earnedGross);
  const pt = input.ptSlab ?? 0;
  const tds = input.tds ?? 0;
  const advances = input.advances ?? 0;

  const deductions: Deductions = { pf, esi, pt, tds, advances };
  const totalDeductions = pf + esi + pt + tds + advances;
  const netSalary = Math.max(0, earnedGross - totalDeductions);

  return {
    effectiveDays,
    perDaySalary: Math.round(perDaySalary * 100) / 100,
    earnedGross: Math.round(earnedGross * 100) / 100,
    deductions,
    netSalary: Math.round(netSalary * 100) / 100,
  };
}
