/**
 * Inbound WhatsApp — the messages employees send us.
 *
 * The webhook used to be `return { received: true, body: req.body }`: it echoed
 * whatever was posted to it and did nothing. That is a problem beyond the
 * missing feature, because the endpoint is necessarily unauthenticated — it is
 * a URL Meta calls — so anything reachable through it is reachable by anyone
 * who finds the URL.
 *
 * Three things therefore have to be true before a message is acted on:
 *
 * 1. **It really came from Meta.** Every payload is signed with the app secret;
 *    an unsigned or wrongly signed one is refused before it is parsed.
 * 2. **We know whose employee sent it.** Phone numbers are unique *per tenant*
 *    (`@@unique([tenantId, phone])`), so the same number can belong to an
 *    employee of two different dealers. See `resolveInbound` — an ambiguous
 *    number is refused, never guessed.
 * 3. **It only ever reads that employee's own data.** Every command runs inside
 *    the resolved tenant's context as that employee, so the ordinary scoping
 *    rules apply to a caller who never signed in.
 */
import { createHmac, timingSafeEqual } from 'node:crypto';
import type { PrismaClient } from '@prisma/client';
import { runInTenant, runUnscoped } from '../../context/tenant-context.js';
import { logger } from '../../utils/logger.js';
import { normalizePhone } from '../../utils/phone.js';

/** One inbound text message, flattened out of Meta's envelope. */
export interface InboundMessage {
  /** Sender's phone in E.164-ish form, as Meta gives it (no leading +). */
  from: string;
  text: string;
  messageId: string;
  /** The business number that received it — identifies a dealer on OWN mode. */
  phoneNumberId: string | null;
}

/**
 * Confirm the payload was signed by Meta with our app secret.
 *
 * Compared in constant time: a byte-by-byte comparison that returns early
 * leaks, through timing, how much of a guessed signature was correct.
 */
export function verifyMetaSignature(rawBody: Buffer | string, header: string | undefined, appSecret: string): boolean {
  if (!header?.startsWith('sha256=')) return false;
  const expected = createHmac('sha256', appSecret).update(rawBody).digest('hex');
  const given = header.slice('sha256='.length);
  // timingSafeEqual throws on a length mismatch, which is itself a difference
  // worth reporting as "no" rather than as an exception.
  if (given.length !== expected.length) return false;
  return timingSafeEqual(Buffer.from(given, 'utf8'), Buffer.from(expected, 'utf8'));
}

/** Pull the text messages out of Meta's webhook envelope, ignoring everything else. */
export function parseInbound(payload: unknown): InboundMessage[] {
  const out: InboundMessage[] = [];
  const body = payload as {
    entry?: {
      changes?: {
        value?: {
          metadata?: { phone_number_id?: string };
          messages?: { from?: string; id?: string; type?: string; text?: { body?: string } }[];
        };
      }[];
    }[];
  };

  for (const entry of body?.entry ?? []) {
    for (const change of entry?.changes ?? []) {
      const value = change?.value;
      const phoneNumberId = value?.metadata?.phone_number_id ?? null;
      for (const message of value?.messages ?? []) {
        // Status callbacks (delivered/read) and media arrive here too; only a
        // text message can carry a command.
        if (message?.type !== 'text') continue;
        const text = message.text?.body?.trim();
        if (!text || !message.from) continue;
        out.push({ from: message.from, text, messageId: message.id ?? '', phoneNumberId });
      }
    }
  }
  return out;
}

export type Resolution =
  | { kind: 'EMPLOYEE'; tenantId: string; employeeId: string; name: string }
  /** The number belongs to employees of more than one dealer. */
  | { kind: 'AMBIGUOUS'; tenantIds: string[] }
  | { kind: 'UNKNOWN' };

/**
 * Work out which dealer's employee sent a message.
 *
 * This is the part that has to be got right. `Employee.phone` is unique only
 * within a tenant, so on the platform's shared WhatsApp number one phone can
 * match an employee of two dealers — and answering "STATUS" for the wrong one
 * would hand a stranger someone's attendance, or with "SLIP" their salary.
 *
 * So a number matching two dealers is refused outright rather than resolved by
 * "first row wins". A dealer on their own WhatsApp number is unambiguous by
 * construction, and that is the way out for a shared number: the business
 * number that received the message identifies the dealer, whatever the sender's
 * number collides with.
 *
 * The lookup runs unscoped because there is no tenant yet — that is the whole
 * question being answered — and it reads nothing but id, name and tenant.
 */
