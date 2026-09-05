/**
 * Onboarding a dealer.
 *
 * One call creates everything a dealer needs to sign in and start working: the
 * tenant, its default org data, and its first administrator's credentials.
 * Doing it as a unit is the point — a tenant without a branch or without an
 * admin is a half-created customer that someone has to finish by hand.
 */
import type { PrismaClient } from '@prisma/client';
import bcrypt from 'bcrypt';
import { runInTenant } from '../../context/tenant-context.js';
import { AppError } from '../../utils/AppError.js';
import { env } from '../../config/env.js';

/** DNS label: it becomes the dealer's subdomain, so it must be one. */
const SLUG = /^[a-z0-9][a-z0-9-]{1,30}$/;

/** Slugs the platform itself uses; a dealer must never claim one. */
const RESERVED = new Set(['www', 'api', 'app', 'admin', 'platform', 'static', 'assets', 'mail']);

export interface NewTenantInput {
  slug: string;
  name: string;
  admin: { name: string; email: string; password: string };
  /** Optional starting org data; sensible defaults are created when omitted. */
  branchName?: string;
  timezone?: string;
  employeeCodePrefix?: string;
}

export interface ProvisionedTenant {
  id: string;
  slug: string;
  name: string;
  status: string;
  adminId: string;
  adminEmail: string;
  loginUrl: string;
}

/** Where this dealer's people sign in. */
export function tenantLoginUrl(slug: string): string {
  const base = process.env.APP_BASE_DOMAIN;
  return base ? `https://${slug}.${base}/login` : `/login?tenant=${slug}`;
}

export async function provisionTenant(
  prisma: PrismaClient,
  input: NewTenantInput,
): Promise<ProvisionedTenant> {
  const slug = input.slug.trim().toLowerCase();
  const email = input.admin.email.trim().toLowerCase();

  if (!SLUG.test(slug)) {
    throw new AppError(
      `"${input.slug}" cannot be a workspace address. Use lowercase letters, digits and hyphens, e.g. "abc-motors".`,
      400,
    );
  }
  if (RESERVED.has(slug)) throw new AppError(`"${slug}" is reserved`, 400);
  if (!input.name.trim()) throw new AppError('A dealer name is required', 400);
  if (!input.admin.name.trim()) throw new AppError("The administrator's name is required", 400);
  // Long enough to matter: this account can see every employee's salary.
  if (input.admin.password.length < 12) {
    throw new AppError('The administrator password must be at least 12 characters', 400);
  }

  const taken = await prisma.tenant.findUnique({ where: { slug } });
  if (taken) throw new AppError(`The address "${slug}" is already taken`, 409);

  const tenant = await prisma.tenant.create({
    data: { slug, name: input.name.trim(), status: 'ACTIVE' },
  });

  // Everything below belongs to the new tenant, so it is created inside that
  // tenant's context — the same scoping every other write goes through.
  const admin = await runInTenant(
    { tenantId: tenant.id, subjectId: 'provisioning', role: 'SUPER_ADMIN' },
    async () => {
      await prisma.branch.create({
        data: {
          tenantId: tenant.id,
          name: input.branchName?.trim() || 'Head Office',
          address: input.name.trim(),
          // Zeroed and soft: a real geofence is drawn on the map later, and a
          // strict fence around Null Island would block every check-in.
          geofenceLat: 0,
          geofenceLng: 0,
          geofenceRadius: 100,
          strictMode: false,
        },
      });
      await prisma.department.create({ data: { tenantId: tenant.id, name: 'General' } });
      await prisma.designation.create({ data: { tenantId: tenant.id, name: 'Staff' } });
      await prisma.shift.create({
        data: { tenantId: tenant.id, name: 'General Shift', startTime: '09:00', endTime: '18:00', gracePeriod: 15 },
      });
      await prisma.tenantSettings.create({
        data: {
          tenantId: tenant.id,
          name: input.name.trim(),
          address: '', phone: '', email: '', gstin: '',
          timezone: input.timezone ?? undefined,
          employeeCodePrefix: input.employeeCodePrefix?.trim().toUpperCase() || undefined,
          // Namespaced per dealer from the start. The first dealer predates this
          // and keeps the bucket root and the platform collection, which is why
          // these are stored rather than derived.
          rekognitionCollectionId: `${env.AWS_REKOGNITION_COLLECTION_ID}-${slug}`,
          s3Prefix: `t/${slug}/`,
        },
      });

      return prisma.adminUser.create({
        data: {
          tenantId: tenant.id,
          name: input.admin.name.trim(),
          email,
          passwordHash: await bcrypt.hash(input.admin.password, 12),
          role: 'SUPER_ADMIN',
          branchId: null, // sees every branch in their own dealer
        },
        select: { id: true, email: true },
      });
    },
  );

  return {
    id: tenant.id,
    slug: tenant.slug,
    name: tenant.name,
    status: tenant.status,
    adminId: admin.id,
    adminEmail: admin.email,
    loginUrl: tenantLoginUrl(tenant.slug),
  };
}

/** Add another administrator to an existing dealer. */
export async function addTenantAdmin(
  prisma: PrismaClient,
  tenantId: string,
  input: { name: string; email: string; password: string; role?: string },
): Promise<{ id: string; email: string; role: string }> {
  if (input.password.length < 12) {
    throw new AppError('The password must be at least 12 characters', 400);
  }
  const email = input.email.trim().toLowerCase();

  return runInTenant(
    { tenantId, subjectId: 'provisioning', role: 'SUPER_ADMIN' },
    async () => {
      // Scoped by the extension, so this only sees the dealer's own admins —
      // the same email may exist at another dealer.
      const clash = await prisma.adminUser.findFirst({ where: { email } });
      if (clash) throw new AppError(`${email} already has an account with this dealer`, 409);

      return prisma.adminUser.create({
        data: {
          tenantId,
          name: input.name.trim(),
          email,
          passwordHash: await bcrypt.hash(input.password, 12),
          role: input.role ?? 'HR_MANAGER',
        },
        select: { id: true, email: true, role: true },
      });
    },
  );
}
