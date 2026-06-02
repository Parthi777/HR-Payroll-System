import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { requireRole } from '../middleware/auth.js';
import { env } from '../config/env.js';
import { dispatchWhatsApp, isWhatsAppEnabled } from '../services/whatsapp/whatsapp.service.js';

export async function whatsappRoutes(app: FastifyInstance) {
  // Meta webhook verification (GET) — echoes hub.challenge
  app.get('/whatsapp/webhook', async (req, reply) => {
    const q = req.query as Record<string, string>;
    if (q['hub.mode'] === 'subscribe' && q['hub.verify_token'] === env.META_WHATSAPP_VERIFY_TOKEN) {
      return reply.send(q['hub.challenge']);
    }
    return reply.status(403).send('Forbidden');
  });

  // Inbound messages (POST) — IN / OUT / LEAVE / STATUS / BALANCE / SLIP
  app.post('/whatsapp/webhook', async (req) => {
    // TODO: parse Meta payload -> route command to handler
    return { received: true, body: req.body };
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

  app.post('/admin/whatsapp/broadcast', { preHandler: requireRole('SUPER_ADMIN', 'HR_MANAGER') }, async (req) => {
    const { phones, templateName } = z.object({ phones: z.array(z.string()), templateName: z.string() }).parse(req.body);
    return { queued: phones.length, templateName };
  });

  app.get('/admin/whatsapp/templates', { preHandler: requireRole('SUPER_ADMIN', 'HR_MANAGER') }, async () => {
    return { templates: ['CHECK_IN_CONFIRMATION', 'CHECK_OUT_SUMMARY', 'ABSENT_ALERT', 'LEAVE_APPROVED', 'LEAVE_REJECTED', 'SALARY_SLIP', 'GEOFENCE_VIOLATION'] };
  });
}
