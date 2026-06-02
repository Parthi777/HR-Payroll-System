/**
 * WhatsApp service — WATI / Twilio / Meta Cloud API.
 *
 * `dispatchWhatsApp` logs every message to WhatsAppLog and sends via the configured
 * provider. When no provider is configured the row stays QUEUED (so the admin UI
 * shows what *would* be sent), and delivery activates as soon as credentials exist.
 * Sent synchronously for now — TODO: move to a BullMQ queue once Redis is available.
 */
import type { PrismaClient } from '@prisma/client';
import { env } from '../../config/env.js';
import { logger } from '../../utils/logger.js';

export interface DispatchInput {
  phone: string;
  message: string;
  trigger: string;
  templateName?: string;
  employeeId?: string | null;
}

interface Provider {
  sendText(phone: string, message: string): Promise<{ messageId: string }>;
}

/** True when the configured provider has the credentials it needs. */
export function isWhatsAppEnabled(): boolean {
  switch (env.WHATSAPP_PROVIDER) {
    case 'meta':
      return !!(env.META_WHATSAPP_TOKEN && env.META_WHATSAPP_PHONE_ID);
    case 'twilio':
      return !!(env.TWILIO_ACCOUNT_SID && env.TWILIO_AUTH_TOKEN && env.TWILIO_WHATSAPP_FROM);
    case 'wati':
      return !!(env.WATI_API_URL && env.WATI_API_TOKEN);
    default:
      return false;
  }
}

const metaProvider: Provider = {
  async sendText(phone, message) {
    const res = await fetch(`https://graph.facebook.com/v20.0/${env.META_WHATSAPP_PHONE_ID}/messages`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${env.META_WHATSAPP_TOKEN}`, 'Content-Type': 'application/json' },
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
  async sendText(phone, message) {
    const sid = env.TWILIO_ACCOUNT_SID as string;
    const auth = Buffer.from(`${sid}:${env.TWILIO_AUTH_TOKEN}`).toString('base64');
    const body = new URLSearchParams({
      From: env.TWILIO_WHATSAPP_FROM as string,
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
  async sendText(phone, message) {
    const url = `${env.WATI_API_URL}/sendSessionMessage/${phone.replace(/\D/g, '')}?messageText=${encodeURIComponent(message)}`;
    const res = await fetch(url, { method: 'POST', headers: { Authorization: `Bearer ${env.WATI_API_TOKEN}` } });
    if (!res.ok) throw new Error(`WATI ${res.status}: ${await res.text()}`);
    return { messageId: `wati_${Date.now()}` };
  },
};

function provider(): Provider {
  switch (env.WHATSAPP_PROVIDER) {
    case 'meta':
      return metaProvider;
    case 'twilio':
      return twilioProvider;
    default:
      return watiProvider;
  }
}

/** Log + send a WhatsApp message. Never throws — failures are recorded on the log row. */
export async function dispatchWhatsApp(prisma: PrismaClient, input: DispatchInput): Promise<void> {
  const log = await prisma.whatsAppLog.create({
    data: {
      phone: input.phone,
      employeeId: input.employeeId ?? null,
      templateName: input.templateName ?? input.trigger,
      message: input.message,
      trigger: input.trigger,
      status: 'QUEUED',
    },
  });

  if (!isWhatsAppEnabled()) {
    logger.info({ trigger: input.trigger }, 'WhatsApp not configured — message queued (not sent)');
    return;
  }

  try {
    const { messageId } = await provider().sendText(input.phone, input.message);
    await prisma.whatsAppLog.update({
      where: { id: log.id },
      data: { status: 'SENT', messageId, sentAt: new Date() },
    });
  } catch (err) {
    logger.error({ err, trigger: input.trigger }, 'WhatsApp send failed');
    await prisma.whatsAppLog.update({ where: { id: log.id }, data: { status: 'FAILED' } });
  }
}

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
