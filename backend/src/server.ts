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
import { runInTenant } from './context/tenant-context.js';
import { closeWhatsAppQueue, isQueueEnabled, startWhatsAppWorker } from './services/queue/whatsapp.queue.js';
import { runWhatsAppJob } from './services/whatsapp/whatsapp.service.js';
import { startReminderScheduler } from './services/attendance/reminders.service.js';

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
  // `loggerInstance`, not `logger`: Fastify 5 takes only a configuration object
  // under `logger` and rejects a constructed pino instance outright — which is
  // a boot-time throw, so it fails loudly rather than quietly logging nowhere.
  //
  // Cast to the default FastifyInstance: passing a custom pino instance otherwise
  // leaks a narrower logger generic that conflicts with our route registrars.
  // trustProxy: behind Railway's edge proxy the client IP arrives in X-Forwarded-For;
  // without this, per-IP rate limits would lump every user into one shared bucket.
  const app = Fastify({ loggerInstance: logger, trustProxy: true }) as unknown as FastifyInstance;

  // Once tenants live under a real apex, only that apex and its subdomains may
  // call the API. `origin: true` reflects whatever Origin the caller sends,
  // which is the right default while there is no domain to key on but far too
  // open once there is one. Unset APP_BASE_DOMAIN keeps the old behaviour, so
  // this tightens by itself the moment the domain is configured.
  // `methods` is stated rather than left to the plugin's default. @fastify/cors
  // 9 defaulted to GET,HEAD,PUT,PATCH,POST,DELETE; 11 narrowed that default to
  // GET,HEAD,POST, so the Fastify 5 upgrade silently stopped the browser from
  // sending every PUT, PATCH and DELETE the admin web app makes — approvals,
  // edits and deletions all failed the preflight and surfaced as "Failed to
  // fetch". Nothing reached the server, so there was no error to find in a log.
  // Naming the verbs here means a future bump cannot move them again.
  await app.register(cors, {
    origin: corsOrigin(),
    credentials: true,
    methods: ['GET', 'HEAD', 'POST', 'PUT', 'PATCH', 'DELETE'],
  });
  await app.register(jwt, { secret: env.JWT_SECRET });
  // Refresh tokens get their own secret, reachable as `app.jwt.refresh`.
  // JWT_REFRESH_SECRET has been required by config/env.ts since the beginning
  // and was never used — both kinds of token were signed with JWT_SECRET, which
  // meant the two could only ever be invalidated together. Rotating this one
  // now ends every session's ability to refresh without also invalidating the
  // access tokens people are holding.
  await app.register(jwt, { secret: env.JWT_REFRESH_SECRET, namespace: 'refresh' });
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

/**
 * Drain the WhatsApp queue.
 *
 * Started here rather than in buildServer(): the tests build the real app
 * in-process and must not open a Redis connection or start competing for jobs.
 * No-op when REDIS_URL is unset, which is every deployment that has not
 * provisioned a Redis — those send inline exactly as before.
 *
 * A worker runs in no request, so it has no tenant context and every
 * tenant-scoped query would refuse to run. The job carries its tenant and the
 * worker re-enters it here. `subjectId` names the worker rather than a person
 * because no person asked for this particular send.
 */
function startQueueWorker(app: FastifyInstance) {
  startWhatsAppWorker((job, attemptsMade) =>
    runInTenant(
      { tenantId: job.tenantId, subjectId: 'whatsapp-worker', role: 'SUPER_ADMIN' },
      () => runWhatsAppJob(app.prisma, job, attemptsMade),
    ),
  );
}

async function start() {
  const app = await buildServer();

  // Punch reminders. Like the queue worker, started here and not in
  // buildServer() — the tests drive the real app in-process and must not open a
  // timer that pushes to real phones.
  const stopReminders = startReminderScheduler(app.prisma);

  try {
    await ensureSeedData(app.prisma); // no-op once seeded; makes fresh deploys log-in-ready
    startQueueWorker(app);
    await app.listen({ port: env.PORT, host: '0.0.0.0' });
    logger.info(
      { queue: isQueueEnabled() ? 'on' : 'off (no REDIS_URL — WhatsApp sends inline)' },
      `🚀 Backend listening on http://localhost:${env.PORT}`,
    );
  } catch (err) {
    logger.error(err);
    process.exit(1);
  }

  // Railway sends SIGTERM on redeploy. Close the worker first so a send in
  // flight finishes and its row is not left reading QUEUED.
  for (const signal of ['SIGTERM', 'SIGINT'] as const) {
    process.once(signal, async () => {
      logger.info({ signal }, 'shutting down');
      stopReminders();
      await closeWhatsAppQueue();
      await app.close();
      process.exit(0);
    });
  }
}

// Only listen when run as the entrypoint. Tests import `buildServer` to drive
// the real app in-process, and importing this module must not bind a port or
// seed anything.
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  start();
}

export { buildServer };
