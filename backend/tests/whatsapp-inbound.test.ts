/**
 * Inbound WhatsApp: signatures, parsing, and whose employee sent it.
 *
 * The signature and parsing tests need no database and always run. The
 * resolution tests do need one, because the whole question is what happens when
 * two dealers' employees share a phone number — which cannot be reproduced
 * without two dealers.
 */
import { createHmac } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import bcrypt from 'bcrypt';
import type { FastifyInstance } from 'fastify';
import {
  parseMetaInbound,
  parseTwilioInbound,
  verifyMetaSignature,
  verifyTwilioSignature,
} from '../src/services/whatsapp/inbound.service.js';

const SECRET = 'test-app-secret';
const sign = (body: string) => `sha256=${createHmac('sha256', SECRET).update(body).digest('hex')}`;

/** A Meta text-message envelope. */
const envelope = (from: string, text: string, phoneNumberId = 'PHONE_ID') => ({
  object: 'whatsapp_business_account',
  entry: [
    {
      id: 'WABA',
      changes: [
        {
          field: 'messages',
          value: {
            messaging_product: 'whatsapp',
            metadata: { display_phone_number: '15550001', phone_number_id: phoneNumberId },
            messages: [{ from, id: 'wamid.TEST', timestamp: '1', type: 'text', text: { body: text } }],
          },
        },
      ],
    },
  ],
});

describe('webhook signatures', () => {
  it('accepts a payload signed with the app secret', () => {
    const body = JSON.stringify(envelope('919000000001', 'STATUS'));
    expect(verifyMetaSignature(body, sign(body), SECRET)).toBe(true);
  });

  it('rejects a payload whose body was changed after signing', () => {
    const body = JSON.stringify(envelope('919000000001', 'STATUS'));
    const signature = sign(body);
    const tampered = JSON.stringify(envelope('919000000002', 'SLIP'));
    expect(verifyMetaSignature(tampered, signature, SECRET)).toBe(false);
  });

  it('rejects a signature made with the wrong secret', () => {
    const body = JSON.stringify(envelope('919000000001', 'STATUS'));
    const wrong = `sha256=${createHmac('sha256', 'not-the-secret').update(body).digest('hex')}`;
    expect(verifyMetaSignature(body, wrong, SECRET)).toBe(false);
  });

  it('rejects a missing or malformed header rather than throwing', () => {
    const body = JSON.stringify(envelope('919000000001', 'STATUS'));
    expect(verifyMetaSignature(body, undefined, SECRET)).toBe(false);
    expect(verifyMetaSignature(body, 'sha256=short', SECRET)).toBe(false);
    expect(verifyMetaSignature(body, 'md5=whatever', SECRET)).toBe(false);
  });
});

describe('parsing Meta’s envelope', () => {
  it('pulls out the sender, the text and the business number', () => {
    const [msg] = parseMetaInbound(envelope('919000000001', ' status '));
    expect(msg.from).toBe('919000000001');
    expect(msg.text).toBe('status');
    expect(msg.phoneNumberId).toBe('PHONE_ID');
  });

  it('ignores delivery receipts and anything that is not a text message', () => {
    const statuses = {
      entry: [{ changes: [{ value: { statuses: [{ id: 'wamid.X', status: 'delivered' }] } }] }],
    };
    const image = {
      entry: [{ changes: [{ value: { messages: [{ from: '91900', id: 'i', type: 'image' }] } }] }],
    };
    expect(parseMetaInbound(statuses)).toEqual([]);
    expect(parseMetaInbound(image)).toEqual([]);
  });

  it('survives a shape it has never seen', () => {
    // Meta adds fields; a webhook that throws on an unfamiliar payload stops
    // processing the messages it *did* understand.
    expect(parseMetaInbound({})).toEqual([]);
    expect(parseMetaInbound(null)).toEqual([]);
    expect(parseMetaInbound({ entry: [{ changes: [{}] }] })).toEqual([]);
  });
});

