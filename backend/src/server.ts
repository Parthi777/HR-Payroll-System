import { pathToFileURL } from 'node:url';
import Fastify, { type FastifyInstance } from 'fastify';
import cors from '@fastify/cors';
import jwt from '@fastify/jwt';
import multipart from '@fastify/multipart';
import rateLimit from '@fastify/rate-limit';
import { Server as SocketServer } from 'socket.io';

import { env } from './config/env.js';
import { logger } from './utils/logger.js';
import prismaPlugin from './plugins/prisma.js';
import { errorHandler } from './middleware/errorHandler.js';
import { registerRoutes } from './routes/index.js';
import { beginRequestContext } from './context/tenant-context.js';
import { ensureSeedData } from './bootstrap.js';

/**
 * Who may call this API from a browser.
 *
 * Allows the apex and any single-label subdomain of it — `yourapp.com`,
 * `acme.yourapp.com`, `admin.yourapp.com` — plus localhost for development.
 */
function corsOrigin(): true | ((origin: string | undefined, cb: (err: Error | null, ok: boolean) => void) => void) {
  const base = env.APP_BASE_DOMAIN?.toLowerCase();
  if (!base) return true;

  return (origin, cb) => {
    // No Origin at all is a server-to-server or same-origin call, not a browser
    // cross-origin request — the Android app sends none.
    if (!origin) return cb(null, true);
    let host: string;
    try {
      host = new URL(origin).hostname.toLowerCase();
    } catch {
      return cb(null, false);
    }
    const isLocal = host === 'localhost' || host === '127.0.0.1';
    const underBase = host === base || (host.endsWith(`.${base}`) && !host.slice(0, -(base.length + 1)).includes('.'));
    cb(null, isLocal || underBase);
  };
}

async function buildServer() {
  // Cast to the default FastifyInstance: passing a custom pino instance otherwise
  // leaks a narrower logger generic that conflicts with our route registrars.
  // trustProxy: behind Railway's edge proxy the client IP arrives in X-Forwarded-For;
  // without this, per-IP rate limits would lump every user into one shared bucket.
  const app = Fastify({ logger, trustProxy: true }) as unknown as FastifyInstance;

  // Once tenants live under a real apex, only that apex and its subdomains may
  // call the API. `origin: true` reflects whatever Origin the caller sends,
  // which is the right default while there is no domain to key on but far too
  // open once there is one. Unset APP_BASE_DOMAIN keeps the old behaviour, so
  // this tightens by itself the moment the domain is configured.
  await app.register(cors, { origin: corsOrigin(), credentials: true });
  await app.register(jwt, { secret: env.JWT_SECRET });
  await app.register(multipart, { limits: { fileSize: 10 * 1024 * 1024 } }); // 10MB selfies
  await app.register(rateLimit, { global: false, max: 100, timeWindow: '1 minute' });
  await app.register(prismaPlugin);

  app.setErrorHandler(errorHandler);

  // Open the tenant-context frame for every request, before any route runs.
  // It starts empty and stays empty for unauthenticated routes; `authenticate()`
  // fills it in once the JWT is verified. It must be an onRequest hook calling
  // done() inside the frame — setting the store from a later preHandler does not
  // reach the route handler. Any tenant-scoped query outside a filled frame
  // throws rather than running unscoped (see plugins/prisma.ts).
  app.addHook('onRequest', (_req, _reply, done) => beginRequestContext(done));

  // Exact "METHOD /full/path" for every registered route. printRoutes() only
  // renders a tree and drops the prefix of nested groups, so this is what the
  // isolation suite's coverage guard reads to notice a route nobody classified.
  const routeList: string[] = [];
  app.addHook('onRoute', (route) => {
    const methods = Array.isArray(route.method) ? route.method : [route.method];
    for (const method of methods) {
      if (method !== 'HEAD') routeList.push(`${method} ${route.url}`);
    }
  });
  app.decorate('routeList', routeList);

  await registerRoutes(app);

  // Socket.io live feed (attendance dashboard) shares Fastify's HTTP server.
  // Must be decorated BEFORE listen() — Fastify forbids decorating a started instance.
  const io = new SocketServer(app.server, { cors: { origin: '*' } });
  io.on('connection', (socket) => {
    logger.info({ id: socket.id }, 'Socket connected');
  });
  app.decorate('io', io);

  return app;
}

async function start() {
  const app = await buildServer();

  try {
    await ensureSeedData(app.prisma); // no-op once seeded; makes fresh deploys log-in-ready
    await app.listen({ port: env.PORT, host: '0.0.0.0' });
    logger.info(`🚀 Backend listening on http://localhost:${env.PORT}`);
  } catch (err) {
    logger.error(err);
    process.exit(1);
  }
}

// Only listen when run as the entrypoint. Tests import `buildServer` to drive
// the real app in-process, and importing this module must not bind a port or
// seed anything.
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  start();
}

export { buildServer };
