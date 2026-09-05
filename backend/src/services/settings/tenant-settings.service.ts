/**
 * A tenant's settings, and the policy derived from them.
 *
 * Everything here used to be a process-wide environment variable read once at
 * module import — which meant every dealer shared one timezone, one pay day and
 * one half-day window. Those are now per-tenant, so they have to be read per
 * request and passed to the functions that use them.
 *
 * The env vars survive as *platform defaults*: they seed a new tenant's row and
 * back-stop a tenant that has no row yet, so a single-tenant deployment behaves
 * exactly as it did before.
 */
import type { PrismaClient } from '@prisma/client';
import { env } from '../../config/env.js';

/** Attendance rules — what counts as late, and what counts as a half day. */
export interface AttendancePolicy {
  timezone: string;
  halfDayWindowStart: string;
  halfDayWindowEnd: string;
  lateRequiresApproval: boolean;
  openPunchLookbackDays: number;
}

/** Payroll rules. See CLAUDE.md "Payroll Calculation Engine" for the meaning. */
export interface PayrollPolicy {
  monthDivisor: number;
  clPerYear: number;
  otHoursPerDay: number;
  lateShiftAt: number;
  lateWithholdOver: number;
  payDay: number;
  payDayLate: number;
}

/** Where this tenant's faces, selfies and claim files live. */
export interface ResourcePolicy {
  faceMatchThreshold: number;
  rekognitionCollectionId: string;
  s3Prefix: string;
  driveParentFolderId: string | null;
  driveShareWith: string | null;
  whatsappMode: 'SHARED' | 'OWN';
  whatsappConfig: Record<string, string> | null;
}

export interface TenantPolicy {
  company: { name: string; address: string; phone: string; email: string; gstin: string };
  attendance: AttendancePolicy;
  payroll: PayrollPolicy;
  resources: ResourcePolicy;
}

/**
 * Platform defaults, from the environment.
 *
 * Used when a tenant has no settings row, and as the seed for a new one. Keeping
 * the env vars as the default is what lets the existing single-tenant
 * deployment keep behaving identically after this change.
 */
export function defaultPolicy(): TenantPolicy {
  return {
    company: {
      name: process.env.COMPANY_NAME ?? '',
      address: process.env.COMPANY_ADDRESS ?? '',
      phone: '',
      email: '',
      gstin: '',
    },
    attendance: {
      timezone: process.env.COMPANY_TZ ?? 'Asia/Kolkata',
      halfDayWindowStart: process.env.HALF_DAY_WINDOW_START ?? '12:30',
      halfDayWindowEnd: process.env.HALF_DAY_WINDOW_END ?? '14:00',
      lateRequiresApproval: process.env.LATE_REQUIRES_APPROVAL !== 'false',
      openPunchLookbackDays: Number(process.env.OPEN_PUNCH_LOOKBACK_DAYS ?? 7),
    },
    payroll: {
      monthDivisor: 30,
      clPerYear: 12,
      otHoursPerDay: 10,
      lateShiftAt: Number(process.env.PAYROLL_LATE_SHIFT_AT ?? 5),
      lateWithholdOver: Number(process.env.PAYROLL_LATE_WITHHOLD_OVER ?? 8),
      payDay: Number(process.env.PAYROLL_PAY_DAY ?? 5),
      payDayLate: Number(process.env.PAYROLL_PAY_DAY_LATE ?? 8),
    },
    resources: {
      faceMatchThreshold: env.FACE_MATCH_THRESHOLD,
      rekognitionCollectionId: env.AWS_REKOGNITION_COLLECTION_ID,
      s3Prefix: '',
      driveParentFolderId: env.GOOGLE_DRIVE_PARENT_FOLDER_ID ?? null,
      driveShareWith: env.GOOGLE_DRIVE_SHARE_WITH ?? null,
      whatsappMode: 'SHARED',
      whatsappConfig: null,
    },
  };
}

type SettingsRow = {
  name: string; address: string; phone: string; email: string; gstin: string;
  timezone: string; halfDayWindowStart: string; halfDayWindowEnd: string;
  lateRequiresApproval: boolean; openPunchLookbackDays: number;
  monthDivisor: number; clPerYear: number; otHoursPerDay: number;
  payrollLateShiftAt: number; payrollLateWithholdOver: number;
  payrollPayDay: number; payrollPayDayLate: number;
  faceMatchThreshold: number; rekognitionCollectionId: string | null; s3Prefix: string;
  driveParentFolderId: string | null; driveShareWith: string | null;
  whatsappMode: string; whatsappConfig: string | null;
};

function toPolicy(row: SettingsRow): TenantPolicy {
  const fallback = defaultPolicy();
  return {
    company: {
      name: row.name, address: row.address, phone: row.phone, email: row.email, gstin: row.gstin,
    },
    attendance: {
      timezone: row.timezone,
      halfDayWindowStart: row.halfDayWindowStart,
      halfDayWindowEnd: row.halfDayWindowEnd,
      lateRequiresApproval: row.lateRequiresApproval,
      openPunchLookbackDays: row.openPunchLookbackDays,
    },
    payroll: {
      monthDivisor: row.monthDivisor,
      clPerYear: row.clPerYear,
      otHoursPerDay: row.otHoursPerDay,
      lateShiftAt: row.payrollLateShiftAt,
      lateWithholdOver: row.payrollLateWithholdOver,
      payDay: row.payrollPayDay,
      payDayLate: row.payrollPayDayLate,
    },
    resources: {
      faceMatchThreshold: row.faceMatchThreshold,
      // Falls back to the platform collection: the first dealer's faces are
      // already enrolled there, and moving them would mean re-enrolling everyone.
      rekognitionCollectionId: row.rekognitionCollectionId ?? fallback.resources.rekognitionCollectionId,
      s3Prefix: row.s3Prefix,
      driveParentFolderId: row.driveParentFolderId ?? fallback.resources.driveParentFolderId,
      driveShareWith: row.driveShareWith ?? fallback.resources.driveShareWith,
      whatsappMode: row.whatsappMode === 'OWN' ? 'OWN' : 'SHARED',
      whatsappConfig: parseConfig(row.whatsappConfig),
    },
  };
}

function parseConfig(raw: string | null): Record<string, string> | null {
  if (!raw) return null;
  try {
    return JSON.parse(raw) as Record<string, string>;
  } catch {
    return null; // a malformed config falls back to the shared sender
  }
}

/**
 * The current tenant's policy.
 *
 * Scoped by the Prisma extension, so this reads the caller's own row and no
 * other. A tenant with no row yet gets the platform defaults rather than an
 * error — settings are optional, and a dealer should work before anyone opens
 * the settings screen.
 *
 * Not cached: it is one indexed read, and a stale policy would mean paying
 * someone by yesterday's rules. Phase 8 moves it behind Redis, which is shared
 * across replicas and can be invalidated on write.
 */
export async function getTenantPolicy(prisma: PrismaClient): Promise<TenantPolicy> {
  const row = await prisma.tenantSettings.findFirst();
  return row ? toPolicy(row as SettingsRow) : defaultPolicy();
}

/** The company block alone, for PDF and report headers. */
export async function getCompanyProfile(
  prisma: PrismaClient,
): Promise<{ name: string; address: string }> {
  const policy = await getTenantPolicy(prisma);
  return {
    name: policy.company.name || process.env.COMPANY_NAME || 'AI HR Payroll',
    address: policy.company.address,
  };
}
