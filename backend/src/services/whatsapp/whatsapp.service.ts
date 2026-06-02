/**
 * WhatsApp service abstraction. Supports WATI / Twilio / Meta Cloud API.
 * Actual sends are enqueued via BullMQ (never directly from a request handler).
 * See CLAUDE.md "WhatsApp Integration".
 */
import { env } from '../../config/env.js';

export type WhatsAppTrigger =
  | 'CHECK_IN'
  | 'CHECK_OUT'
  | 'ABSENT_ALERT'
  | 'LEAVE_APPROVED'
  | 'LEAVE_REJECTED'
  | 'SALARY_SLIP'
  | 'GEOFENCE_VIOLATION';

export interface SendMessageInput {
  phone: string;
  templateName: string;
  params: Record<string, string>;
  trigger: WhatsAppTrigger;
  mediaUrl?: string;
}

export interface WhatsAppProvider {
  send(input: SendMessageInput): Promise<{ messageId: string }>;
}

class WatiProvider implements WhatsAppProvider {
  async send(input: SendMessageInput) {
    // TODO: POST to `${env.WATI_API_URL}/sendTemplateMessage` with WATI_API_TOKEN
    return { messageId: `wati_TODO_${Date.now()}` };
  }
}

class TwilioProvider implements WhatsAppProvider {
  async send(input: SendMessageInput) {
    // TODO: Twilio Messages API using TWILIO_WHATSAPP_FROM
    return { messageId: `twilio_TODO_${Date.now()}` };
  }
}

class MetaProvider implements WhatsAppProvider {
  async send(input: SendMessageInput) {
    // TODO: POST to graph.facebook.com/{META_WHATSAPP_PHONE_ID}/messages
    return { messageId: `meta_TODO_${Date.now()}` };
  }
}

export function getWhatsAppProvider(): WhatsAppProvider {
  switch (env.WHATSAPP_PROVIDER) {
    case 'twilio':
      return new TwilioProvider();
    case 'meta':
      return new MetaProvider();
    case 'wati':
    default:
      return new WatiProvider();
  }
}
