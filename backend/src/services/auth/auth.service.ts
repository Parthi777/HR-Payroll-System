import bcrypt from 'bcrypt';
import type { PrismaClient } from '@prisma/client';
import { AppError } from '../../utils/AppError.js';
import { env } from '../../config/env.js';

const OTP_TTL_MS = 5 * 60 * 1000; // 5 minutes
const MAX_OTP_ATTEMPTS = 5;

/**
 * Generate a 6-digit OTP, store only its bcrypt hash, return the plaintext so the
 * caller can dispatch it (SMS/WhatsApp) — or, in dev, surface it directly.
 */
export async function createOtp(prisma: PrismaClient, phone: string): Promise<string> {
  const code = env.DEV_FIXED_OTP ?? String(Math.floor(100000 + Math.random() * 900000));
  const codeHash = await bcrypt.hash(code, 10);
  await prisma.otpCode.create({
    data: { phone, codeHash, expiresAt: new Date(Date.now() + OTP_TTL_MS) },
  });
  return code;
}

/** Verify an OTP and return the matching employee. Throws on any failure. */
export async function verifyOtp(prisma: PrismaClient, phone: string, otp: string) {
  // Dev convenience: when a fixed OTP is configured (no SMS provider), accept it
  // directly — independent of send-otp rate limits, the 5-min expiry, or consumption.
  // Removed automatically in production where DEV_FIXED_OTP is unset.
  if (env.DEV_FIXED_OTP && otp === env.DEV_FIXED_OTP) {
    const employee = await prisma.employee.findUnique({ where: { phone } });
    if (!employee) throw AppError.notFound('No employee registered with this phone number');
    return employee;
  }

  const record = await prisma.otpCode.findFirst({
    where: { phone, consumed: false },
    orderBy: { createdAt: 'desc' },
  });
  if (!record) throw AppError.unauthorized('No OTP requested for this number');
  if (record.expiresAt < new Date()) throw AppError.unauthorized('OTP expired');
  if (record.attempts >= MAX_OTP_ATTEMPTS) throw AppError.unauthorized('Too many attempts — request a new OTP');

  const ok = await bcrypt.compare(otp, record.codeHash);
  if (!ok) {
    await prisma.otpCode.update({ where: { id: record.id }, data: { attempts: record.attempts + 1 } });
    throw AppError.unauthorized('Invalid OTP');
  }

  await prisma.otpCode.update({ where: { id: record.id }, data: { consumed: true } });

  const employee = await prisma.employee.findUnique({ where: { phone } });
  if (!employee) throw AppError.notFound('No employee registered with this phone number');
  return employee;
}

/** Authenticate an admin by email + password. Throws on invalid credentials. */
export async function adminLogin(prisma: PrismaClient, email: string, password: string) {
  const admin = await prisma.adminUser.findUnique({ where: { email } });
  // Same generic error whether the email or password is wrong (avoid user enumeration).
  if (!admin || !admin.isActive) throw AppError.unauthorized('Invalid email or password');
  const ok = await bcrypt.compare(password, admin.passwordHash);
  if (!ok) throw AppError.unauthorized('Invalid email or password');
  return admin;
}
