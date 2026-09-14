/**
 * The WhatsApp send queue.
 *
 * CLAUDE.md's backend conventions say WhatsApp sends always go through a queue
 * and never straight out of a request handler. The reason is visible in the
 * call sites: `dispatchWhatsApp` is awaited inside check-in, leave approval and
 * claim decisions, so a slow or unreachable provider makes an employee wait to
 * clock in, and a webhook reply competes with Meta's own timeout.
 *
 * Off unless REDIS_URL is set. With no Redis the sends happen inline exactly as
 * they did before this existed — which is what production does today, since it
 * has Postgres and no Redis. Turning the queue on is provisioning Redis and
 * setting the variable; nothing else changes.
 *
 * This module deliberately knows nothing about WhatsApp. It moves jobs; the
 * handler is injected by whoever starts the worker. That is what keeps
 * whatsapp.service (which enqueues) and this (which drains) from importing each
 * other in a cycle.
 */
import { Queue, Worker, type ConnectionOptions, type Job } from 'bullmq';
import { env } from '../../config/env.js';
import { logger } from '../../utils/logger.js';

const QUEUE_NAME = 'whatsapp';

/**
 * Three tries, then the row is marked FAILED — the handling CLAUDE.md specifies
 * for a delivery failure. Exported so the handler can tell a retry from the
 * last attempt without duplicating the number.
 */
export const MAX_ATTEMPTS = 3;

/** One message to send. Carries its tenant: a worker runs in no request. */
export interface WhatsAppJob {
  /** The WhatsAppLog row this job is delivering, already written as QUEUED. */
  logId: string;
  /**
   * Owning tenant. Every tenant-scoped query refuses to run without a context
   * (plugins/prisma.ts fails closed), and a worker has none of its own — so the
   * tenant travels with the job and the handler re-enters it.
   */
  tenantId: string;
  phone: string;
  message: string;
  trigger: string;
}

/** True when a Redis is configured. False means send inline, not "drop". */
export function isQueueEnabled(): boolean {
  return !!env.REDIS_URL;
}

/**
 * Connection options, not a client we construct ourselves. BullMQ ships its own
 * copy of ioredis, so a client built from the hoisted one is a structurally
 * different type and will not typecheck — and letting BullMQ own the connection
 * means closing the queue closes it too.
 *
 * maxRetriesPerRequest: null is required by BullMQ: with a finite value ioredis
 * errors commands while it is reconnecting, and the worker would read a blip in
 * the connection as a failed send.
 */
function connection(): ConnectionOptions {
  return { url: env.REDIS_URL as string, maxRetriesPerRequest: null };
}

/**
 * The producer's connection, which must fail rather than wait.
 *
 * `enableOfflineQueue: false` is the difference between a degraded queue and a
 * hung API. With the default (true) ioredis buffers commands while it is
 * disconnected and — because BullMQ also requires maxRetriesPerRequest: null —
 * that buffer never drains or errors, so `add()` never settles. `enqueue` is
 * awaited inside check-in, leave approval and claim decisions, so a Redis that
 * is configured but down would hang an employee's clock-in indefinitely. Off,
 * `add()` rejects at once and the caller sends inline instead.
 *
 * The worker keeps the buffering connection: reconnecting quietly is right for
 * a background drain, and there is no request waiting on it.
 */
function producerConnection(): ConnectionOptions {
  return { url: env.REDIS_URL as string, maxRetriesPerRequest: null, enableOfflineQueue: false };
}

/** Backstop for any way `add()` might still not settle promptly. */
const ENQUEUE_TIMEOUT_MS = 2_000;

// Held untyped: BullMQ 5's Queue derives three of its six generics from the
// first, and the derived form does not compare equal to the written one, so an
// annotated `Queue<WhatsAppJob>` rejects its own constructor. Job data stays
// typed where it matters — `enqueueWhatsApp` below takes a WhatsAppJob.
let queue: Queue | null = null;

function getQueue(): Queue | null {
  if (!isQueueEnabled()) return null;
  if (!queue) {
    queue = new Queue(QUEUE_NAME, { connection: producerConnection() });
    queue.on('error', (err) => logger.error({ err }, 'WhatsApp queue connection error'));
  }
  return queue;
}

/**
 * Hand a message to the queue. Returns false when it did not get there — queue
 * off, or Redis unreachable — and the caller then sends inline. A message is
 * never dropped because the queue is having a bad day.
 */
export async function enqueueWhatsApp(job: WhatsAppJob): Promise<boolean> {
  const q = getQueue();
  if (!q) return false;
  try {
    const added = await Promise.race([
      q
        .add('send', job, {
          // One job per log row. A retried enqueue after a timeout below cannot
          // then queue the same message twice.
          jobId: job.logId,
          attempts: MAX_ATTEMPTS,
          backoff: { type: 'exponential', delay: 2000 },
          removeOnComplete: 1000,
          removeOnFail: 5000,
        })
        .then(() => true),
      new Promise<boolean>((resolve) => setTimeout(() => resolve(false), ENQUEUE_TIMEOUT_MS)),
    ]);
    if (!added) {
      logger.error({ trigger: job.trigger }, 'enqueue did not settle in time — sending inline instead');
    }
    return added;
  } catch (err) {
    logger.error({ err, trigger: job.trigger }, 'could not enqueue WhatsApp message — sending inline instead');
    return false;
  }
}

let worker: Worker<WhatsAppJob> | null = null;

/**
 * Start draining the queue. No-op without Redis, so a deployment that has none
 * simply never has a worker. `handle` throwing asks BullMQ to retry.
 */
export function startWhatsAppWorker(
  /** `attemptsMade` counts attempts already made, so the handler can tell a retry from the last try. */
  handle: (job: WhatsAppJob, attemptsMade: number) => Promise<void>,
): Worker<WhatsAppJob> | null {
  if (!isQueueEnabled()) return null;
  if (worker) return worker;

  worker = new Worker<WhatsAppJob>(QUEUE_NAME, async (job: Job<WhatsAppJob>) => handle(job.data, job.attemptsMade), {
    connection: connection(),
    // WhatsApp providers rate-limit; a handful at a time is plenty for a queue
    // whose busiest moment is a payroll run's worth of payslips.
    concurrency: 5,
  });

  worker.on('failed', (job, err) => {
    logger.warn(
      { err, trigger: job?.data.trigger, attempt: job?.attemptsMade, of: MAX_ATTEMPTS },
      'WhatsApp job attempt failed',
    );
  });
  worker.on('error', (err) => logger.error({ err }, 'WhatsApp worker error'));

  logger.info({ queue: QUEUE_NAME }, 'WhatsApp queue worker started');
  return worker;
}

/** Let an in-flight send finish before the process goes away. */
export async function closeWhatsAppQueue(): Promise<void> {
  await worker?.close();
  await queue?.close();
  worker = null;
  queue = null;
}
