/**
 * The WhatsApp send queue, against a real Redis and a real Postgres.
 *
 * The thing worth proving is the tenant crossing the boundary. A worker runs in
 * no request, so it has no tenant context, and the Prisma extension refuses any
 * tenant-scoped query without one (it fails closed — see plugins/prisma.ts).
 * The tenant therefore rides on the job and the worker re-enters it. Get it
 * wrong and nothing leaks; nothing sends either, which is why it needs a test
 * that uses the scoped client rather than a raw one.
 *
 * Needs REDIS_URL and TEST_DATABASE_URL; skips without both so `npm test` still
 * runs anywhere.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';

const TEST_DATABASE_URL = process.env.TEST_DATABASE_URL;
const REDIS_URL = process.env.REDIS_URL;
const suite = TEST_DATABASE_URL && REDIS_URL ? describe : describe.skip;

const TENANT = 'queue-tenant-a';

suite('the WhatsApp queue', () => {
  let app: FastifyInstance;
  let runInTenant: (typeof import('../src/context/tenant-context.js'))['runInTenant'];
  let runUnscoped: (typeof import('../src/context/tenant-context.js'))['runUnscoped'];
  let queue: typeof import('../src/services/queue/whatsapp.queue.js');

  beforeAll(async () => {
    process.env.DATABASE_URL = TEST_DATABASE_URL;
    const ctx = await import('../src/context/tenant-context.js');
    runInTenant = ctx.runInTenant;
    runUnscoped = ctx.runUnscoped;
    queue = await import('../src/services/queue/whatsapp.queue.js');

    const { buildServer } = await import('../src/server.js');
    app = await buildServer();
    await app.ready();

    await app.prisma.tenant.upsert({
      where: { id: TENANT },
      update: {},
      create: { id: TENANT, slug: TENANT, name: 'Queue Tenant', status: 'ACTIVE' },
    });
    await runUnscoped('test setup', () => app.prisma.whatsAppLog.deleteMany({ where: { tenantId: TENANT } }));
  }, 60_000);

  afterAll(async () => {
    await queue?.closeWhatsAppQueue();
    if (app) {
      await runUnscoped('test teardown', () => app.prisma.whatsAppLog.deleteMany({ where: { tenantId: TENANT } }));
      await app.close();
    }
  });

  /** A QUEUED row, as dispatchWhatsApp writes it before handing the job over. */
  const queuedRow = () =>
    runInTenant({ tenantId: TENANT, subjectId: 'test', role: 'SUPER_ADMIN' }, () =>
      app.prisma.whatsAppLog.create({
        data: { tenantId: TENANT, phone: '+919000000001', templateName: 'TEST', message: 'hello', trigger: 'TEST', status: 'QUEUED' },
      }),
    );

  /** Poll for a condition instead of sleeping a guessed interval. */
  async function until<T>(get: () => Promise<T>, ok: (v: T) => boolean, timeoutMs = 15_000): Promise<T> {
    const deadline = Date.now() + timeoutMs;
    let last = await get();
    while (!ok(last) && Date.now() < deadline) {
      await new Promise((r) => setTimeout(r, 100));
      last = await get();
    }
    return last;
  }

  it('is on when REDIS_URL is set', () => {
    expect(queue.isQueueEnabled()).toBe(true);
  });

  it('delivers the job to a worker with its tenant intact', async () => {
    const row = await queuedRow();
    const received: { tenantId: string; logId: string; phone: string }[] = [];

    queue.startWhatsAppWorker(async (job) => {
      received.push({ tenantId: job.tenantId, logId: job.logId, phone: job.phone });
    });

    expect(
      await queue.enqueueWhatsApp({
        logId: row.id, tenantId: TENANT, phone: '+919000000001', message: 'hello', trigger: 'TEST',
      }),
    ).toBe(true);

    const got = await until(async () => received, (r) => r.length > 0);
    expect(got[0]).toEqual({ tenantId: TENANT, logId: row.id, phone: '+919000000001' });
  }, 30_000);

  it('lets the worker write through the SCOPED client, which has no ambient tenant', async () => {
    // This is the real risk. app.prisma is the tenant-filtered client and
    // throws outside a context, so a worker that forgot to re-enter the tenant
    // would fail here rather than silently doing the wrong thing.
    const row = await queuedRow();
    await queue.closeWhatsAppQueue();

    let failure: unknown = null;
    queue.startWhatsAppWorker(async (job) => {
      try {
        await runInTenant(
          { tenantId: job.tenantId, subjectId: 'whatsapp-worker', role: 'SUPER_ADMIN' },
          () =>
            app.prisma.whatsAppLog.update({
              where: { id: job.logId },
              data: { status: 'SENT', messageId: 'test-msg', sentAt: new Date() },
            }),
        );
      } catch (err) {
        failure = err;
      }
    });

    await queue.enqueueWhatsApp({
      logId: row.id, tenantId: TENANT, phone: '+919000000001', message: 'hello', trigger: 'TEST',
    });

    const after = await until(
      () => runUnscoped('assert', () => app.prisma.whatsAppLog.findUnique({ where: { id: row.id } })),
      (r) => r?.status === 'SENT',
    );
    expect(failure).toBeNull();
    expect(after?.status).toBe('SENT');
    expect(after?.messageId).toBe('test-msg');
  }, 30_000);

  it('retries a failing job up to MAX_ATTEMPTS', async () => {
    // CLAUDE.md: "Retry 3 times via BullMQ, then log as failed". This pins the
    // retry count actually configured on the queue, not the intention.
    const row = await queuedRow();
    await queue.closeWhatsAppQueue();

    const attempts: number[] = [];
    queue.startWhatsAppWorker(async (_job, attemptsMade) => {
      attempts.push(attemptsMade);
      throw new Error('provider down');
    });

    await queue.enqueueWhatsApp({
      logId: row.id, tenantId: TENANT, phone: '+919000000001', message: 'x', trigger: 'TEST',
    });

    const got = await until(async () => attempts, (a) => a.length >= queue.MAX_ATTEMPTS, 25_000);
    expect(got.length).toBe(queue.MAX_ATTEMPTS);
    expect(got).toEqual([0, 1, 2]); // attemptsMade counts prior attempts
  }, 45_000);
});
