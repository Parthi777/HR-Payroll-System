/**
 * WhatsApp service — WATI / Twilio / Meta Cloud API.
 *
 * `dispatchWhatsApp` logs every message to WhatsAppLog and sends it from the
 * account that belongs to the dealer it concerns. When no account is configured
 * the row stays QUEUED (so the admin UI shows what *would* be sent), and
 * delivery activates as soon as credentials exist.
 *
 * Which account is per-dealer. `TenantSettings.whatsappMode` is SHARED — the
 * platform's number, from the environment — or OWN, this dealer's own account
 * from `whatsappConfig`. A dealer's staff being messaged from another dealer's
 * number is both confusing and a disclosure: the reply lands in a stranger's
 * inbox. Credentials are therefore never read from the environment except for
 * the platform's own SHARED sender.
 *
 * Sent synchronously for now — TODO: move to a BullMQ queue once Redis is available.
 */
import type { PrismaClient } from '@prisma/client';
import { requireTenantId } from '../../context/tenant-context.js';
import { env } from '../../config/env.js';
import { logger } from '../../utils/logger.js';
import { getTenantPolicy, type ResourcePolicy } from '../settings/tenant-settings.service.js';
import { enqueueWhatsApp, isQueueEnabled, MAX_ATTEMPTS, type WhatsAppJob } from '../queue/whatsapp.queue.js';

export interface DispatchInput {
  phone: string;
  message: string;
  trigger: string;
  templateName?: string;
  employeeId?: string | null;
}

type ProviderName = 'meta' | 'twilio' | 'wati';

/** The account one message is sent from, and the credentials to send it with. */
export interface WhatsAppSender {
  provider: ProviderName;
  creds: Record<string, string>;
}

interface Provider {
  sendText(sender: WhatsAppSender, phone: string, message: string): Promise<{ messageId: string }>;
}

/** What each provider cannot send without. */
const REQUIRED: Record<ProviderName, readonly string[]> = {
  meta: ['token', 'phoneId'],
  twilio: ['accountSid', 'authToken', 'from'],
  wati: ['apiUrl', 'apiToken'],
};

/** A sender that is actually usable — every credential its provider needs. */
function usable(sender: WhatsAppSender | null): boolean {
  return !!sender && !!REQUIRED[sender.provider]?.every((k) => !!sender.creds[k]);
}

/** The platform's own account, from the environment. Used by every SHARED dealer. */
function platformSender(): WhatsAppSender {
  const provider = env.WHATSAPP_PROVIDER as ProviderName;
  const creds: Record<string, string> =
    provider === 'meta'
      ? { token: env.META_WHATSAPP_TOKEN ?? '', phoneId: env.META_WHATSAPP_PHONE_ID ?? '' }
      : provider === 'twilio'
        ? {
            accountSid: env.TWILIO_ACCOUNT_SID ?? '',
            authToken: env.TWILIO_AUTH_TOKEN ?? '',
            from: env.TWILIO_WHATSAPP_FROM ?? '',
          }
        : { apiUrl: env.WATI_API_URL ?? '', apiToken: env.WATI_API_TOKEN ?? '' };
  return { provider, creds };
}

/**
 * This dealer's own account, or null when it is on the shared number.
 *
 * An OWN account that is incomplete falls back to SHARED rather than failing the
 * send — a half-filled config should not silently stop a dealer's check-in
 * confirmations — but it is logged, because the fallback means their staff are
 * messaged from the platform's number instead of their own.
 */
export function tenantSender(resources: Pick<ResourcePolicy, 'whatsappMode' | 'whatsappConfig'>): WhatsAppSender | null {
  if (resources.whatsappMode !== 'OWN') return null;
  const cfg = resources.whatsappConfig;
  if (!cfg) return null;
  const provider = cfg.provider as ProviderName;
  if (!REQUIRED[provider]) return null;
  return { provider, creds: cfg };
}

/** True when the platform's shared account has the credentials it needs. */
export function isWhatsAppEnabled(): boolean {
  return usable(platformSender());
}