describe('Twilio signatures and form posts', () => {
  const AUTH = 'twilio-auth-token';
  const URL = 'https://api.example.com/api/whatsapp/webhook';
  const form = { From: 'whatsapp:+919000000001', To: 'whatsapp:+14155238886', Body: 'STATUS', MessageSid: 'SM123' };

  /** Twilio's scheme: URL, then every parameter sorted by name, key then value. */
  const twilioSign = (url: string, params: Record<string, string>, token = AUTH) =>
    createHmac('sha1', token)
      .update(Buffer.from(Object.keys(params).sort().reduce((acc, k) => acc + k + params[k], url), 'utf8'))
      .digest('base64');

  it('accepts a correctly signed form post', () => {
    expect(verifyTwilioSignature(URL, form, AUTH, twilioSign(URL, form))).toBe(true);
  });

  it('rejects it when a parameter changed after signing', () => {
    const signature = twilioSign(URL, form);
    expect(verifyTwilioSignature(URL, { ...form, Body: 'SLIP' }, AUTH, signature)).toBe(false);
  });

  it('rejects it when the URL is not the one that was signed', () => {
    // The commonest production failure: a proxy rewrites host or scheme, so the
    // URL we reconstruct is not the URL Twilio signed.
    const signature = twilioSign(URL, form);
    expect(verifyTwilioSignature('http://internal:3001/api/whatsapp/webhook', form, AUTH, signature)).toBe(false);
  });

  it('rejects a signature made with someone else’s auth token', () => {
    expect(verifyTwilioSignature(URL, form, AUTH, twilioSign(URL, form, 'wrong-token'))).toBe(false);
  });

  it('rejects a missing signature rather than throwing', () => {
    expect(verifyTwilioSignature(URL, form, AUTH, undefined)).toBe(false);
    expect(verifyTwilioSignature(URL, form, AUTH, 'nonsense')).toBe(false);
  });

  it('reads the sender and text, stripping the whatsapp: prefix', () => {
    const [msg] = parseTwilioInbound(form);
    // Numbers must look the same whichever provider delivered them.
    expect(msg.from).toBe('+919000000001');
    expect(msg.text).toBe('STATUS');
    expect(msg.messageId).toBe('SM123');
    expect(msg.phoneNumberId).toBe('+14155238886');
  });

  it('ignores a post with no message in it', () => {
    expect(parseTwilioInbound({ From: 'whatsapp:+919000000001' })).toEqual([]);
    expect(parseTwilioInbound({ MessageStatus: 'delivered', MessageSid: 'SM1' })).toEqual([]);
    expect(parseTwilioInbound({})).toEqual([]);
  });
});

const TEST_DATABASE_URL = process.env.TEST_DATABASE_URL;
const suite = TEST_DATABASE_URL ? describe : describe.skip;

const PLATFORM = { email: 'owner@platform.test', name: 'Platform Owner', password: 'platform-owner-pass' };
const DEALER_PASSWORD = 'dealer-admin-password';
/** The same number, on the payroll of two different dealers. */
const SHARED_PHONE = '+919000000777';

