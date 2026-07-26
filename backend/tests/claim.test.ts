import { describe, expect, it } from 'vitest';
import type { PrismaClient } from '@prisma/client';
import { amountInWords } from '../src/services/claim/claim-voucher-pdf.service.js';
import { formatDocNo, withNextNumber } from '../src/services/claim/claim-number.js';
import {
  CLAIM_TYPES,
  claimTypeLabel,
  isValidClaimType,
  LEGACY_CLAIM_TYPE_MAP,
} from '../src/services/claim/claim-types.js';

describe('claim types', () => {
  it('carries the owner’s 20 expense heads', () => {
    expect(CLAIM_TYPES).toHaveLength(20);
    expect(CLAIM_TYPES.map((t) => t.label)).toEqual([
      'General Expenses', 'Donation', 'Marketing Expenses', 'New Vehicle Commission',
      'New Vehicle Fittings Incentives', 'New Vehicle PDI Parts', 'New Vehicle PDI Petrol',
      'Other', 'Parcel', 'Petrol Expenses', 'Rent', 'Salary', 'Sales Incentives',
      'Service Incentives', 'Service Outwork', 'Staff Welfare Expenses', 'Training',
      'Travel Expenses', 'Unloading Expenses', 'Utilities & Office',
    ]);
  });

  it('accepts only known codes', () => {
    expect(isValidClaimType('PETROL_EXPENSES')).toBe(true);
    expect(isValidClaimType('TRAVEL')).toBe(false); // legacy code is no longer submittable
    expect(isValidClaimType('NOT_A_TYPE')).toBe(false);
  });

  it('still labels legacy claims sensibly', () => {
    expect(claimTypeLabel('TRAVEL')).toBe('Travel Expenses');
    expect(claimTypeLabel('FOOD')).toBe('Staff Welfare Expenses');
    expect(claimTypeLabel('UTILITIES_AND_OFFICE')).toBe('Utilities & Office');
    expect(claimTypeLabel(null)).toBe('—');
    // Unknown codes are humanised rather than shown as UPPER_SNAKE.
    expect(claimTypeLabel('SOME_OLD_CODE')).toBe('Some Old Code');
  });

  it('maps every legacy code onto a valid new code', () => {
    for (const target of Object.values(LEGACY_CLAIM_TYPE_MAP)) {
      expect(isValidClaimType(target)).toBe(true);
    }
  });
});

describe('formatDocNo', () => {
  it('zero-pads to three digits and grows beyond', () => {
    expect(formatDocNo(1)).toBe('001');
    expect(formatDocNo(7)).toBe('007');
    expect(formatDocNo(42)).toBe('042');
    expect(formatDocNo(999)).toBe('999');
    expect(formatDocNo(1000)).toBe('1000');
  });

  it('is null when no number has been issued', () => {
    expect(formatDocNo(null)).toBeNull();
    expect(formatDocNo(undefined)).toBeNull();
  });
});

describe('withNextNumber', () => {
  /** Prisma stand-in whose findFirst reports the current high-water mark. */
  const fakePrisma = (max: number | null): PrismaClient =>
    ({ claim: { findFirst: async () => (max == null ? null : { claimNo: max, voucherNo: max }) } }) as unknown as PrismaClient;

  it('starts at 1 when nothing has been issued', async () => {
    const got = await withNextNumber(fakePrisma(null), 'claimNo', async (n) => n);
    expect(got).toBe(1);
  });

  it('continues from the highest issued number', async () => {
    const got = await withNextNumber(fakePrisma(7), 'voucherNo', async (n) => n);
    expect(got).toBe(8);
  });

  it('retries past a number another request grabbed first', async () => {
    const attempted: number[] = [];
    const got = await withNextNumber(fakePrisma(3), 'claimNo', async (n) => {
      attempted.push(n);
      // 4 was taken by a concurrent insert; 5 succeeds.
      if (n === 4) throw Object.assign(new Error('Unique constraint failed'), { code: 'P2002' });
      return n;
    });
    expect(attempted).toEqual([4, 5]);
    expect(got).toBe(5);
  });

  it('does not swallow unrelated errors', async () => {
    await expect(
      withNextNumber(fakePrisma(1), 'claimNo', async () => {
        throw new Error('database is down');
      }),
    ).rejects.toThrow('database is down');
  });
});

describe('amountInWords', () => {
  it('agrees with the printed figures, paise included', () => {
    // The words are the fallback if the figures are altered, so 18,750.50 must
    // not round up to "…Fifty One Rupees".
    expect(amountInWords(18750.5)).toBe(
      'Eighteen Thousand Seven Hundred Fifty Rupees and Fifty Paise Only',
    );
    expect(amountInWords(1.05)).toBe('One Rupees and Five Paise Only');
    expect(amountInWords(0.75)).toBe('Seventy Five Paise Only');
  });

  it('omits the paise clause for whole rupees', () => {
    expect(amountInWords(500)).toBe('Five Hundred Rupees Only');
    expect(amountInWords(18750)).toBe('Eighteen Thousand Seven Hundred Fifty Rupees Only');
  });

  it('uses the Indian crore/lakh system', () => {
    expect(amountInWords(100000)).toBe('One Lakh Rupees Only');
    expect(amountInWords(12345678)).toBe(
      'One Crore Twenty Three Lakh Forty Five Thousand Six Hundred Seventy Eight Rupees Only',
    );
  });

  it('handles zero', () => {
    expect(amountInWords(0)).toBe('Zero Rupees Only');
  });
});