const metaProvider: Provider = {
  async sendText({ creds }, phone, message) {
    const res = await fetch(`https://graph.facebook.com/v20.0/${creds.phoneId}/messages`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${creds.token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        messaging_product: 'whatsapp',
        to: phone.replace(/\D/g, ''),
        type: 'text',
        text: { body: message },
      }),
    });
    if (!res.ok) throw new Error(`Meta ${res.status}: ${await res.text()}`);
    const data = (await res.json()) as { messages?: { id: string }[] };
    return { messageId: data.messages?.[0]?.id ?? 'meta' };
  },
};

const twilioProvider: Provider = {
  async sendText({ creds }, phone, message) {
    const sid = creds.accountSid;
    const auth = Buffer.from(`${sid}:${creds.authToken}`).toString('base64');
    const body = new URLSearchParams({
      From: creds.from,
      To: `whatsapp:${phone}`,
      Body: message,
    });
    const res = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${sid}/Messages.json`, {
      method: 'POST',
      headers: { Authorization: `Basic ${auth}`, 'Content-Type': 'application/x-www-form-urlencoded' },
      body,
    });
    if (!res.ok) throw new Error(`Twilio ${res.status}: ${await res.text()}`);
    const data = (await res.json()) as { sid: string };
    return { messageId: data.sid };
  },
};

const watiProvider: Provider = {
  async sendText({ creds }, phone, message) {
    const url = `${creds.apiUrl}/sendSessionMessage/${phone.replace(/\D/g, '')}?messageText=${encodeURIComponent(message)}`;
    const res = await fetch(url, { method: 'POST', headers: { Authorization: `Bearer ${creds.apiToken}` } });
    if (!res.ok) throw new Error(`WATI ${res.status}: ${await res.text()}`);
    return { messageId: `wati_${Date.now()}` };
  },
};

function provider(name: ProviderName): Provider {
  switch (name) {
    case 'meta':
      return metaProvider;
    case 'twilio':
      return twilioProvider;
    default:
      return watiProvider;
  }
}

/**
 * The account this dealer's messages go out from: its own when it has one,
 * otherwise the platform's shared number.
 */
export async function senderFor(prisma: PrismaClient): Promise<WhatsAppSender | null> {
  const { resources } = await getTenantPolicy(prisma);
  const own = tenantSender(resources);
  if (own && !usable(own)) {
    logger.warn(
      { provider: own.provider },
      'dealer is set to its own WhatsApp account but the credentials are incomplete — using the shared number',
    );
  }
  if (own && usable(own)) return own;
  const shared = platformSender();
  return usable(shared) ? shared : null;
}

/**
 * Send one message and record the outcome on its log row.
 *
 * Throws when the send fails, so a queued job can be retried. The inline path
 * catches; the worker lets it through until the last attempt. Shared so both
 * paths mark a row the same way — a message must not read SENT down one route
 * and FAILED down the other.
 */
async function deliver(prisma: PrismaClient, logId: string, phone: string, message: string): Promise<void> {
  const sender = await senderFor(prisma);
  if (!sender) {
    logger.info({ logId }, 'WhatsApp not configured — message stays QUEUED (not sent)');
    return;
  }
  const { messageId } = await provider(sender.provider).sendText(sender, phone, message);
  await prisma.whatsAppLog.update({
    where: { id: logId },
    data: { status: 'SENT', messageId, sentAt: new Date() },
  });
}

/**
 * Run one queued job. Called by the worker, inside the job's tenant.
 *
 * Retries by throwing, which is how BullMQ is told to try again. On the last
 * attempt it marks the row FAILED and returns instead — CLAUDE.md's "retry 3
 * times, then log as failed" — because a job that ends by throwing leaves the
 * row saying QUEUED forever and the admin screen would show a message still
 * waiting to go out that nothing will ever send.
 */
export async function runWhatsAppJob(
  prisma: PrismaClient,
  job: WhatsAppJob,
  attemptsMade: number,
): Promise<void> {
  // At-least-once, so this has to be idempotent. Two ways the same message can
  // arrive twice: BullMQ redelivering a job whose worker stalled, and an
  // enqueue that timed out, was sent inline, and then landed in Redis after
  // all. A row that is already SENT has been delivered — leave it alone rather
  // than message the employee a second time.
  const row = await prisma.whatsAppLog.findUnique({ where: { id: job.logId } });
  if (!row) {
    logger.warn({ logId: job.logId }, 'WhatsApp job for a log row that no longer exists — dropping');
    return;
  }
  if (row.status === 'SENT') {
    logger.info({ logId: job.logId }, 'WhatsApp message already sent — skipping duplicate job');
    return;
  }

  try {
    await deliver(prisma, job.logId, job.phone, job.message);
  } catch (err) {
    if (attemptsMade + 1 < MAX_ATTEMPTS) throw err;
    logger.error({ err, trigger: job.trigger }, 'WhatsApp send failed after every attempt');
    await prisma.whatsAppLog.update({ where: { id: job.logId }, data: { status: 'FAILED' } });
  }
}

/**
 * Log a WhatsApp message and get it sent. Never throws.
 *
 * The row is written here, in the request, because that is where the tenant is
 * known. Delivery goes to the queue when one is configured so that a slow
 * provider cannot hold up a check-in; with no queue it happens inline, exactly
 * as it did before the queue existed.
 */
export async function dispatchWhatsApp(prisma: PrismaClient, input: DispatchInput): Promise<void> {
  const tenantId = requireTenantId();
  const log = await prisma.whatsAppLog.create({
    data: {
      tenantId,
      phone: input.phone,
      employeeId: input.employeeId ?? null,
      templateName: input.templateName ?? input.trigger,
      message: input.message,
      trigger: input.trigger,
      status: 'QUEUED',
    },
  });

  if (isQueueEnabled()) {
    const queued = await enqueueWhatsApp({
      logId: log.id,
      tenantId,
      phone: input.phone,
      message: input.message,
      trigger: input.trigger,
    });
    // Enqueue failing is Redis being unreachable, not a reason to lose the
    // message: fall through and send it here instead.
    if (queued) return;
  }

  try {
    await deliver(prisma, log.id, input.phone, input.message);
  } catch (err) {
    logger.error({ err, trigger: input.trigger }, 'WhatsApp send failed');
    await prisma.whatsAppLog.update({ where: { id: log.id }, data: { status: 'FAILED' } });
  }
}

/**
 * Reply to an inbound message, without a tenant.
 *
 * `dispatchWhatsApp` writes a WhatsAppLog row and so needs a workspace to own
 * it. Some replies have none — a number registered to two dealers is refused
 * precisely because we do not know whose it is, and that refusal still has to
 * reach the sender. This sends and never throws; the webhook must answer Meta
 * either way.
 */
export async function sendReply(phone: string, message: string): Promise<void> {
  if (!isWhatsAppEnabled()) {
    logger.info({ phone: maskPhone(phone) }, 'WhatsApp not configured — reply not sent');
    return;
  }
  // No tenant means no dealer account to send from, so this goes out from the
  // platform's shared number — the only one that belongs to no dealer in
  // particular. isWhatsAppEnabled() above answers for exactly that account.
  const sender = platformSender();
  try {
    await provider(sender.provider).sendText(sender, phone, message);
  } catch (err) {
    logger.error({ err, phone: maskPhone(phone) }, 'WhatsApp reply failed');
  }
}

/** Last four digits only — CLAUDE.md requires phone numbers masked in logs. */
const maskPhone = (phone: string) => `••••${phone.slice(-4)}`;

// ── Message templates (see CLAUDE.md "Message Templates") ──
export const waTemplates = {
  checkIn: (name: string, time: string, branch: string) =>
    `✅ *Check-In Confirmed*\nEmployee: ${name}\nTime: ${time}\nBranch: ${branch}\nLocation: Verified ✓`,
  checkOut: (name: string, time: string, hours: string) =>
    `🏁 *Check-Out Confirmed*\nEmployee: ${name}\nCheck-Out: ${time}\nTotal Hours: ${hours}`,
  leaveApproved: (type: string, from: string, to: string, days: number) =>
    `✅ *Leave Approved*\nType: ${type}\nDuration: ${from} to ${to} (${days} day(s))`,
  leaveRejected: (from: string, to: string, reason: string) =>
    `❌ *Leave Rejected*\nYour leave request for ${from} to ${to} was rejected.\nReason: ${reason}`,
};
