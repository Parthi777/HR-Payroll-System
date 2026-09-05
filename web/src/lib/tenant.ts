/**
 * Which workspace this browser is signed in to.
 *
 * The API is one host serving every dealer, so the tenant travels as an
 * `X-Tenant-Slug` header rather than in the URL the request goes to. The slug
 * is read from where the user actually is, in priority order:
 *
 *   1. the subdomain — acme.yourapp.com → "acme"
 *   2. `?tenant=acme` — a branded link, or local development
 *   3. what was stored at the last successful sign-in
 *
 * Returning null is normal and fine: the backend falls back to the only tenant
 * when just one exists, which is what keeps a single-dealer deployment working
 * before subdomains are set up.
 */

const SLUG_KEY = 'tenantSlug';
const NAME_KEY = 'tenantName';

/** Hosts that are the product itself, never a dealer. */
const RESERVED = new Set(['www', 'api', 'app', 'admin', 'platform', 'static', 'assets']);

const SLUG = /^[a-z0-9][a-z0-9-]{1,30}$/;

function clean(value: string | null | undefined): string | null {
  if (!value) return null;
  const slug = value.trim().toLowerCase();
  return SLUG.test(slug) && !RESERVED.has(slug) ? slug : null;
}

/**
 * The slug from the current hostname — only under a configured apex.
 *
 * This mirrors `tenantSlugFromRequest` on the server, and the mirroring is the
 * point. An earlier version treated the first label of any multi-label host as
 * a tenant, which meant the Railway domain `web-production-2b851.up.railway.app`
 * sent `X-Tenant-Slug: web-production-2b851` and every sign-in failed with
 * "Workspace not found". A hostname only names a tenant when we know which apex
 * the tenants live under; without that, guessing is wrong.
 */
function fromHostname(): string | null {
  if (typeof window === 'undefined') return null;
  const base = process.env.NEXT_PUBLIC_APP_BASE_DOMAIN?.toLowerCase();
  if (!base) return null;

  const host = window.location.hostname.toLowerCase();
  if (host === base || !host.endsWith(`.${base}`)) return null;
  const label = host.slice(0, -(base.length + 1));
  if (label.includes('.')) return null; // deeper than one level is not a tenant
  return clean(label);
}

function fromQuery(): string | null {
  if (typeof window === 'undefined') return null;
  const params = new URLSearchParams(window.location.search);
  return clean(params.get('tenant') ?? params.get('d'));
}

function fromStorage(): string | null {
  if (typeof window === 'undefined') return null;
  return clean(localStorage.getItem(SLUG_KEY));
}

/** The workspace this request is for, or null to let the backend decide. */
export function tenantSlug(): string | null {
  return fromHostname() ?? fromQuery() ?? fromStorage();
}

/** Remember the workspace a successful sign-in resolved to. */
export function rememberTenant(slug: string, name: string): void {
  localStorage.setItem(SLUG_KEY, slug);
  localStorage.setItem(NAME_KEY, name);
}

/** The signed-in workspace's display name, for the app header. */
export function tenantName(): string | null {
  return typeof window === 'undefined' ? null : localStorage.getItem(NAME_KEY);
}

/**
 * Clear everything identifying the session.
 *
 * Includes the role: leaving it behind meant the next person to sign in on this
 * browser was briefly gated by the previous user's permissions.
 */
export function clearSession(): void {
  for (const key of ['token', 'adminName', 'adminRole', SLUG_KEY, NAME_KEY]) {
    localStorage.removeItem(key);
  }
}
