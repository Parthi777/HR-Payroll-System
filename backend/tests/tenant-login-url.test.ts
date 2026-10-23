/**
 * The sign-in link the console hands to a dealer. It is sent as is, so it has
 * to be absolute whenever the deployment knows its own address.
 */
import { afterEach, describe, expect, it } from 'vitest';
import { tenantLoginUrl } from '../src/services/platform/tenant-provisioning.service.js';

const KEYS = ['APP_BASE_DOMAIN', 'ADMIN_APP_URL', 'PUBLIC_SITE_URL'] as const;
const saved = Object.fromEntries(KEYS.map((k) => [k, process.env[k]]));

afterEach(() => {
  for (const k of KEYS) {
    if (saved[k] === undefined) delete process.env[k];
    else process.env[k] = saved[k];
  }
});

const set = (env: Partial<Record<(typeof KEYS)[number], string>>) => {
  for (const k of KEYS) delete process.env[k];
  Object.assign(process.env, env);
};

describe('tenantLoginUrl', () => {
  it('uses Master Control’s address with ?tenant=', () => {
    set({ ADMIN_APP_URL: 'https://hr.kayaazh.com/' });
    expect(tenantLoginUrl('acme')).toBe('https://hr.kayaazh.com/login?tenant=acme');
  });

  it('falls back to the public site address', () => {
    set({ PUBLIC_SITE_URL: 'https://example.com' });
    expect(tenantLoginUrl('acme')).toBe('https://example.com/login?tenant=acme');
  });

  it('prefers the dealer’s own subdomain when subdomains are on', () => {
    set({ APP_BASE_DOMAIN: 'kayaazh.com', ADMIN_APP_URL: 'https://hr.kayaazh.com' });
    expect(tenantLoginUrl('acme')).toBe('https://acme.kayaazh.com/login');
  });

  it('is relative only when no address is configured', () => {
    set({});
    expect(tenantLoginUrl('acme')).toBe('/login?tenant=acme');
  });
});
