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

/** The slug from the current hostname, if it looks like a tenant subdomain. */
function fromHostname(): string | null {
  if (typeof window === 'undefined') return null;
  const host = window.location.hostname.toLowerCase();
  // Bare hosts and IPs are development, not a tenant.
  if (host === 'localhost' || /^[\d.]+$/.test(host)) return null;
  const labels = host.split('.');
  // Needs at least label.domain.tld — "yourapp.com" alone has no tenant part.
  if (labels.length < 3) return null;
  return clean(labels[0]);
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
