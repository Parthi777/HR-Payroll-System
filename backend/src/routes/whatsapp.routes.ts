import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { requireRole } from '../middleware/auth.js';
import { env } from '../config/env.js';
import { dispatchWhatsApp, isWhatsAppEnabled, sendReply } from '../services/whatsapp/whatsapp.service.js';
import {
  handleInbound,
  parseMetaInbound,
  parseTwilioInbound,
  resolveInbound,
  verifyMetaSignature,
  verifyTwilioSignature,
} from '../services/whatsapp/inbound.service.js';
import { logger } from '../utils/logger.js';
import { runInTenant } from '../context/tenant-context.js';
import { recordAudit } from '../services/audit/audit.service.js';

/**
 * The absolute URL Twilio called, as Twilio saw it.
 *
 * The signature covers that URL, so it has to match byte for byte. Behind
 * Railway's proxy the request's own protocol and host are the internal ones,
 * and `trustProxy` only fixes that when the forwarded headers survive — so
 * `WHATSAPP_WEBHOOK_URL` overrides it outright. Set it to exactly the URL
 * configured in the Twilio console, query string and all, if signatures fail.
 */
function webhookUrlFor(req: { protocol: string; hostname: string; url: string }): string {
  return env.WHATSAPP_WEBHOOK_URL ?? `${req.protocol}://${req.hostname}${req.url}`;
}

