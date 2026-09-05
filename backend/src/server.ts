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

async function buildServer() {
  // Cast to the default FastifyInstance: passing a custom pino instance otherwise
  // leaks a narrower logger generic that conflicts with our route registrars.
  // trustProxy: behind Railway's edge proxy the client IP arrives in X-Forwarded-For;
  // without this, per-IP rate limits would lump every user into one shared bucket.
  const app = Fastify({ logger, trustProxy: true }) as unknown as FastifyInstance;

  await app.register(cors, { origin: true, credentials: true });
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