export async function resolveInbound(
  prisma: PrismaClient,
  message: InboundMessage,
  ownNumberTenantId?: string | null,
): Promise<Resolution> {
  const phone = normalizePhone(message.from);

  const matches = await runUnscoped('WhatsApp webhook: find which tenant a sender belongs to', () =>
    prisma.employee.findMany({
      where: {
        phone,
        status: 'ACTIVE',
        ...(ownNumberTenantId ? { tenantId: ownNumberTenantId } : {}),
      },
      select: { id: true, name: true, tenantId: true },
    }),
  );

  if (matches.length === 0) return { kind: 'UNKNOWN' };
  if (matches.length > 1) return { kind: 'AMBIGUOUS', tenantIds: matches.map((m) => m.tenantId) };
  const only = matches[0];
  return { kind: 'EMPLOYEE', tenantId: only.tenantId, employeeId: only.id, name: only.name };
}

/** The commands an employee can text us, per CLAUDE.md. */
const HELP =
  'Send:\n' +
  'STATUS — today’s attendance\n' +
  'BALANCE — leave balance\n' +
  'SLIP — latest payslip\n' +
  'LEAVE — how to apply\n' +
  'IN / OUT — how to mark attendance';

const fmtTime = (d: Date | null, tz: string) =>
  d ? d.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', timeZone: tz }) : null;

/**
 * Answer one message. Returns the reply text, or null when there is nothing to
 * say — an unknown sender is answered with silence rather than with anything
 * that would confirm the number is or is not registered.
 */
export async function handleInbound(
  prisma: PrismaClient,
  message: InboundMessage,
  resolution: Resolution,
  companyTz = process.env.COMPANY_TZ ?? 'Asia/Kolkata',
): Promise<string | null> {
  if (resolution.kind === 'UNKNOWN') {
    logger.info({ messageId: message.messageId }, 'WhatsApp inbound from an unrecognised number');
    return null;
  }
  if (resolution.kind === 'AMBIGUOUS') {
    // Two dealers, one phone number. Answering either would be a coin toss with
    // someone's salary on it.
    logger.warn(
      { messageId: message.messageId, tenants: resolution.tenantIds.length },
      'WhatsApp inbound from a number registered to more than one workspace — refusing to guess',
    );
    return 'This number is registered with more than one employer, so we cannot answer here. Please use the app.';
  }

  const command = message.text.trim().split(/\s+/)[0].toUpperCase();
  const { tenantId, employeeId, name } = resolution;

  return runInTenant({ tenantId, subjectId: employeeId, role: 'EMPLOYEE' }, async () => {
    switch (command) {
      case 'STATUS': {
        const start = new Date();
        start.setHours(0, 0, 0, 0);
        const end = new Date(start);
        end.setDate(end.getDate() + 1);
        const today = await prisma.attendance.findFirst({
          where: { employeeId, date: { gte: start, lt: end } },
        });
        if (!today?.checkIn) return `${name}: no check-in recorded today.`;
        const out = fmtTime(today.checkOut, companyTz);
        return (
          `${name} — today\n` +
          `In: ${fmtTime(today.checkIn, companyTz)}\n` +
          `Out: ${out ?? 'still open'}\n` +
          `Status: ${today.status}${today.approvalStatus === 'PENDING' ? ' (awaiting approval)' : ''}`
        );
      }

      case 'BALANCE': {
        const year = new Date().getFullYear();
        const balance = await prisma.leaveBalance.findFirst({ where: { employeeId, type: 'CL', year } });
        if (!balance) return `${name}: no leave balance is set for ${year}.`;
        const left = Math.max(0, balance.total - balance.used);
        return `${name} — casual leave ${year}\nUsed: ${balance.used} of ${balance.total}\nRemaining: ${left}`;
      }

      case 'SLIP': {
        const slip = await prisma.payslip.findFirst({
          where: { employeeId },
          orderBy: [{ year: 'desc' }, { month: 'desc' }],
        });
        if (!slip) return `${name}: no payslip has been issued yet.`;
        if (slip.status === 'WITHHELD') {
          return `${name}: your ${slip.month}/${slip.year} payslip is on hold. Please contact HR.`;
        }
        // The PDF is served over an authenticated route, so it is not attached
        // to a message that arrives with no sign-in behind it.
        return (
          `${name} — payslip ${slip.month}/${slip.year}\n` +
          `Net: ₹${slip.netSalary.toLocaleString('en-IN')}\n` +
          'Open the app to download the PDF.'
        );
      }

      case 'LEAVE':
        return `${name}: apply for leave in the app — Leave → Apply. Your manager is notified straight away.`;

      case 'IN':
      case 'OUT':
        return (
          `${name}: attendance needs a selfie and your location, so it has to be marked in the app. ` +
          'Open it and use Check In / Check Out.'
        );

      default:
        return `${name}, I did not recognise that.\n\n${HELP}`;
    }
  });
}
