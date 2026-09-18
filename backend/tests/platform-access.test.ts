/**
 * The platform API's address allowlist.
 *
 * Runs on a bare Fastify app with the same hook and the same trustProxy
 * setting as the real server, so it needs no database: the point is that a
 * refused address never reaches a handler at all.
 */
import { describe, expect, it } from 'vitest';
import Fastify from 'fastify';
import { isAllowed, parseAllowList, platformAccessHook } from '../src/services/platform/platform-access.js';

describe('platform address allowlist', () => {
  it('is off when unset or blank', () => {
    expect(parseAllowList(undefined)).toBeNull();
    expect(parseAllowList('  , ')).toBeNull();
  });

  it('matches single addresses and ranges, in both families', () => {
    const list = parseAllowList('203.0.113.7, 198.51.100.0/24, 2001:db8::/48')!;
    expect(isAllowed(list, '203.0.113.7')).toBe(true);
    expect(isAllowed(list, '203.0.113.8')).toBe(false);
    expect(isAllowed(list, '198.51.100.200')).toBe(true);
    expect(isAllowed(list, '198.51.101.1')).toBe(false);
    expect(isAllowed(list, '2001:db8:0:1::5')).toBe(true);
    expect(isAllowed(list, '2001:db9::1')).toBe(false);
    // What a dual-stack listener reports for an IPv4 client.
    expect(isAllowed(list, '::ffff:203.0.113.7')).toBe(true);
    expect(isAllowed(list, 'not-an-ip')).toBe(false);
  });

  it('refuses a malformed entry instead of guessing', () => {
    expect(() => parseAllowList('203.0.113.300')).toThrow(/not an IP/);
    expect(() => parseAllowList('office')).toThrow(/not an IP/);
    expect(() => parseAllowList('198.51.100.0/33')).toThrow(/range size/);
    expect(() => parseAllowList('198.51.100.0/abc')).toThrow(/range size/);
  });

  it('answers a refused address exactly as a route that does not exist', async () => {
    const app = Fastify({ trustProxy: true });
    let reached = false;
    await app.register(async (scoped) => {
      scoped.addHook('onRequest', platformAccessHook(parseAllowList('203.0.113.7')!));
      scoped.get('/api/platform/me', async () => {
        reached = true;
        return { ok: true };
      });
    });
    await app.ready();

    const allowed = await app.inject({ method: 'GET', url: '/api/platform/me', remoteAddress: '203.0.113.7' });
    expect(allowed.statusCode).toBe(200);
    expect(reached).toBe(true);

    reached = false;
    const refused = await app.inject({ method: 'GET', url: '/api/platform/me', remoteAddress: '198.51.100.1' });
    const missing = await app.inject({ method: 'GET', url: '/api/platform/nothing-here', remoteAddress: '198.51.100.1' });
    expect(refused.statusCode).toBe(404);
    expect(reached, 'the handler ran for a refused address').toBe(false);
    // Same shape as a genuinely missing route, bar the path it names.
    expect(Object.keys(refused.json()).sort()).toEqual(Object.keys(missing.json()).sort());

    await app.close();
  });
});
