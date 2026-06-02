import 'fastify';
import type { Server as SocketServer } from 'socket.io';

declare module 'fastify' {
  interface FastifyInstance {
    io: SocketServer;
  }
}
