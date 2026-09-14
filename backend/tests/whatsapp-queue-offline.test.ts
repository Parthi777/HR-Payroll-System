/**
 * Redis configured but unreachable — the failure that matters most.
 *
 * `enqueueWhatsApp` is awaited inside check-in, leave approval and claim
 * decisions. BullMQ requires `maxRetriesPerRequest: null`, and with ioredis's
 * default offline queue that combination *buffers* commands while disconnected
 * instead of erroring — so `add()` never settles and an employee's clock-in
 * hangs forever. Measured at 8s+ and still going before this was fixed.
 *
 * The fix is `enableOfflineQueue: false` on the producer plus a bounded race.
 * This test fails loudly if either is removed: it asserts the call comes back,
 * quickly, saying the message was not queued — which makes the caller send it
 * inline rather than lose it.
 *
 * No Redis needed: the point is that nothing is listening.
 */
import { beforeAll, describe, expect, it } from 'vitest';

// Must be set before the queue module reads env. A port nothing listens on.
process.env.REDIS_URL = 'redis://127.0.0.1:56999';

let queue: typeof import('../src/services/queue/whatsapp.queue.js');

beforeAll(async () => {
  queue = await import('../src/services/queue/whatsapp.queue.js');
});

describe('a configured but unreachable Redis', () => {
  it('counts as enabled — the operator asked for a queue', () => {
    expect(queue.isQueueEnabled()).toBe(true);
  });

  it('does not hang the caller, and says the message was not queued', async () => {
    const started = Date.now();
    const queued = await queue.enqueueWhatsApp({
      logId: 'log-1', tenantId: 't1', phone: '+919000000001', message: 'hello', trigger: 'TEST',
    });
    const elapsed = Date.now() - started;

    // false is what makes dispatchWhatsApp fall through to an inline send.
    expect(queued).toBe(false);
    // Generous, but far below "never returns", which is what it did before.
    expect(elapsed).toBeLessThan(5_000);
  }, 20_000);

  it('starts no worker it cannot drain without erroring the caller', () => {
    // A worker against a dead Redis is allowed — it reconnects quietly, which
    // is right for a background drain. What matters is that asking for one does
    // not throw into whoever is booting the server.
    expect(() => queue.startWhatsAppWorker(async () => {})).not.toThrow();
  });
});
