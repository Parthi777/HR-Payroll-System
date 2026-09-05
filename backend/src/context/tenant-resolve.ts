/**
 * Working out which tenant a request is for, before anyone is authenticated.
 *
 * Two sources, in priority order:
 *   1. `X-Tenant-Slug` — what the web app sends (it reads its own subdomain in
 *      the browser and forwards it, because the API is on a single host), and
 *      what the Android app sends from the company code entered at login.
 *   2. The Host header's first label, when it sits under APP_BASE_DOMAIN.
 *
 * This is only an *identifier*. It never grants access on its own: an
 * authenticated request is scoped by the tenant on the signed token, and this
 * value is used to reject a token being replayed against another tenant's URL.
 */
import type { FastifyRequest } from 'fastify';
import type { PrismaClient } from '@prisma/client';
import { env } from '../config/env.js';
import { AppError } from '../utils/AppError.js';

/** Hostnames that are the product itself, never a tenant. */
const RESERVED = new Set(['www', 'api', 'app', 'admin', 'platform', 'static', 'assets']);

const SLUG = /^[a-z0-9][a-z0-9-]{1,30}$/;

/** Normalise and validate a slug; returns null when it could not be one. */
function clean(value: string | undefined): string | null {
  if (!value) return null;
  const slug = value.trim().toLowerCase();
  if (!SLUG.test(slug) || RESERVED.has(slug)) return null;
  return slug;
}

/** The tenant slug this request is addressed to, or null if it names none. */
export function tenantSlugFromRequest(req: FastifyRequest): string | null {
  const header = req.headers['x-tenant-slug'];
  const fromHeader = clean(Array.isArray(header) ? header[0] : header);
  if (fromHeader) return fromHeader;

  const base = env.APP_BASE_DOMAIN?.toLowerCase();
  if (!base) return null;

  // req.hostname excludes the port. Only trust a label directly under the apex,
  // so "evil.com" or "acme.evil.com" can never masquerade as a tenant.
  const host = req.hostname.toLowerCase();
  if (host === base || !host.endsWith(`.${base}`)) return null;
  const label = host.slice(0, -(base.length + 1));
  if (label.includes('.')) return null; // deeper than one level — not a tenant
  return clean(label);
}

export interface ResolvedTenant {
  id: string;
  slug: string;
  name: string;
  status: string;
}

/**
 * Look up the tenant a request names. Tenant is a global model, so this is safe
 * to call with no context established.
 *
 * A suspended tenant is refused here rather than deeper in, so a lapsed customer
 * gets one clear message instead of empty screens.
 */
export async function resolveTenant(
  prisma: PrismaClient,
  slug: string,
): Promise<ResolvedTenant> {
  const tenant = await prisma.tenant.findUnique({
    where: { slug },
    select: { id: true, slug: true, name: true, status: true },
  });
  if (!tenant) throw AppError.notFound('Workspace');
  if (tenant.status !== 'ACTIVE') {
    throw new AppError(`The ${tenant.name} workspace is suspended — please contact support.`, 403);
  }
  return tenant;
}

/** Resolve the tenant a request names, or fail with a helpful message. */
export async function requireTenantFromRequest(
  prisma: PrismaClient,
  req: FastifyRequest,
): Promise<ResolvedTenant> {
  const slug = tenantSlugFromRequest(req);
  if (!slug) {
    throw new AppError(
      'Could not tell which workspace this request is for. Sign in at your company URL, ' +
        'or send an X-Tenant-Slug header.',
      400,
    );
  }
  return resolveTenant(prisma, slug);
}
