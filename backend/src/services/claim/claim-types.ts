/**
 * Claim types — the owner's expense-head list (single source of truth).
 *
 * Stored on Claim.type as the stable UPPER_SNAKE code; the label is what the
 * app, the web console and the printed voucher show. Mirrored in
 * `shared/types/enums.ts`, `web/src/lib/claim-types.ts` and the Android
 * `CLAIM_TYPES` list — keep all four in step when the list changes.
 */

export const CLAIM_TYPES = [
  { code: 'GENERAL_EXPENSES', label: 'General Expenses' },
  { code: 'DONATION', label: 'Donation' },
  { code: 'MARKETING_EXPENSES', label: 'Marketing Expenses' },
  { code: 'NEW_VEHICLE_COMMISSION', label: 'New Vehicle Commission' },
  { code: 'NEW_VEHICLE_FITTINGS_INCENTIVES', label: 'New Vehicle Fittings Incentives' },
  { code: 'NEW_VEHICLE_PDI_PARTS', label: 'New Vehicle PDI Parts' },
  { code: 'NEW_VEHICLE_PDI_PETROL', label: 'New Vehicle PDI Petrol' },
  { code: 'OTHER', label: 'Other' },
  { code: 'PARCEL', label: 'Parcel' },
  { code: 'PETROL_EXPENSES', label: 'Petrol Expenses' },
  { code: 'RENT', label: 'Rent' },
  { code: 'SALARY', label: 'Salary' },
  { code: 'SALES_INCENTIVES', label: 'Sales Incentives' },
  { code: 'SERVICE_INCENTIVES', label: 'Service Incentives' },
  { code: 'SERVICE_OUTWORK', label: 'Service Outwork' },
  { code: 'STAFF_WELFARE_EXPENSES', label: 'Staff Welfare Expenses' },
  { code: 'TRAINING', label: 'Training' },
  { code: 'TRAVEL_EXPENSES', label: 'Travel Expenses' },
  { code: 'UNLOADING_EXPENSES', label: 'Unloading Expenses' },
  { code: 'UTILITIES_AND_OFFICE', label: 'Utilities & Office' },
] as const;

export type ClaimTypeCode = (typeof CLAIM_TYPES)[number]['code'];

const BY_CODE = new Map<string, string>(CLAIM_TYPES.map((t) => [t.code, t.label]));

/**
 * Types used before the expense-head list was introduced. Kept so historic
 * claims still render a sensible label even if they were never migrated.
 */
export const LEGACY_CLAIM_TYPE_MAP: Record<string, ClaimTypeCode> = {
  TRAVEL: 'TRAVEL_EXPENSES',
  ACCOMMODATION: 'TRAVEL_EXPENSES',
  FOOD: 'STAFF_WELFARE_EXPENSES',
  MEDICAL: 'STAFF_WELFARE_EXPENSES',
};

export const isValidClaimType = (code: string): boolean => BY_CODE.has(code);

/** Human label for a stored code — falls back to a readable form of anything unknown. */
export function claimTypeLabel(code: string | null | undefined): string {
  if (!code) return '—';
  const direct = BY_CODE.get(code);
  if (direct) return direct;
  const legacy = LEGACY_CLAIM_TYPE_MAP[code];
  if (legacy) return BY_CODE.get(legacy) ?? code;
  // Unknown code — title-case the raw value rather than showing UPPER_SNAKE.
  return code
    .toLowerCase()
    .split('_')
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(' ');
}
