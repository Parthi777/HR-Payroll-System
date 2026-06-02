import Fastify from 'fastify';
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

async function buildServer() {
  const app = Fastify({ loggerInstance: logger });

  await app.register(cors, { origin: true, credentials: true });
  await app.register(jwt, { secret: env.JWT_SECRET });
  await app.register(multipart, { limits: { fileSize: 10 * 1024 * 1024 } }); // 10MB selfies
  await app.register(rateLimit, { global: false, max: 100, timeWindow: '1 minute' });
  await app.register(prismaPlugin);

  app.setErrorHandler(errorHandler);

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
    await app.listen({ port: env.PORT, host: '0.0.0.0' });
    logger.info(`🚀 Backend listening on http://localhost:${env.PORT}`);
  } catch (err) {
    logger.error(err);
    process.exit(1);
  }
}

start();

export { buildServer };
