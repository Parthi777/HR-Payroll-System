import fp from 'fastify-plugin';
import { PrismaClient } from '@prisma/client';
import type { FastifyPluginAsync } from 'fastify';
import { currentContext } from '../context/tenant-context.js';
import { GLOBAL_MODELS, TENANT_SCOPED_MODELS, scopeArgs } from '../context/tenant-scope.js';
import { AppError } from '../utils/AppError.js';
import { logger } from '../utils/logger.js';

/**
 * The tenant-isolating Prisma client.
 *
 * Every operation on a tenant-scoped model is filtered by the tenant in the
 * request's AsyncLocalStorage context. Because the extended client is still
 * decorated as `app.prisma`, none of the existing call sites change — they
 * become tenant-safe by construction rather than by remembering a filter.
 *
 * It fails CLOSED: a query on a tenant-scoped model with no context at all
 * throws rather than returning every tenant's rows. That turns "someone forgot
 * to establish context" into a loud 500 on the first request instead of a
 * silent cross-tenant leak.
 */
function tenantClient() {
  return new PrismaClient().$extends({
    name: 'tenant-isolation',
    query: {
      $allModels: {
        async $allOperations({ model, operation, args, query }) {
          if (!model || GLOBAL_MODELS.has(model)) return query(args);

          if (!TENANT_SCOPED_MODELS.has(model)) {
            // A model in neither set is an oversight — almost certainly a new
            // model added without deciding its tenancy. tenancy-extension.test.ts
            // catches this at build time; this is the runtime backstop.
            throw new AppError(`Model ${model} has no tenancy classification`, 500);
          }

          const ctx = currentContext();

          if (!ctx) {
            throw new AppError(
              `Query on ${model}.${operation} outside a tenant context — refusing to run unscoped`,
              500,
            );
          }

          // Platform staff operate above tenancy; unscoped work has stated why.
          if (ctx.kind === 'PLATFORM') return query(args);
          if (ctx.kind === 'UNSCOPED') {
            logger.debug({ model, operation, reason: ctx.reason }, 'unscoped query');
            return query(args);
          }

          // Prisma's per-operation arg union is too wide to name here; the
          // shape is preserved by scopeArgs, which only adds `where`/`data`.
          return query(scopeArgs(operation, args as Record<string, unknown>, ctx.tenantId) as never);
        },
      },
    },
  });
}

declare module 'fastify' {
  interface FastifyInstance {
    prisma: PrismaClient;
  }
}

const prismaPlugin: FastifyPluginAsync = fp(async (fastify) => {
  const prisma = tenantClient();
  await prisma.$connect();

  // An extended client is structurally identical to PrismaClient except that it
  // drops the deprecated `$on`/`$use` hooks, which nothing here uses. Declaring
  // it as PrismaClient keeps all 172 call sites and all 32 service signatures
  // unchanged — the isolation is a runtime property of the extension, and the
  // extension adds no fields that a caller could want to see in the type.
  fastify.decorate('prisma', prisma as unknown as PrismaClient);

  fastify.addHook('onClose', async (instance) => {
    await instance.prisma.$disconnect();
  });
});

export default prismaPlugin;
export { tenantClient };
