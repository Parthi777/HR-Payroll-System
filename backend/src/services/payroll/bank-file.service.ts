/**
 * The bulk salary transfer file a bank ingests to pay a month's payroll.
 *
 * Deliberately a generic column set rather than one bank's proprietary
 * template. Every Indian bank's bulk-upload format differs — ICICI, HDFC, SBI
 * and Axis each publish their own, and they change — so emitting something
 * labelled "HDFC format" that had never been tested against HDFC would be a
 * claim this code cannot support. What it produces instead is the column set
 * every one of those templates is built from, which a bank portal either
 * accepts directly or maps in one step.
 */

/** One payable line. Amounts are rupees, already net of deductions. */
export interface BankFileRow {
  employeeCode: string;
  name: string;
  accountName: string;
  accountNo: string;
  ifsc: string;
  amount: number;
}

/** Someone payroll paid but the bank cannot: no account on file, or nothing due. */
export interface BankFileExclusion {
  employeeCode: string;
  name: string;
  reason: string;
  amount: number;
}

export interface BankFileResult {
  rows: BankFileRow[];
  excluded: BankFileExclusion[];
  total: number;
}

/**
 * RTGS is only available at or above ₹2,00,000; below that the transfer has to
 * go as NEFT. Banks reject a whole file over one mis-typed mode, so the mode is
 * derived per row rather than asked for.
 */
const RTGS_MINIMUM = 200_000;
export const transferMode = (amount: number): 'RTGS' | 'NEFT' =>
  amount >= RTGS_MINIMUM ? 'RTGS' : 'NEFT';

/** IFSC: four letters, a zero, then six alphanumerics. */
const IFSC = /^[A-Z]{4}0[A-Z0-9]{6}$/;
/** Indian account numbers run 9–18 digits. Spaces and dashes are tolerated on input. */
const ACCOUNT = /^\d{9,18}$/;

export interface PayableEmployee {
  employeeCode: string;
  name: string;
  bankAccountName: string | null;
  bankAccountNo: string | null;
  bankIfsc: string | null;
  netSalary: number;
}

/**
 * Split a month's payslips into what the bank can pay and what it cannot.
 *
 * An unpayable row is never silently dropped and never exported blank: a bank
 * portal rejects the entire upload over one malformed line, so a row that would
 * fail is held back and named, and the caller shows that list beside the file.
 */
export function buildBankFile(employees: PayableEmployee[]): BankFileResult {
  const rows: BankFileRow[] = [];
  const excluded: BankFileExclusion[] = [];

  for (const e of employees) {
    const accountNo = (e.bankAccountNo ?? '').replace(/[\s-]/g, '');
    const ifsc = (e.bankIfsc ?? '').toUpperCase().replace(/\s/g, '');
    const amount = Math.round(e.netSalary * 100) / 100;
    const fail = (reason: string) => excluded.push({ employeeCode: e.employeeCode, name: e.name, reason, amount });

    if (amount <= 0) fail('Nothing payable this month');
    else if (!accountNo && !ifsc) fail('No bank details on file');
    else if (!accountNo) fail('No account number');
    else if (!ACCOUNT.test(accountNo)) fail('Account number is not 9–18 digits');
    else if (!ifsc) fail('No IFSC');
    else if (!IFSC.test(ifsc)) fail(`IFSC "${ifsc}" is not a valid code`);
    else {
      rows.push({
        employeeCode: e.employeeCode,
        name: e.name,
        // Falling back to the employee's own name is safe and usually right,
        // but a joint or differently-spelled account is exactly what the
        // separate field exists for.
        accountName: (e.bankAccountName ?? '').trim() || e.name,
        accountNo,
        ifsc,
        amount,
      });
    }
  }

  return { rows, excluded, total: Math.round(rows.reduce((s, r) => s + r.amount, 0) * 100) / 100 };
}

const csvCell = (v: string | number) => `"${String(v).replace(/"/g, '""')}"`;

/** The file itself. One header row, then one line per payable employee. */
export function bankFileCsv(result: BankFileResult, month: number, year: number): string {
  const narration = `SALARY ${String(month).padStart(2, '0')}/${year}`;
  const header = [
    'Beneficiary Name', 'Account Number', 'IFSC', 'Amount', 'Transfer Mode', 'Narration', 'Employee Code',
  ];
  const lines = result.rows.map((r) =>
    [r.accountName, r.accountNo, r.ifsc, r.amount.toFixed(2), transferMode(r.amount), narration, r.employeeCode]
      .map(csvCell)
      .join(','),
  );
  return [header.map(csvCell).join(','), ...lines].join('\r\n') + '\r\n';
}
