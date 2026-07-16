import bcrypt from 'bcrypt';
import type { PrismaClient } from '@prisma/client';
import { AppError } from '../../utils/AppError.js';
import { normalizePhone } from '../../utils/phone.js';

/** Employee login with phone + password (password is set by the admin at creation). */
export async function employeeLogin(prisma: PrismaClient, phone: string, password: string) {
  // Accept the number with or without +91 / spaces — stored numbers are E.164.
  const employee = await prisma.employee.findFirst({
    where: { phone: { in: [phone.trim(), normalizePhone(phone)] } },
  });
  // Same generic error whether the phone or password is wrong, or no password is set yet.
  if (!employee || !employee.passwordHash) throw AppError.unauthorized('Invalid phone or password');
  const ok = await bcrypt.compare(password, employee.passwordHash);
  if (!ok) throw AppError.unauthorized('Invalid phone or password');
  if (employee.status !== 'ACTIVE') throw AppError.unauthorized('Account disabled — contact HR');
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
