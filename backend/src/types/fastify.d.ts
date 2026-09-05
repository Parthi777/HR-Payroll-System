import 'fastify';
import type { Server as SocketServer } from 'socket.io';

declare module 'fastify' {
  interface FastifyInstance {
    io: SocketServer;
    /** "METHOD /path" for every registered route (see server.ts). */
    routeList: string[];
  }
}
