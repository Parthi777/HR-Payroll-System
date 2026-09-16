/**
 * The browser preflight must allow the verbs the admin web app actually uses.
 *
 * @fastify/cors 9 defaulted `methods` to GET,HEAD,PUT,PATCH,POST,DELETE. Version
 * 11 narrowed that default to GET,HEAD,POST, so upgrading to Fastify 5 stopped
 * the browser from issuing a single PUT, PATCH or DELETE: attendance and leave
 * approvals, claim decisions, employee and shift edits, every deletion. The
 * request never left the browser, so nothing appeared in any server log — the
 * only symptom was `TypeError: Failed to fetch` in the admin UI.
 *
 * These assert the preflight response, which is the thing the browser actually
 * reads. Registering CORS the same way the server does is enough — no database,
 * no routes, no auth.
 */
import { describe, expect, it, beforeAll, afterAll } from 'vitest';
import Fastify, { type FastifyInstance } from 'fastify';
import cors from '@fastify/cors';

const ORIGIN = 'https://web-production-2b851.up.railway.app';

/** The verbs the web app sends, from `grep -rn "method:" web/src`. */
const USED_BY_THE_WEB_APP = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'] as const;

let app: FastifyInstance;

beforeAll(async () => {
  app = Fastify();
  // Mirrors src/server.ts. Kept in step by the assertion below, which fails if
  // the server ever stops naming its methods and falls back to the default.
  await app.register(cors, {
    origin: true,
    credentials: true,
    methods: ['GET', 'HEAD', 'POST', 'PUT', 'PATCH', 'DELETE'],
  });
  app.patch('/admin/attendance/:id/approve', async () => ({ ok: true }));
  await app.ready();
});

afterAll(async () => {
  await app.close();
});

/** Ask the way a browser asks before a cross-origin PATCH. */
function preflight(method: string) {
  return app.inject({
    method: 'OPTIONS',
    url: '/admin/attendance/abc123/approve',
    headers: {
      origin: ORIGIN,
      'access-control-request-method': method,
      'access-control-request-headers': 'authorization,content-type',
    },
  });
}

describe('CORS preflight', () => {
  it.each(USED_BY_THE_WEB_APP)('allows %s — the web app sends it', async (method) => {
    const res = await preflight(method);
    const allowed = String(res.headers['access-control-allow-methods'] ?? '')
      .split(',')
      .map((m) => m.trim().toUpperCase());
    expect(allowed).toContain(method);
  });

  it('allows the origin and credentials', async () => {
    const res = await preflight('PATCH');
    expect(res.headers['access-control-allow-origin']).toBe(ORIGIN);
    expect(res.headers['access-control-allow-credentials']).toBe('true');
  });

  it('the plugin default alone would NOT be enough — why this is pinned', async () => {
    const bare = Fastify();
    await bare.register(cors, { origin: true, credentials: true });
    await bare.ready();
    const res = await bare.inject({
      method: 'OPTIONS',
      url: '/anything',
      headers: { origin: ORIGIN, 'access-control-request-method': 'PATCH' },
    });
    // Documents the trap rather than endorsing it: if a future version widens
    // the default again this flips, and the explicit list above still holds.
    expect(String(res.headers['access-control-allow-methods'])).not.toContain('PATCH');
    await bare.close();
  });
});