export async function whatsappRoutes(app: FastifyInstance) {
  /**
   * Keep the exact bytes Meta sent, for the signature check.
   *
   * A signature covers the raw payload, and `JSON.parse` then `JSON.stringify`
   * does not reproduce it — key order, whitespace and number formatting are all
   * free to differ. So the body is captured verbatim here and parsed
   * afterwards. Scoped to this plugin, so no other route is affected.
   */
  app.addContentTypeParser('application/json', { parseAs: 'buffer' }, (req, body, done) => {
    (req as { rawBody?: Buffer }).rawBody = body as Buffer;
    try {
      done(null, JSON.parse((body as Buffer).toString('utf8') || '{}'));
    } catch {
      done(null, {});
    }
  });

  // Meta webhook verification (GET) — echoes hub.challenge
  app.get('/whatsapp/webhook', async (req, reply) => {
    const q = req.query as Record<string, string>;
    if (q['hub.mode'] === 'subscribe' && q['hub.verify_token'] === env.META_WHATSAPP_VERIFY_TOKEN) {
      return reply.send(q['hub.challenge']);
    }
    return reply.status(403).send('Forbidden');
  });

  /**
   * Inbound messages: IN / OUT / LEAVE / STATUS / BALANCE / SLIP.
   *
   * This route has no authentication and cannot have any — the provider calls
   * it. What stands in for a session is the signature check below plus the
   * tenant resolution in `resolveInbound`, which refuses a phone number that
   * belongs to more than one dealer rather than picking one.
   *
   * Meta and Twilio are both accepted, chosen by `WHATSAPP_PROVIDER`; they sign
   * and shape their payloads completely differently, and agree only on what an
   * `InboundMessage` is.
   *
   * A verified request always answers 200. Both providers retry anything else,
   * and a message we could not act on will not succeed on the fourth delivery
   * either — the failure is logged instead, where somebody can see it.
   */
  app.post('/whatsapp/webhook', async (req, reply) => {
    const twilio = env.WHATSAPP_PROVIDER === 'twilio';

    // Each provider signs something different, so each is checked its own way.
    // Neither falls open: with no secret configured the webhook refuses
    // everything, because anyone who finds this URL could otherwise pose as the
    // provider and ask for an employee's payslip.
    if (twilio) {
      const authToken = env.TWILIO_AUTH_TOKEN;
      if (!authToken) {
        logger.error('WhatsApp webhook called but TWILIO_AUTH_TOKEN is not set — ignoring');
        return reply.status(503).send({ error: 'Webhook not configured' });
      }
      const params = (req.body ?? {}) as Record<string, string>;
      const signature = req.headers['x-twilio-signature'] as string | undefined;
      if (!verifyTwilioSignature(webhookUrlFor(req), params, authToken, signature)) {
        logger.warn({ ip: req.ip }, 'WhatsApp webhook: bad or missing Twilio signature');
        return reply.status(401).send({ error: 'Bad signature' });
      }
    } else {
      const secret = env.META_WHATSAPP_APP_SECRET;
      if (!secret) {
        logger.error('WhatsApp webhook called but META_WHATSAPP_APP_SECRET is not set — ignoring');
        return reply.status(503).send({ error: 'Webhook not configured' });
      }
      const raw = (req as { rawBody?: Buffer }).rawBody ?? Buffer.from('');
      const signature = req.headers['x-hub-signature-256'] as string | undefined;
      if (!verifyMetaSignature(raw, signature, secret)) {
        logger.warn({ ip: req.ip }, 'WhatsApp webhook: bad or missing signature');
        return reply.status(401).send({ error: 'Bad signature' });
      }
    }

    const messages = twilio ? parseTwilioInbound(req.body) : parseMetaInbound(req.body);
    for (const message of messages) {
      try {
        const resolution = await resolveInbound(app.prisma, message);
        const replyText = await handleInbound(app.prisma, message, resolution);
        if (!replyText) continue;

        if (resolution.kind === 'EMPLOYEE') {
          // A known sender's conversation belongs in their employer's log,
          // beside every other message that employee was sent.
          await runInTenant(
            { tenantId: resolution.tenantId, subjectId: resolution.employeeId, role: 'EMPLOYEE' },
            () =>
              dispatchWhatsApp(app.prisma, {
                phone: message.from,
                employeeId: resolution.employeeId,
                message: replyText,
                trigger: 'INBOUND_REPLY',
                templateName: 'INBOUND_REPLY',
              }),
          );
        } else {
          // Nobody owns this conversation — send it, log nothing.
          await sendReply(message.from, replyText);
        }
      } catch (err) {
        logger.error({ err, messageId: message.messageId }, 'WhatsApp inbound handling failed');
      }
    }

    if (twilio) {
      // Twilio parses the response as TwiML. An empty Response means "nothing
      // to say inline" — the reply has already gone out over the API, which is
      // what keeps it logged like every other message.
      return reply.type('text/xml').send('<?xml version="1.0" encoding="UTF-8"?><Response></Response>');
    }
    return reply.send({ received: messages.length });
  });

  app.get('/admin/whatsapp/logs', { preHandler: requireRole('SUPER_ADMIN', 'HR_MANAGER') }, async () => {
    const logs = await app.prisma.whatsAppLog.findMany({ take: 100, orderBy: { createdAt: 'desc' } });
    return { logs };
  });

  app.post('/admin/whatsapp/send', { preHandler: requireRole('SUPER_ADMIN', 'HR_MANAGER') }, async (req) => {
    const { phone, templateName, message } = z
      .object({ phone: z.string().min(8), templateName: z.string().default('MANUAL'), message: z.string().min(1) })
      .parse(req.body);
    await dispatchWhatsApp(app.prisma, { phone, message, trigger: 'MANUAL', templateName });
    return { sent: isWhatsAppEnabled(), logged: true };
  });

  /**
   * Send one message to many people.
   *
   * This used to return `{ queued: phones.length }` having sent nothing — the
   * caller was told a broadcast went out that never did. Each recipient is now
   * dispatched and logged individually, so the WhatsApp log shows one row per
   * person and a partial failure is visible rather than averaged away.
   */
  app.post('/admin/whatsapp/broadcast', { preHandler: requireRole('SUPER_ADMIN', 'HR_MANAGER') }, async (req) => {
    const { phones, templateName, message } = z
      .object({
        phones: z.array(z.string().min(8)).min(1, 'Select at least one recipient').max(500),
        templateName: z.string().default('BROADCAST'),
        message: z.string().min(1, 'A message is required'),
      })
      .parse(req.body);

    // Sequential on purpose: providers rate-limit, and a burst of 500 parallel
    // sends is the reliable way to get the number throttled.
    let sent = 0;
    for (const phone of [...new Set(phones)]) {
      await dispatchWhatsApp(app.prisma, { phone, message, trigger: 'BROADCAST', templateName });
      sent += 1;
    }

    await recordAudit(req, 'WHATSAPP_BROADCAST', 'WhatsApp', {
      metadata: { recipients: sent, templateName, preview: message.slice(0, 120) },
    });

    return { recipients: sent, delivering: isWhatsAppEnabled() };
  });

  app.get('/admin/whatsapp/templates', { preHandler: requireRole('SUPER_ADMIN', 'HR_MANAGER') }, async () => {
    return { templates: ['CHECK_IN_CONFIRMATION', 'CHECK_OUT_SUMMARY', 'ABSENT_ALERT', 'LEAVE_APPROVED', 'LEAVE_REJECTED', 'SALARY_SLIP', 'GEOFENCE_VIOLATION'] };
  });
}
