import bcrypt from 'bcrypt';
import type { PrismaClient } from '@prisma/client';
import { AppError } from '../../utils/AppError.js';
import { normalizePhone } from '../../utils/phone.js';

/**
 * Employee login with their user ID + password. The user ID is the employee
 * code (EMP001), or the phone number. The password is only ever issued by an
 * administrator — at creation, by reset, or by bulk import.
 *
 * The code is tried first and the phone only if no code matches, so a dealer
 * who hands out numeric codes still resolves each one to a single person.
 */
export async function employeeLogin(prisma: PrismaClient, userId: string, password: string) {
  const id = userId.trim();
  // Codes are generated upper-case; accept them typed in lower case too.
  // (An `in` list rather than case-insensitive mode, which SQLite lacks.)
  const employee =
    (await prisma.employee.findFirst({ where: { employeeCode: { in: [id, id.toUpperCase()] } } })) ??
    // Accept the number with or without +91 / spaces — stored numbers are E.164.
    (await prisma.employee.findFirst({ where: { phone: { in: [id, normalizePhone(id)] } } }));
  // Same generic error whether the ID or password is wrong, or no password is set yet.
  if (!employee || !employee.passwordHash) throw AppError.unauthorized('Invalid user ID or password');
  const ok = await bcrypt.compare(password, employee.passwordHash);
  if (!ok) throw AppError.unauthorized('Invalid user ID or password');
  if (employee.status !== 'ACTIVE') throw AppError.unauthorized('Account disabled — contact HR');
  return employee;
}

/**
 * Authenticate an admin by email + password. Throws on invalid credentials.
 *
 * findFirst rather than findUnique: email is unique *per tenant* now, and the
 * caller runs this inside the tenant's context, so the lookup is already scoped.
 */
export async function adminLogin(prisma: PrismaClient, email: string, password: string) {
  const admin = await prisma.adminUser.findFirst({ where: { email } });
  // Same generic error whether the email or password is wrong (avoid user enumeration).
  if (!admin || !admin.isActive) throw AppError.unauthorized('Invalid email or password');
  const ok = await bcrypt.compare(password, admin.passwordHash);
  if (!ok) throw AppError.unauthorized('Invalid email or password');
  return admin;
}