suite('working out whose employee sent a message', () => {
  let app: FastifyInstance;
  let resolveInbound: typeof import('../src/services/whatsapp/inbound.service.js').resolveInbound;
  let handleInbound: typeof import('../src/services/whatsapp/inbound.service.js').handleInbound;
  const tokens: Record<string, string> = {};

  let ipCounter = 0;
  const freshIp = () => `10.3.${Math.floor(++ipCounter / 250)}.${ipCounter % 250}`;

  const call = (slug: string, method: 'GET' | 'POST', url: string, payload?: unknown) =>
    app.inject({
      method, url,
      headers: { authorization: `Bearer ${tokens[slug]}`, 'x-tenant-slug': slug },
      ...(payload === undefined ? {} : { payload: payload as object }),
    });

  async function makeDealer(slug: string, name: string, email: string, platformToken: string) {
    const made = await app.inject({
      method: 'POST', url: '/api/platform/tenants',
      headers: { authorization: `Bearer ${platformToken}` },
      payload: { slug, name, admin: { name: `${name} Owner`, email, password: DEALER_PASSWORD } },
    });
    expect(made.statusCode, made.body).toBe(201);

    const signIn = await app.inject({
      method: 'POST', url: '/api/auth/admin/login', remoteAddress: freshIp(),
      headers: { 'x-tenant-slug': slug },
      payload: { email, password: DEALER_PASSWORD },
    });
    expect(signIn.statusCode, signIn.body).toBe(200);
    tokens[slug] = signIn.json().token;
  }

  /** Add an employee on the given phone, using the onboarding-created org rows. */
  async function addEmployee(slug: string, employeeName: string, phone: string) {
    const [branches, departments, designations] = (
      await Promise.all(['branches', 'departments', 'designations'].map((k) => call(slug, 'GET', `/api/admin/${k}`)))
    ).map((r) => r.json());
    const shifts = (await call(slug, 'GET', '/api/shifts')).json().shifts;

    const created = await call(slug, 'POST', '/api/admin/employees', {
      name: employeeName, phone,
      branchId: branches.branches[0].id,
      departmentId: departments.departments[0].id,
      designationId: designations.designations[0].id,
      shiftId: shifts[0].id,
      joiningDate: '2026-01-01', salary: 20000, password: 'employee-app-password',
    });
    expect(created.statusCode, created.body).toBe(200);
    return created.json().employee.id as string;
  }

  beforeAll(async () => {
    process.env.DATABASE_URL = TEST_DATABASE_URL;
    const { buildServer } = await import('../src/server.js');
    ({ resolveInbound, handleInbound } = await import('../src/services/whatsapp/inbound.service.js'));
    app = await buildServer();
    await app.ready();

    const p = app.prisma;
    const { runUnscoped } = await import('../src/context/tenant-context.js');
    await runUnscoped('test teardown', async () => {
      for (const del of [
        p.gPSLog, p.claimMessage, p.claim, p.attendance, p.leave, p.leaveBalance,
        p.payslip, p.notification, p.whatsAppLog, p.geofenceViolation, p.auditLog,
        p.employee, p.adminUser, p.branch, p.department, p.designation, p.shift,
        p.holiday, p.tenantSettings,
      ]) {
        await (del as { deleteMany: (a?: unknown) => Promise<unknown> }).deleteMany({});
      }
    });
    await p.platformAuditLog.deleteMany({});
    await p.tenant.deleteMany({});
    await p.platformUser.deleteMany({});

    await p.platformUser.create({
      data: { email: PLATFORM.email, name: PLATFORM.name, passwordHash: await bcrypt.hash(PLATFORM.password, 4) },
    });
    const login = await app.inject({
      method: 'POST', url: '/api/platform/auth/login', remoteAddress: freshIp(),
      payload: { email: PLATFORM.email, password: PLATFORM.password },
    });
    expect(login.statusCode, login.body).toBe(200);
    const platformToken = login.json().token;

    await makeDealer('wa-one', 'Dealer One', 'owner@wa-one.test', platformToken);
    await makeDealer('wa-two', 'Dealer Two', 'owner@wa-two.test', platformToken);
  }, 60_000);

  afterAll(async () => {
    await app?.close();
  });

  it('resolves a number that belongs to exactly one dealer', async () => {
    await addEmployee('wa-one', 'Solo Sender', '+919000000111');
    const res = await resolveInbound(app.prisma, {
      from: '919000000111', text: 'STATUS', messageId: 'm1', phoneNumberId: 'PHONE_ID',
    });
    expect(res.kind).toBe('EMPLOYEE');
    expect(res.kind === 'EMPLOYEE' && res.name).toBe('Solo Sender');
  });

  it('says nothing at all to a number it does not recognise', async () => {
    const res = await resolveInbound(app.prisma, {
      from: '919999999999', text: 'STATUS', messageId: 'm2', phoneNumberId: 'PHONE_ID',
    });
    expect(res.kind).toBe('UNKNOWN');
    // Silence, not "no such employee" — that would confirm which numbers exist.
    expect(await handleInbound(app.prisma, { from: '919999999999', text: 'STATUS', messageId: 'm2', phoneNumberId: null }, res)).toBeNull();
  });

  it('refuses to guess when one number is on two dealers’ payrolls', async () => {
    await addEmployee('wa-one', 'Ravi At One', SHARED_PHONE);
    await addEmployee('wa-two', 'Ravi At Two', SHARED_PHONE);

    const message = { from: '919000000777', text: 'SLIP', messageId: 'm3', phoneNumberId: 'PHONE_ID' };
    const res = await resolveInbound(app.prisma, message);
    expect(res.kind, 'a number on two payrolls must not resolve to one of them').toBe('AMBIGUOUS');

    const reply = await handleInbound(app.prisma, message, res);
    // Whatever it says, it must not carry either employee's data.
    expect(reply).toBeTruthy();
    expect(reply).not.toContain('Ravi At One');
    expect(reply).not.toContain('Ravi At Two');
    expect(reply).toMatch(/more than one employer/i);
  });

  it('answers only from the sender’s own workspace when the dealer has its own number', async () => {
    // Given the business number, the collision stops mattering.
    const oneId = (await app.inject({
      method: 'GET', url: '/api/admin/employees',
      headers: { authorization: `Bearer ${tokens['wa-one']}`, 'x-tenant-slug': 'wa-one' },
    })).json().employees.find((e: { phone: string }) => e.phone === SHARED_PHONE).tenantId;

    const res = await resolveInbound(
      app.prisma,
      { from: '919000000777', text: 'STATUS', messageId: 'm4', phoneNumberId: 'PHONE_ID' },
      oneId,
    );
    expect(res.kind).toBe('EMPLOYEE');
    expect(res.kind === 'EMPLOYEE' && res.name).toBe('Ravi At One');
  });

  describe('the commands themselves', () => {
    const ask = async (text: string) => {
      const message = { from: '919000000111', text, messageId: 'c', phoneNumberId: 'PHONE_ID' };
      return handleInbound(app.prisma, message, await resolveInbound(app.prisma, message));
    };

    it('reports today’s attendance, and says so plainly when there is none', async () => {
      expect(await ask('STATUS')).toMatch(/no check-in recorded today/i);
    });

    it('reports the leave balance', async () => {
      expect(await ask('BALANCE')).toMatch(/no leave balance is set|casual leave/i);
    });

    it('does not attach a payslip to an unauthenticated conversation', async () => {
      const reply = await ask('SLIP');
      expect(reply).toBeTruthy();
      expect(reply).not.toMatch(/https?:\/\//);
    });

    it('sends IN and OUT back to the app, which is where the selfie happens', async () => {
      expect(await ask('IN')).toMatch(/app/i);
      expect(await ask('OUT')).toMatch(/app/i);
    });

    it('offers the command list when it does not understand', async () => {
      const reply = await ask('hello there');
      expect(reply).toMatch(/STATUS/);
      expect(reply).toMatch(/BALANCE/);
    });

    it('is not case sensitive, and ignores what follows the command', async () => {
      expect(await ask('status please')).toMatch(/no check-in recorded today/i);
    });
  });
});
