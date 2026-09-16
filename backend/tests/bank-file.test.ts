/**
 * The salary transfer file.
 *
 * A bank portal rejects an entire bulk upload over one malformed line, so the
 * job of this code is not to export everyone — it is to export only rows the
 * bank will accept, and to say plainly who was held back and why. A silently
 * dropped employee is someone who does not get paid and nobody notices; a
 * silently exported blank is a file that fails at the bank with no clue which
 * of seventy-three rows caused it.
 */
import { describe, expect, it } from 'vitest';
import { buildBankFile, bankFileCsv, transferMode, type PayableEmployee } from '../src/services/payroll/bank-file.service.js';

const emp = (over: Partial<PayableEmployee> = {}): PayableEmployee => ({
  employeeCode: 'E001',
  name: 'Ravi Kumar',
  bankAccountName: null,
  bankAccountNo: '123456789012',
  bankIfsc: 'HDFC0001234',
  netSalary: 18500,
  ...over,
});

describe('who makes it into the file', () => {
  it('a complete record is payable', () => {
    const r = buildBankFile([emp()]);
    expect(r.rows).toHaveLength(1);
    expect(r.excluded).toHaveLength(0);
    expect(r.total).toBe(18500);
  });

  it('falls back to the employee name when no account name is set', () => {
    expect(buildBankFile([emp()]).rows[0].accountName).toBe('Ravi Kumar');
    expect(buildBankFile([emp({ bankAccountName: 'R KUMAR' })]).rows[0].accountName).toBe('R KUMAR');
  });

  it('normalises spaces and dashes out of the account number', () => {
    expect(buildBankFile([emp({ bankAccountNo: '1234 5678-9012' })]).rows[0].accountNo).toBe('123456789012');
  });

  it('upper-cases the IFSC', () => {
    expect(buildBankFile([emp({ bankIfsc: 'hdfc0001234' })]).rows[0].ifsc).toBe('HDFC0001234');
  });
});

describe('who is held back, and named', () => {
  const reasonFor = (over: Partial<PayableEmployee>) => {
    const r = buildBankFile([emp(over)]);
    expect(r.rows).toHaveLength(0);
    expect(r.excluded).toHaveLength(1);
    return r.excluded[0].reason;
  };

  it('no bank details at all', () => {
    expect(reasonFor({ bankAccountNo: null, bankIfsc: null })).toBe('No bank details on file');
  });

  it('missing account number, missing IFSC', () => {
    expect(reasonFor({ bankAccountNo: null })).toBe('No account number');
    expect(reasonFor({ bankIfsc: null })).toBe('No IFSC');
  });

  it('an account number that is not 9–18 digits', () => {
    expect(reasonFor({ bankAccountNo: '12345' })).toContain('9–18 digits');
    expect(reasonFor({ bankAccountNo: '12345678901234567890' })).toContain('9–18 digits');
    expect(reasonFor({ bankAccountNo: '12345678X012' })).toContain('9–18 digits');
  });

  it('a malformed IFSC, quoting it back', () => {
    // Real shape is 4 letters, a zero, then six alphanumerics.
    expect(reasonFor({ bankIfsc: 'HDFC1001234' })).toContain('HDFC1001234');
    expect(reasonFor({ bankIfsc: 'HDF0001234' })).toContain('not a valid code');
  });

  it('nothing payable this month', () => {
    expect(reasonFor({ netSalary: 0 })).toBe('Nothing payable this month');
    expect(reasonFor({ netSalary: -50 })).toBe('Nothing payable this month');
  });

  it('holds back only the bad row, and the total excludes it', () => {
    const r = buildBankFile([emp(), emp({ employeeCode: 'E002', name: 'Suresh', bankIfsc: 'nope' })]);
    expect(r.rows).toHaveLength(1);
    expect(r.excluded.map((e) => e.employeeCode)).toEqual(['E002']);
    expect(r.total).toBe(18500);
  });
});

describe('transfer mode', () => {
  it('is NEFT below ₹2,00,000 and RTGS at or above it', () => {
    expect(transferMode(199_999.99)).toBe('NEFT');
    expect(transferMode(200_000)).toBe('RTGS');
    expect(transferMode(250_000)).toBe('RTGS');
  });
});

describe('the CSV itself', () => {
  const csv = bankFileCsv(buildBankFile([emp(), emp({ employeeCode: 'E002', name: 'A "Nick" B', netSalary: 250000 })]), 8, 2026);
  const lines = csv.trim().split('\r\n');

  it('has a header and one line per payable row', () => {
    expect(lines).toHaveLength(3);
    expect(lines[0]).toContain('Beneficiary Name');
  });

  it('carries the narration with the payroll month', () => {
    expect(lines[1]).toContain('SALARY 08/2026');
  });

  it('marks a large transfer RTGS', () => {
    expect(lines[2]).toContain('RTGS');
    expect(lines[1]).toContain('NEFT');
  });

  it('escapes quotes rather than breaking the row', () => {
    expect(lines[2]).toContain('"A ""Nick"" B"');
  });

  it('uses CRLF, which is what bank portals expect', () => {
    expect(csv).toContain('\r\n');
  });

  it('writes amounts to two decimals', () => {
    expect(lines[1]).toContain('"18500.00"');
  });
});
